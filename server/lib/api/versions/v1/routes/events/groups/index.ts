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
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventGroupsModel } from "./model";

type GroupsEnv = {
	Variables: EventRouterEnv["Variables"] & { group: DB.Models.EventGroup };
};

export const router = new Hono<GroupsEnv>().basePath("/:eventId/groups");

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

async function replaceMembers(groupId: number, userIds: number[], tx: DrizzleDB) {
	await tx
		.delete(DB.Tables.eventGroupMembers)
		.where(and(inOrg(DB.Tables.eventGroupMembers), eq(DB.Tables.eventGroupMembers.group_id, groupId)))
		.run();
	const unique = [...new Set(userIds)];
	if (unique.length) {
		await tx
			.insert(DB.Tables.eventGroupMembers)
			.values(unique.map((user_id) => ({ org_id: OrgContext.id(), group_id: groupId, user_id })))
			.run();
	}
}

async function toResponse(groups: DB.Models.EventGroup[]): Promise<EventGroupsModel.Group[]> {
	if (groups.length === 0) return [];
	const memberships = await DB.instance()
		.select()
		.from(DB.Tables.eventGroupMembers)
		.where(
			and(
				inOrg(DB.Tables.eventGroupMembers),
				inArray(
					DB.Tables.eventGroupMembers.group_id,
					groups.map((group) => group.id),
				),
			),
		)
		.all();
	const users = await UserSummary.fetchMap(memberships.map((membership) => membership.user_id));

	return groups.map((group) => {
		const members = memberships
			.filter((membership) => membership.group_id === group.id)
			.map((membership) => users.get(membership.user_id))
			.filter((user): user is UserSummary.Schema => Boolean(user))
			.sort((a, b) => a.display_name.localeCompare(b.display_name));
		return { ...group, members, member_count: members.length };
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event groups",
		description: "List the staff sub-groups of an event (e.g. Küchenteam) with their members.",
		tags: [DOCS_TAGS.EVENTS.GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Groups retrieved successfully", EventGroupsModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "groups:view")) {
			return APIResponse.forbidden(c, "You are not a member of this event");
		}

		const groups = await DB.instance()
			.select()
			.from(DB.Tables.eventGroups)
			.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.event_id, c.get("event").id)))
			.orderBy(asc(DB.Tables.eventGroups.name))
			.all();

		return APIResponse.success(c, "Groups retrieved successfully", await toResponse(groups));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event group",
		description:
			"Create a staff sub-group. Members must be staff of the event. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Group created successfully", EventGroupsModel.Create.Response),
			APIResponseSpec.badRequest(
				"All group members must be staff of this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the groups of this event"),
		),
	}),

	zValidator("json", EventGroupsModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the groups of this event");
		}

		const event = c.get("event");
		const { member_ids, ...body } = c.req.valid("json") as EventGroupsModel.Create.Body;

		if (!(await areEventMembers(event.id, member_ids))) {
			return APIResponse.badRequest(c, "All group members must be staff of this event");
		}

		try {
			const group = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const created = await tx
					.insert(DB.Tables.eventGroups)
					.values({ ...body, event_id: event.id, org_id: OrgContext.id() })
					.returning()
					.get();
				await replaceMembers(created.id, member_ids, tx);
				return created;
			});

			await AuditLog.record({
				userId: c.get("eventAccess").userId,
				eventId: event.id,
				action: "create",
				entityType: "event_group",
				entityId: group.id,
				summary: `Gruppe „${group.name}“ angelegt`,
			});

			const [result] = await toResponse([group]);
			return APIResponse.created(c, "Group created successfully", result!);
		} catch (error: any) {
			Logger.error("Failed to create group", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create group");
		}
	},
);

router.use("/:groupId/*", zValidator("param", EventGroupsModel.Params), async (c, next) => {
	const event = c.get("event");
	const groupId = EventGroupsModel.Params.shape.groupId.safeParse(c.req.param("groupId"));
	if (!groupId.success) return APIResponse.badRequest(c, "Invalid group id");

	const group = await DB.instance()
		.select()
		.from(DB.Tables.eventGroups)
		.where(
			and(
				inOrg(DB.Tables.eventGroups),
				eq(DB.Tables.eventGroups.id, groupId.data),
				eq(DB.Tables.eventGroups.event_id, event.id),
			),
		)
		.get();

	if (!group) return APIResponse.notFound(c, "Group not found");

	c.set("group", group);
	await next();
});

router.put(
	"/:groupId",

	APIRouteSpec.authenticated({
		summary: "Update event group",
		description:
			"Update a group's name, description, color or members (`member_ids` replaces the member set).",
		tags: [DOCS_TAGS.EVENTS.GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Group updated successfully", EventGroupsModel.Update.Response),
			APIResponseSpec.badRequest(
				"All group members must be staff of this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Group not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the groups of this event"),
		),
	}),

	zValidator("json", EventGroupsModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the groups of this event");
		}

		const event = c.get("event");
		const group = c.get("group");
		const { member_ids, ...fields } = c.req.valid("json") as EventGroupsModel.Update.Body;

		if (member_ids && !(await areEventMembers(event.id, member_ids))) {
			return APIResponse.badRequest(c, "All group members must be staff of this event");
		}

		try {
			const updated = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const row =
					Object.keys(fields).length > 0
						? await tx
								.update(DB.Tables.eventGroups)
								.set(fields)
								.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.id, group.id)))
								.returning()
								.get()
						: group;
				if (member_ids) await replaceMembers(group.id, member_ids, tx);
				return row;
			});

			await AuditLog.record({
				userId: c.get("eventAccess").userId,
				eventId: event.id,
				action: "update",
				entityType: "event_group",
				entityId: group.id,
				summary: `Gruppe „${updated.name}“ bearbeitet`,
				metadata: { fields: Object.keys(c.req.valid("json") as object) },
			});

			const [result] = await toResponse([updated]);
			return APIResponse.success(c, "Group updated successfully", result!);
		} catch (error: any) {
			Logger.error("Failed to update group", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update group");
		}
	},
);

router.delete(
	"/:groupId",

	APIRouteSpec.authenticated({
		summary: "Delete event group",
		description: "Delete a group. Its chat channel and group notes are deleted with it.",
		tags: [DOCS_TAGS.EVENTS.GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Group deleted successfully"),
			APIResponseSpec.notFound("Group not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the groups of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the groups of this event");
		}

		const group = c.get("group");
		await DB.instance()
			.delete(DB.Tables.eventGroups)
			.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.id, group.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "event_group",
			entityId: group.id,
			summary: `Gruppe „${group.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Group deleted successfully");
	},
);
