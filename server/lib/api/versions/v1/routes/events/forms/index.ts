import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { FormService } from "../../../../../../forms/service";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { FormModel } from "../../../../../utils/shared-models/forms";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

/**
 * An event's forms, for its Leitung (`forms:manage`) — the answers may hold personal data, so the
 * rest of the team doesn't see them. Everything on one form: `/forms/{formId}`.
 */
export const router = new Hono<EventRouterEnv>().basePath("/:eventId/forms");

const TAG = DOCS_TAGS.EVENTS.FORMS;
const FORBIDDEN = "Only the event's leaders manage its forms";

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event forms",
		description: "The event's forms with their status, link and number of answers.",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Forms retrieved successfully", FormModel.List.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "forms:manage")) return APIResponse.forbidden(c, FORBIDDEN);
		return APIResponse.success(
			c,
			"Forms retrieved successfully",
			await FormService.list({ scope: "event", eventId: c.get("event").id }),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event form",
		description: "A new draft in the event, empty or from a template (`template_id`).",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Form created successfully", FormModel.Details),
			APIResponseSpec.notFound("Event not found / Template not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", FormModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "forms:manage")) return APIResponse.forbidden(c, FORBIDDEN);
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { title, template_id } = c.req.valid("json") as FormModel.Create.Body;
		const template = template_id === null ? null : await FormService.template(template_id);
		if (template_id !== null && !template) return APIResponse.notFound(c, "Template not found");

		const form = await FormService.create({
			scope: "event",
			eventId: event.id,
			title,
			from: template,
			userId,
		});

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "form",
			entityId: form.id,
			summary: `${FormService.describe(form)} angelegt${template ? ` (aus der Vorlage „${template.title}“)` : ""}`,
		});

		return APIResponse.created(c, "Form created successfully", await FormService.details(form));
	},
);
