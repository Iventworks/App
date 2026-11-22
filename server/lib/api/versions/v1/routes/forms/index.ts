import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../db";
import { FormFields } from "../../../../../forms/fields";
import { FormService } from "../../../../../forms/service";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { EventAccess } from "../../../../utils/eventAccess";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { PermissionHelper } from "../../../../utils/permissions";
import { FormModel } from "../../../../utils/shared-models/forms";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";

type FormsEnv = {
	Variables: { form: DB.Models.Form };
};

/**
 * Everything on one form, template included: its questions and texts, publishing and closing,
 * copies and the answers. The Kernteam manages org forms and templates, an event's Leitung its
 * forms (`forms:manage`); nobody else sees them here. The lists live with their place
 * (`/org/forms`, `/org/form-templates`, `/events/{id}/forms`), the public side under
 * `/public/forms/{token}`.
 */
export const router = new Hono<FormsEnv>().basePath("/forms");

const TAG = DOCS_TAGS.FORMS;
const FORBIDDEN = "You are not allowed to manage this form";

const STATUS_WORDS = {
	open: "veröffentlicht",
	reopened: "wieder geöffnet",
	closed: "geschlossen",
} as const;

/** Who may manage `form`: the Kernteam for org forms and templates, the Leitung for event forms. */
async function canManage(c: Context, form: DB.Models.Form) {
	const authContext = AuthHandler.AuthContext.get(c);
	if (authContext.type === "unauthenticated") return false;
	if (form.scope === "event") {
		if (form.event_id === null) return false;
		const access = await EventAccess.resolve(authContext, form.event_id);
		return PermissionHelper.canInEvent({ access, permission: "forms:manage" });
	}
	return PermissionHelper.can({ authContext, permission: "org_forms:manage" });
}

function auditEventId(form: DB.Models.Form) {
	return form.scope === "event" ? form.event_id : null;
}

router.use(
	"/:formId/*",
	requireOrgRole("volunteer"),
	zValidator("param", FormModel.Params),
	async (c, next) => {
		const formId = FormModel.Params.shape.formId.safeParse(c.req.param("formId"));
		if (!formId.success) return APIResponse.badRequest(c, "Invalid form id");
		const form = await FormService.get(formId.data);
		if (!form) return APIResponse.notFound(c, "Form not found");
		if (!(await canManage(c, form))) return APIResponse.forbidden(c, FORBIDDEN);
		c.set("form", form);
		await next();
	},
);

router.get(
	"/:formId",

	APIRouteSpec.authenticated({
		summary: "Get form",
		description: "A form or template with its questions, texts, status and link.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Form retrieved successfully", FormModel.Details),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		return APIResponse.success(
			c,
			"Form retrieved successfully",
			await FormService.details(c.get("form")),
		);
	},
);

router.put(
	"/:formId",

	APIRouteSpec.authenticated({
		summary: "Update form",
		description:
			"Change the title, the texts, the closing time or the questions (`fields`, always the whole list). Allowed after publishing too: answers keep their question ids, answers to removed questions are no longer shown. Once the form has answers, a question's type only changes within text (`short_text`, `long_text`, `email`) or choice questions (`single_choice`, `multiple_choice`, `dropdown`), so its answers still fit.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Form updated successfully", FormModel.Details),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", FormModel.Update.Body),

	async (c) => {
		const form = c.get("form");
		const body = c.req.valid("json") as FormModel.Update.Body;
		if (body.fields) {
			const blocked = FormFields.blockedTypeChanges(form.fields, body.fields);
			if (blocked.length && (await FormService.responseCount(form.id)) > 0) {
				return APIResponse.badRequest(
					c,
					`The form has answers, so these questions can't change their type that way: ${blocked.map((field) => field.id).join(", ")}`,
				);
			}
		}
		const updated = await FormService.update(form, body, getAuthUserId(c));

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(form),
			action: "update",
			entityType: "form",
			entityId: form.id,
			summary: `${FormService.describe(updated)} bearbeitet`,
			metadata: { fields: Object.keys(body) },
		});

		return APIResponse.success(c, "Form updated successfully", await FormService.details(updated));
	},
);

router.put(
	"/:formId/status",

	APIRouteSpec.authenticated({
		summary: "Publish or close form",
		description:
			"`open` publishes a draft (it gets its link, which stays the same from then on) or reopens a closed form or one past its closing time; a closing time that has passed is dropped then. `closed` stops new answers; the link then says so.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Form status changed successfully", FormModel.Details),
			APIResponseSpec.badRequest(
				"Templates can't be published / Add at least one question before publishing / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", FormModel.SetStatus.Body),

	async (c) => {
		const form = c.get("form");
		const { status } = c.req.valid("json") as FormModel.SetStatus.Body;
		if (form.scope === "template") return APIResponse.badRequest(c, "Templates can't be published");
		if (status === "open" && !FormFields.questionsOf(form.fields).length) {
			return APIResponse.badRequest(c, "Add at least one question before publishing");
		}

		const updated = await FormService.setStatus(form, status, getAuthUserId(c));
		// The same object: nothing to do.
		if (updated !== form) {
			const word =
				status === "closed"
					? STATUS_WORDS.closed
					: form.status === "draft"
						? STATUS_WORDS.open
						: STATUS_WORDS.reopened;
			await AuditLog.record({
				userId: getAuthUserId(c),
				eventId: auditEventId(form),
				action: "update",
				entityType: "form",
				entityId: form.id,
				summary: `${FormService.describe(form)} ${word}`,
				metadata: { status },
			});
		}

		return APIResponse.success(
			c,
			"Form status changed successfully",
			await FormService.details(updated),
		);
	},
);

router.post(
	"/:formId/copy",

	APIRouteSpec.authenticated({
		summary: "Copy form",
		description:
			"A new draft with the same questions and texts, in the same place — or, with `as_template`, a new template (Kernteam). Answers, link and closing time don't come along.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Form copied successfully", FormModel.Details),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(`${FORBIDDEN} / Only the core team manages templates`),
		),
	}),

	zValidator("json", FormModel.Copy.Body),

	async (c) => {
		const form = c.get("form");
		const { title, as_template } = c.req.valid("json") as FormModel.Copy.Body;
		if (
			as_template &&
			!PermissionHelper.can({
				authContext: AuthHandler.AuthContext.get(c),
				permission: "org_forms:manage",
			})
		) {
			return APIResponse.forbidden(c, "Only the core team manages templates");
		}

		const copy = await FormService.create({
			scope: as_template ? "template" : form.scope,
			eventId: form.event_id,
			title,
			from: form,
			userId: getAuthUserId(c),
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(copy),
			action: "create",
			entityType: "form",
			entityId: copy.id,
			summary: `${FormService.describe(copy)} als Kopie von ${FormService.describe(form)} angelegt`,
		});

		return APIResponse.created(c, "Form copied successfully", await FormService.details(copy));
	},
);

router.delete(
	"/:formId",

	APIRouteSpec.authenticated({
		summary: "Delete form",
		description: "Delete a form with all its answers (or a template). The link stops working.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Form deleted successfully"),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		const form = c.get("form");
		const answers = await FormService.remove(form);

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(form),
			action: "delete",
			entityType: "form",
			entityId: form.id,
			summary: `${FormService.describe(form)} gelöscht`,
			metadata: answers ? { responses: answers } : undefined,
		});

		return APIResponse.successNoData(c, "Form deleted successfully");
	},
);

router.get(
	"/:formId/responses",

	APIRouteSpec.authenticated({
		summary: "List form answers",
		description:
			"Every answer to the form, newest first (at most `FormAnswers.MAX_PER_FORM`, so the statistics and filters work in the browser). `answers` are by question id.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Answers retrieved successfully", FormModel.Responses.Response),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		return APIResponse.success(
			c,
			"Answers retrieved successfully",
			await FormService.responses(c.get("form")),
		);
	},
);

router.delete(
	"/:formId/responses/:responseId",

	APIRouteSpec.authenticated({
		summary: "Delete form answer",
		description: "Delete one answer, e.g. spam. Its number is not given to another answer.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Answer deleted successfully"),
			APIResponseSpec.notFound("Form not found / Answer not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("param", FormModel.Responses.Params),

	async (c) => {
		const form = c.get("form");
		const { responseId } = c.req.valid("param") as FormModel.Responses.Params;
		const [removed] = FormService.deleteResponses(form, responseId);
		if (!removed) return APIResponse.notFound(c, "Answer not found");

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(form),
			action: "delete",
			entityType: "form",
			entityId: form.id,
			summary: `Antwort Nr. ${removed.number} auf ${FormService.describe(form)} gelöscht`,
		});

		return APIResponse.successNoData(c, "Answer deleted successfully");
	},
);

router.delete(
	"/:formId/responses",

	APIRouteSpec.authenticated({
		summary: "Delete all form answers",
		description:
			"Delete every answer to the form, e.g. after a test run. Numbering starts at 1 again.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Answers deleted successfully"),
			APIResponseSpec.notFound("Form not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		const form = c.get("form");
		const removed = FormService.deleteResponses(form);
		if (removed.length) {
			await AuditLog.record({
				userId: getAuthUserId(c),
				eventId: auditEventId(form),
				action: "delete",
				entityType: "form",
				entityId: form.id,
				summary: `Alle ${removed.length} Antworten auf ${FormService.describe(form)} gelöscht`,
				metadata: { responses: removed.length },
			});
		}

		return APIResponse.successNoData(c, "Answers deleted successfully");
	},
);
