import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { Notifier } from "../../../../../utils/notifications";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventResponsibilitiesModel } from "./model";

type ResponsibilitiesEnv = {
	Variables: EventRouterEnv["Variables"] & { responsibility: DB.Models.Responsibility };
};

export const router = new Hono<ResponsibilitiesEnv>().basePath("/:eventId/responsibilities");

/** True when every id is a staff member of the event. */
async function areEventMembers(eventId: number, userIds: number[]) {
	const unique = [...new Set(userIds)];
	if (unique.length === 0) return true;
	const rows = await DB.instance()
		.select({ user_id: DB.Tables.eventMembers.user_id })
		.from(DB.Tables.eventMembers)
		.where(
			and(
				inOrg(DB.Tables.eventMembers),
				eq(DB.Tables.eventMembers.event_id, eventId),
				inArray(DB.Tables.eventMembers.user_id, unique),
			),
		)
		.all();
	return rows.length === unique.length;
}

async function getAssigneeIds(responsibilityId: number, tx: DrizzleDB = DB.instance()) {
	const rows = await tx
		.select({ user_id: DB.Tables.responsibilityAssignees.user_id })
		.from(DB.Tables.responsibilityAssignees)
		.where(
			and(
				inOrg(DB.Tables.responsibilityAssignees),
				eq(DB.Tables.responsibilityAssignees.responsibility_id, responsibilityId),
			),
		)
		.all();
	return rows.map((row) => row.user_id);
}

async function replaceAssignees(responsibilityId: number, userIds: number[], tx: DrizzleDB) {
	await tx
		.delete(DB.Tables.responsibilityAssignees)
		.where(
			and(
				inOrg(DB.Tables.responsibilityAssignees),
				eq(DB.Tables.responsibilityAssignees.responsibility_id, responsibilityId),
			),
		)
		.run();
	const unique = [...new Set(userIds)];
	if (unique.length) {
		await tx
			.insert(DB.Tables.responsibilityAssignees)
			.values(
				unique.map((user_id) => ({
					org_id: OrgContext.id(),
					responsibility_id: responsibilityId,
					user_id,
				})),
			)
			.run();
	}
}

async function toResponse(
	responsibilities: DB.Models.Responsibility[],
): Promise<EventResponsibilitiesModel.Responsibility[]> {
	if (responsibilities.length === 0) return [];
	const assignments = await DB.instance()
		.select()
		.from(DB.Tables.responsibilityAssignees)
		.where(
			and(
				inOrg(DB.Tables.responsibilityAssignees),
				inArray(
					DB.Tables.responsibilityAssignees.responsibility_id,
					responsibilities.map((entry) => entry.id),
				),
			),
		)
		.all();
	const users = await UserSummary.fetchMap(assignments.map((entry) => entry.user_id));

	return responsibilities.map((responsibility) => ({
		...responsibility,
		assignees: assignments
			.filter((entry) => entry.responsibility_id === responsibility.id)
			.map((entry) => users.get(entry.user_id))
			.filter((user): user is UserSummary.Schema => Boolean(user))
			.sort((a, b) => a.display_name.localeCompare(b.display_name)),
	}));
}

async function notifyAssignees(
	event: DB.Models.Event,
	responsibility: DB.Models.Responsibility,
	userIds: number[],
	actorId: number,
) {
	await Notifier.notify(
		userIds,
		{
			type: "responsibility_assigned",
			title: `Neue Zuständigkeit: ${responsibility.title}`,
			body: event.name,
			link: `/events/${event.id}/responsibilities`,
		},
		{ excludeUserId: actorId },
	);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List responsibilities",
		description: "List the standing responsibilities of an event and who is assigned to them.",
		tags: [DOCS_TAGS.EVENTS.RESPONSIBILITIES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Responsibilities retrieved successfully",
				EventResponsibilitiesModel.GetAll.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "responsibilities:view")) {
			return APIResponse.forbidden(c, "You are not a member of this event");
		}

		const rows = await DB.instance()
			.select()
			.from(DB.Tables.responsibilities)
			.where(
				and(
					inOrg(DB.Tables.responsibilities),
					eq(DB.Tables.responsibilities.event_id, c.get("event").id),
				),
			)
			.orderBy(asc(DB.Tables.responsibilities.title))
			.all();

		return APIResponse.success(c, "Responsibilities retrieved successfully", await toResponse(rows));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create responsibility",
		description:
			"Create a responsibility (e.g. Erste Hilfe, Getränke) and assign staff to it. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.RESPONSIBILITIES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Responsibility created successfully",
				EventResponsibilitiesModel.Create.Response,
			),
			APIResponseSpec.badRequest(
				"All assignees must be staff of this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the responsibilities of this event"),
		),
	}),

	zValidator("json", EventResponsibilitiesModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "responsibilities:manage")) {
			return APIResponse.forbidden(
				c,
				"You are not allowed to manage the responsibilities of this event",
			);
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { assignee_ids, ...body } = c.req.valid("json") as EventResponsibilitiesModel.Create.Body;

		if (!(await areEventMembers(event.id, assignee_ids))) {
			return APIResponse.badRequest(c, "All assignees must be staff of this event");
		}

		try {
			const responsibility = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const created = await tx
					.insert(DB.Tables.responsibilities)
					.values({ ...body, event_id: event.id, org_id: OrgContext.id() })
					.returning()
					.get();
				await replaceAssignees(created.id, assignee_ids, tx);
				return created;
			});

			await AuditLog.record({
				userId,
				eventId: event.id,
				action: "create",
				entityType: "responsibility",
				entityId: responsibility.id,
				summary: `Zuständigkeit „${responsibility.title}“ angelegt`,
			});

			await notifyAssignees(event, responsibility, assignee_ids, userId);

			const [result] = await toResponse([responsibility]);
			return APIResponse.created(c, "Responsibility created successfully", result!);
		} catch (error: any) {
			Logger.error("Failed to create responsibility", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create responsibility");
		}
	},
);

router.use(
	"/:responsibilityId/*",
	zValidator("param", EventResponsibilitiesModel.Params),
	async (c, next) => {
		const event = c.get("event");
		const responsibilityId = EventResponsibilitiesModel.Params.shape.responsibilityId.safeParse(
			c.req.param("responsibilityId"),
		);
		if (!responsibilityId.success) return APIResponse.badRequest(c, "Invalid responsibility id");

		const responsibility = await DB.instance()
			.select()
			.from(DB.Tables.responsibilities)
			.where(
				and(
					inOrg(DB.Tables.responsibilities),
					eq(DB.Tables.responsibilities.id, responsibilityId.data),
					eq(DB.Tables.responsibilities.event_id, event.id),
				),
			)
			.get();

		if (!responsibility) return APIResponse.notFound(c, "Responsibility not found");

		c.set("responsibility", responsibility);
		await next();
	},
);

router.put(
	"/:responsibilityId",

	APIRouteSpec.authenticated({
		summary: "Update responsibility",
		description:
			"Update a responsibility. `assignee_ids` replaces the assignee set; newly assigned staff are notified.",
		tags: [DOCS_TAGS.EVENTS.RESPONSIBILITIES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Responsibility updated successfully",
				EventResponsibilitiesModel.Update.Response,
			),
			APIResponseSpec.badRequest(
				"All assignees must be staff of this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Responsibility not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the responsibilities of this event"),
		),
	}),

	zValidator("json", EventResponsibilitiesModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "responsibilities:manage")) {
			return APIResponse.forbidden(
				c,
				"You are not allowed to manage the responsibilities of this event",
			);
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const responsibility = c.get("responsibility");
		const { assignee_ids, ...fields } = c.req.valid("json") as EventResponsibilitiesModel.Update.Body;

		if (assignee_ids && !(await areEventMembers(event.id, assignee_ids))) {
			return APIResponse.badRequest(c, "All assignees must be staff of this event");
		}

		const previousAssignees = await getAssigneeIds(responsibility.id);

		try {
			const updated = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const row =
					Object.keys(fields).length > 0
						? await tx
								.update(DB.Tables.responsibilities)
								.set(fields)
								.where(
									and(
										inOrg(DB.Tables.responsibilities),
										eq(DB.Tables.responsibilities.id, responsibility.id),
									),
								)
								.returning()
								.get()
						: responsibility;
				if (assignee_ids) await replaceAssignees(responsibility.id, assignee_ids, tx);
				return row;
			});

			await AuditLog.record({
				userId,
				eventId: event.id,
				action: "update",
				entityType: "responsibility",
				entityId: responsibility.id,
				summary: `Zuständigkeit „${updated.title}“ bearbeitet`,
			});

			if (assignee_ids) {
				const added = assignee_ids.filter((id) => !previousAssignees.includes(id));
				await notifyAssignees(event, updated, added, userId);
			}

			const [result] = await toResponse([updated]);
			return APIResponse.success(c, "Responsibility updated successfully", result!);
		} catch (error: any) {
			Logger.error("Failed to update responsibility", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update responsibility");
		}
	},
);

router.delete(
	"/:responsibilityId",

	APIRouteSpec.authenticated({
		summary: "Delete responsibility",
		description: "Delete a responsibility and its assignments. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.RESPONSIBILITIES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Responsibility deleted successfully"),
			APIResponseSpec.notFound("Responsibility not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the responsibilities of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "responsibilities:manage")) {
			return APIResponse.forbidden(
				c,
				"You are not allowed to manage the responsibilities of this event",
			);
		}

		const responsibility = c.get("responsibility");
		await DB.instance()
			.delete(DB.Tables.responsibilities)
			.where(
				and(inOrg(DB.Tables.responsibilities), eq(DB.Tables.responsibilities.id, responsibility.id)),
			)
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "responsibility",
			entityId: responsibility.id,
			summary: `Zuständigkeit „${responsibility.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Responsibility deleted successfully");
	},
);
