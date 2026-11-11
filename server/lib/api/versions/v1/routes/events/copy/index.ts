import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { Logger } from "../../../../../../utils/logger";
import { Recurrence } from "../../../../../../utils/recurrence";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import type { EventRouterEnv } from "../../../../../utils/eventAccess";
import { EventCopier } from "../../../../../utils/eventCopy";
import { Notifier } from "../../../../../utils/notifications";
import { PermissionHelper } from "../../../../../utils/permissions";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { withAccess } from "../view";
import { EventCopyModel } from "./model";

/** Copy an event: "the same camp again next year". */
export const router = new Hono<EventRouterEnv>().basePath("/:eventId/copy");

const FORBIDDEN = "Only the core team can copy events";

const PART_LABELS: Record<EventCopier.Part, string> = {
	team: "Team",
	groups: "Gruppen",
	rooms: "Zimmer",
	responsibilities: "Zuständigkeiten",
	program: "Programm",
	tasks: "Aufgaben",
	notes: "Notizen",
	announcements: "Neuigkeiten",
	budget: "Budgetplanung",
	documents: "Dokumente",
	resources: "Ressourcen",
	participants: "Teilnehmende",
};

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Preview event copy",
		description:
			"How much there is to copy, per part — for the dialog that picks what to take along.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Copy summary retrieved successfully", EventCopyModel.Summary.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (!PermissionHelper.can({ authContext, permission: "events:create" })) {
			return APIResponse.forbidden(c, FORBIDDEN);
		}
		return APIResponse.success(
			c,
			"Copy summary retrieved successfully",
			await EventCopier.summary(c.get("event")),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Copy event",
		description:
			"Create a new event from this one: the master data, plus the parts chosen in `include` (team, groups, rooms, responsibilities, program, tasks, notes, news, budget lines, documents, resource bookings, participants). Program items and due dates move with the new start date; tasks are open again; a recurring event gets the dates of its rule in the new range. Expenses, chats, the audit log and notes about participants are never copied. The copy starts in status `planning`. Requires the core team role.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Event copied successfully", EventCopyModel.Response),
			APIResponseSpec.badRequest(
				"end_date must not be before start_date / The recurrence has no date between start_date and end_date / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", EventCopyModel.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		if (!PermissionHelper.can({ authContext, permission: "events:create" })) {
			return APIResponse.forbidden(c, FORBIDDEN);
		}

		const source = c.get("event");
		const body = c.req.valid("json") as EventCopyModel.Body;

		const endDate =
			body.end_date ??
			TimeUtils.addDays(body.start_date, TimeUtils.diffDays(source.start_date, source.end_date));
		if (endDate < body.start_date) {
			return APIResponse.badRequest(c, "end_date must not be before start_date");
		}
		if (source.type === "recurring" && source.recurrence) {
			const problem = Recurrence.validate(source.recurrence, body.start_date, endDate);
			if (problem) return APIResponse.badRequest(c, problem);
		}

		let result: EventCopier.Result;
		try {
			result = await EventCopier.copy(source, {
				name: body.name,
				start_date: body.start_date,
				end_date: endDate,
				include: body.include,
				userId: authContext.user_id,
			});
		} catch (error: any) {
			Logger.error("Failed to copy event", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to copy event");
		}

		const { event } = result;
		const parts = EventCopier.PARTS.filter((part) => body.include[part]);

		await AuditLog.record({
			userId: authContext.user_id,
			eventId: event.id,
			action: "create",
			entityType: "event",
			entityId: event.id,
			summary: `„${event.name}“ als Kopie von „${source.name}“ angelegt`,
			metadata: {
				source_event_id: source.id,
				copied: parts.map((part) => PART_LABELS[part]),
				...(result.skipped_bookings.length ? { skipped_bookings: result.skipped_bookings } : {}),
				...(result.skipped_files ? { skipped_files: result.skipped_files } : {}),
			},
		});

		for (const role of ["leader", "staff"] as const) {
			await Notifier.notify(
				result.team.filter((member) => member.role === role).map((member) => member.user_id),
				{
					type: "event_added",
					title:
						role === "leader" ? `Du leitest „${event.name}“` : `Du bist im Team von „${event.name}“`,
					body: `Übernommen aus „${source.name}“.`,
					link: `/events/${event.id}`,
				},
				{ excludeUserId: authContext.user_id },
			);
		}

		const [eventWithAccess] = await withAccess([event], authContext);
		return APIResponse.created(c, "Event copied successfully", {
			event: eventWithAccess!,
			skipped_bookings: result.skipped_bookings,
			skipped_files: result.skipped_files,
		} satisfies EventCopyModel.Response);
	},
);
