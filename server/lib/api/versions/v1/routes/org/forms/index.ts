import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { FormService } from "../../../../../../forms/service";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { getAuthUserId } from "../../../../../utils/guards";
import { PermissionHelper } from "../../../../../utils/permissions";
import { FormModel } from "../../../../../utils/shared-models/forms";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

/** The Kernteam's own forms (`scope = org`). Everything on one form: `/forms/{formId}`. */
export const router = new Hono().basePath("/forms");

const TAG = DOCS_TAGS.ORG.FORMS;
const FORBIDDEN = "Only the core team manages its forms";

function canManage(c: Context) {
	return PermissionHelper.can({
		authContext: AuthHandler.AuthContext.get(c),
		permission: "org_forms:manage",
	});
}

/** The Kernteam, who manages all of these. */
function viewer(c: Context) {
	return { userId: getAuthUserId(c), manage: true, contribute: false };
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List core team forms",
		description: "The Kernteam's forms with their status, link and number of answers.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Forms retrieved successfully", FormModel.List.Response),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		if (!canManage(c)) return APIResponse.forbidden(c, FORBIDDEN);
		return APIResponse.success(
			c,
			"Forms retrieved successfully",
			await FormService.list({ scope: "org" }, viewer(c)),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create core team form",
		description: "A new draft, empty or from a template (`template_id`).",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Form created successfully", FormModel.Details),
			APIResponseSpec.notFound("Template not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", FormModel.Create.Body),

	async (c) => {
		if (!canManage(c)) return APIResponse.forbidden(c, FORBIDDEN);
		const { title, template_id } = c.req.valid("json") as FormModel.Create.Body;
		const template = template_id === null ? null : await FormService.template(template_id);
		if (template_id !== null && !template) return APIResponse.notFound(c, "Template not found");

		const form = await FormService.create({
			scope: "org",
			eventId: null,
			title,
			from: template,
			userId: getAuthUserId(c),
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "create",
			entityType: "form",
			entityId: form.id,
			summary: `${FormService.describe(form)} angelegt${template ? ` (aus der Vorlage „${template.title}“)` : ""}`,
		});

		return APIResponse.created(
			c,
			"Form created successfully",
			await FormService.details(form, viewer(c)),
		);
	},
);
