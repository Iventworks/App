import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { FormService, type FormViewer } from "../../../../../../forms/service";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { FormModel } from "../../../../../utils/shared-models/forms";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

/**
 * An event's forms. The team (`forms:view` / `forms:create`) sees the list, creates forms and
 * works on the team's forms; the Leitung (`forms:manage`) works on all of them and keeps a form
 * for itself (`leaders_only`: the answers may hold personal data) — the rest of the team then
 * only sees that it exists. Everything on one form: `/forms/{formId}`.
 */
export const router = new Hono<EventRouterEnv>().basePath("/:eventId/forms");

const TAG = DOCS_TAGS.EVENTS.FORMS;
const FORBIDDEN_VIEW = "You are not allowed to see the forms of this event";
const FORBIDDEN_CREATE = "You are not allowed to create forms in this event";
const FORBIDDEN_RESTRICT = "Only the event's leaders keep a form for themselves";

function viewer(c: Context<EventRouterEnv>): FormViewer {
	return {
		userId: c.get("eventAccess").userId,
		manage: EventAccess.can(c, "forms:manage"),
		contribute: EventAccess.can(c, "forms:create"),
	};
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event forms",
		description:
			"The event's forms with their status, link and number of answers, and what the caller may do with each. A form for the Leitung only shows the rest of the team just its title and status.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Forms retrieved successfully", FormModel.List.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN_VIEW),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "forms:view")) return APIResponse.forbidden(c, FORBIDDEN_VIEW);
		return APIResponse.success(
			c,
			"Forms retrieved successfully",
			await FormService.list({ scope: "event", eventId: c.get("event").id }, viewer(c)),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event form",
		description:
			"A new draft in the event, empty or from a template (`template_id`). Anyone on the team; `leaders_only` (only the Leitung works on it) is the Leitung's choice.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Form created successfully", FormModel.Details),
			APIResponseSpec.notFound("Event not found / Template not found"),
			APIResponseSpec.forbidden(`${FORBIDDEN_CREATE} / ${FORBIDDEN_RESTRICT}`),
		),
	}),

	zValidator("json", FormModel.CreateInEvent.Body),

	async (c) => {
		if (!EventAccess.can(c, "forms:create")) return APIResponse.forbidden(c, FORBIDDEN_CREATE);
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { title, template_id, leaders_only } = c.req.valid("json") as FormModel.CreateInEvent.Body;
		if (leaders_only && !EventAccess.can(c, "forms:manage")) {
			return APIResponse.forbidden(c, FORBIDDEN_RESTRICT);
		}
		const template = template_id === null ? null : await FormService.template(template_id);
		if (template_id !== null && !template) return APIResponse.notFound(c, "Template not found");

		const form = await FormService.create({
			scope: "event",
			eventId: event.id,
			title,
			from: template,
			userId,
			leadersOnly: leaders_only,
		});

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "form",
			entityId: form.id,
			summary: `${FormService.describe(form)} angelegt${template ? ` (aus der Vorlage „${template.title}“)` : ""}${leaders_only ? ", nur für die Leitung" : ""}`,
		});

		return APIResponse.created(
			c,
			"Form created successfully",
			await FormService.details(form, viewer(c)),
		);
	},
);
