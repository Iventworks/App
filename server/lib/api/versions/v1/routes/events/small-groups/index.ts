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
import { EventSmallGroupsModel } from "./model";

type SmallGroupsEnv = {
	Variables: EventRouterEnv["Variables"] & { smallGroup: DB.Models.SmallGroup };
};

/** The handle of a synchronous transaction (see AGENTS.md › Transactions). */
type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

/**
 * "Kleingruppen": small groups of participants, each led by staff of the event. A participant is
 * in at most one group (`participants.small_group_id`); a staff member may lead several.
 */
export const router = new Hono<SmallGroupsEnv>().basePath("/:eventId/small-groups");

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

async function leaderIdsOf(smallGroupId: number) {
	const rows = await DB.instance()
		.select({ user_id: DB.Tables.smallGroupLeaders.user_id })
		.from(DB.Tables.smallGroupLeaders)
		.where(
			and(
				inOrg(DB.Tables.smallGroupLeaders),
				eq(DB.Tables.smallGroupLeaders.small_group_id, smallGroupId),
			),
		)
		.all();
	return rows.map((row) => row.user_id);
}

function replaceLeaders(tx: Tx, smallGroupId: number, userIds: number[]) {
	tx
		.delete(DB.Tables.smallGroupLeaders)
		.where(
			and(
				inOrg(DB.Tables.smallGroupLeaders),
				eq(DB.Tables.smallGroupLeaders.small_group_id, smallGroupId),
			),
		)
		.run();
	const unique = [...new Set(userIds)];
	if (unique.length) {
		tx
			.insert(DB.Tables.smallGroupLeaders)
			.values(
				unique.map((user_id) => ({
					org_id: OrgContext.id(),
					small_group_id: smallGroupId,
					user_id,
				})),
			)
			.run();
	}
}

async function notifyLeaders(
	event: DB.Models.Event,
	group: DB.Models.SmallGroup,
	userIds: number[],
	actorId: number,
) {
	await Notifier.notify(
		userIds,
		{
			type: "small_group_assigned",
			title: `Kleingruppe: ${group.name}`,
			body: `Du leitest die Kleingruppe „${group.name}“ (${event.name}).`,
			link: `/events/${event.id}/small-groups`,
		},
		{ excludeUserId: actorId },
	);
}

async function listSmallGroups(
	eventId: number,
	onlyIds?: number[],
): Promise<EventSmallGroupsModel.SmallGroup[]> {
	const groups = await DB.instance()
		.select()
		.from(DB.Tables.smallGroups)
		.where(
			and(
				inOrg(DB.Tables.smallGroups),
				eq(DB.Tables.smallGroups.event_id, eventId),
				onlyIds ? inArray(DB.Tables.smallGroups.id, onlyIds) : undefined,
			),
		)
		.orderBy(asc(DB.Tables.smallGroups.name))
		.all();
	if (groups.length === 0) return [];
	const groupIds = groups.map((group) => group.id);

	const leaders = await DB.instance()
		.select()
		.from(DB.Tables.smallGroupLeaders)
		.where(
			and(
				inOrg(DB.Tables.smallGroupLeaders),
				inArray(DB.Tables.smallGroupLeaders.small_group_id, groupIds),
			),
		)
		.all();
	const users = await UserSummary.fetchMap(leaders.map((leader) => leader.user_id));

	const participants = await DB.instance()
		.select({
			id: DB.Tables.participants.id,
			first_name: DB.Tables.participants.first_name,
			last_name: DB.Tables.participants.last_name,
			gender: DB.Tables.participants.gender,
			birth_date: DB.Tables.participants.birth_date,
			status: DB.Tables.participants.status,
			small_group_id: DB.Tables.participants.small_group_id,
		})
		.from(DB.Tables.participants)
		.where(
			and(
				inOrg(DB.Tables.participants),
				eq(DB.Tables.participants.event_id, eventId),
				inArray(DB.Tables.participants.small_group_id, groupIds),
				inArray(DB.Tables.participants.status, EventSmallGroupsModel.MEMBER_STATUSES),
			),
		)
		.orderBy(asc(DB.Tables.participants.last_name), asc(DB.Tables.participants.first_name))
		.all();

	return groups.map((group) => {
		const members = participants
			.filter((participant) => participant.small_group_id === group.id)
			.map(({ small_group_id: _groupId, ...participant }) => participant);
		return {
			...group,
			leaders: leaders
				.filter((leader) => leader.small_group_id === group.id)
				.map((leader) => users.get(leader.user_id))
				.filter((user): user is UserSummary.Schema => Boolean(user))
				.sort((a, b) => a.display_name.localeCompare(b.display_name)),
			participants: members,
			participant_count: members.length,
		};
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List small groups",
		description:
			'List the "Kleingruppen" of an event with the staff leading them and their participants.',
		tags: [DOCS_TAGS.EVENTS.SMALL_GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Small groups retrieved successfully",
				EventSmallGroupsModel.GetAll.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "small_groups:view")) {
			return APIResponse.forbidden(c, "You are not a member of this event");
		}
		return APIResponse.success(
			c,
			"Small groups retrieved successfully",
			await listSmallGroups(c.get("event").id),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create small group",
		description:
			"Create a Kleingruppe. Its leaders must be staff of the event. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.SMALL_GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Small group created successfully",
				EventSmallGroupsModel.Create.Response,
			),
			APIResponseSpec.badRequest(
				"All leaders must be staff of this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the small groups of this event"),
		),
	}),

	zValidator("json", EventSmallGroupsModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "small_groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the small groups of this event");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { leader_ids, ...body } = c.req.valid("json") as EventSmallGroupsModel.Create.Body;

		if (!(await areEventMembers(event.id, leader_ids))) {
			return APIResponse.badRequest(c, "All leaders must be staff of this event");
		}

		let group: DB.Models.SmallGroup;
		try {
			group = DB.instance().transaction((tx) => {
				const created = tx
					.insert(DB.Tables.smallGroups)
					.values({ ...body, event_id: event.id, org_id: OrgContext.id() })
					.returning()
					.get();
				replaceLeaders(tx, created.id, leader_ids);
				return created;
			});
		} catch (error: any) {
			Logger.error("Failed to create small group", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create small group");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "small_group",
			entityId: group.id,
			summary: `Kleingruppe „${group.name}“ angelegt`,
		});
		await notifyLeaders(event, group, leader_ids, userId);

		const [result] = await listSmallGroups(event.id, [group.id]);
		return APIResponse.created(c, "Small group created successfully", result!);
	},
);

// Registered before the `/:smallGroupId/*` loader, so "assignments" is never parsed as an id.
router.put(
	"/assignments",

	APIRouteSpec.authenticated({
		summary: "Assign participants to small groups",
		description:
			"Put participants into Kleingruppen in one go (`small_group_id: null` takes them out). A participant is in at most one group. Returns all groups.",
		tags: [DOCS_TAGS.EVENTS.SMALL_GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Small group assignments updated successfully",
				EventSmallGroupsModel.Assignments.Response,
			),
			APIResponseSpec.badRequest(
				"Unknown small group or participant for this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the small groups of this event"),
		),
	}),

	zValidator("json", EventSmallGroupsModel.Assignments.Body),

	async (c) => {
		if (!EventAccess.can(c, "small_groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the small groups of this event");
		}

		const event = c.get("event");
		const { participants: assignments } = c.req.valid(
			"json",
		) as EventSmallGroupsModel.Assignments.Body;

		const groupIds = [
			...new Set(
				assignments.map((entry) => entry.small_group_id).filter((id): id is number => id !== null),
			),
		];
		const participantIds = [...new Set(assignments.map((entry) => entry.participant_id))];

		const [validGroups, validParticipants] = await Promise.all([
			groupIds.length
				? DB.instance()
						.select({ id: DB.Tables.smallGroups.id })
						.from(DB.Tables.smallGroups)
						.where(
							and(
								inOrg(DB.Tables.smallGroups),
								eq(DB.Tables.smallGroups.event_id, event.id),
								inArray(DB.Tables.smallGroups.id, groupIds),
							),
						)
						.all()
				: [],
			DB.instance()
				.select({ id: DB.Tables.participants.id })
				.from(DB.Tables.participants)
				.where(
					and(
						inOrg(DB.Tables.participants),
						eq(DB.Tables.participants.event_id, event.id),
						inArray(DB.Tables.participants.id, participantIds),
					),
				)
				.all(),
		]);

		if (
			validGroups.length !== groupIds.length ||
			validParticipants.length !== participantIds.length
		) {
			return APIResponse.badRequest(c, "Unknown small group or participant for this event");
		}

		try {
			DB.instance().transaction((tx) => {
				const now = Date.now();
				for (const entry of assignments) {
					tx
						.update(DB.Tables.participants)
						.set({ small_group_id: entry.small_group_id, updated_at: now })
						.where(
							and(
								inOrg(DB.Tables.participants),
								eq(DB.Tables.participants.id, entry.participant_id),
								eq(DB.Tables.participants.event_id, event.id),
							),
						)
						.run();
				}
			});
		} catch (error: any) {
			Logger.error("Failed to update small group assignments", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update small group assignments");
		}

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "assign",
			entityType: "small_group",
			summary: `Kleingruppen-Einteilung geändert (${assignments.length} Teilnehmende)`,
		});

		return APIResponse.success(
			c,
			"Small group assignments updated successfully",
			await listSmallGroups(event.id),
		);
	},
);

router.use(
	"/:smallGroupId/*",
	zValidator("param", EventSmallGroupsModel.Params),
	async (c, next) => {
		const event = c.get("event");
		const smallGroupId = EventSmallGroupsModel.Params.shape.smallGroupId.safeParse(
			c.req.param("smallGroupId"),
		);
		if (!smallGroupId.success) return APIResponse.badRequest(c, "Invalid small group id");

		const group = await DB.instance()
			.select()
			.from(DB.Tables.smallGroups)
			.where(
				and(
					inOrg(DB.Tables.smallGroups),
					eq(DB.Tables.smallGroups.id, smallGroupId.data),
					eq(DB.Tables.smallGroups.event_id, event.id),
				),
			)
			.get();

		if (!group) return APIResponse.notFound(c, "Small group not found");

		c.set("smallGroup", group);
		await next();
	},
);

router.put(
	"/:smallGroupId",

	APIRouteSpec.authenticated({
		summary: "Update small group",
		description:
			"Update a Kleingruppe's name, description, meeting point, colour or leaders (`leader_ids` replaces the set).",
		tags: [DOCS_TAGS.EVENTS.SMALL_GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Small group updated successfully",
				EventSmallGroupsModel.Update.Response,
			),
			APIResponseSpec.badRequest(
				"All leaders must be staff of this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Small group not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the small groups of this event"),
		),
	}),

	zValidator("json", EventSmallGroupsModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "small_groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the small groups of this event");
		}

		const event = c.get("event");
		const group = c.get("smallGroup");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventSmallGroupsModel.Update.Body;
		const { leader_ids, ...fields } = body;

		if (leader_ids && !(await areEventMembers(event.id, leader_ids))) {
			return APIResponse.badRequest(c, "All leaders must be staff of this event");
		}
		const previousLeaders = leader_ids ? await leaderIdsOf(group.id) : [];

		let updated: DB.Models.SmallGroup;
		try {
			updated = DB.instance().transaction((tx) => {
				const row =
					Object.keys(fields).length > 0
						? tx
								.update(DB.Tables.smallGroups)
								.set(fields)
								.where(and(inOrg(DB.Tables.smallGroups), eq(DB.Tables.smallGroups.id, group.id)))
								.returning()
								.get()
						: group;
				if (leader_ids) replaceLeaders(tx, group.id, leader_ids);
				return row;
			});
		} catch (error: any) {
			Logger.error("Failed to update small group", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update small group");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "small_group",
			entityId: group.id,
			summary: `Kleingruppe „${updated.name}“ bearbeitet`,
			metadata: { fields: Object.keys(body) },
		});
		if (leader_ids) {
			const added = leader_ids.filter((id) => !previousLeaders.includes(id));
			await notifyLeaders(event, updated, added, userId);
		}

		const [result] = await listSmallGroups(event.id, [group.id]);
		return APIResponse.success(c, "Small group updated successfully", result!);
	},
);

router.delete(
	"/:smallGroupId",

	APIRouteSpec.authenticated({
		summary: "Delete small group",
		description: "Delete a Kleingruppe. Its participants are no longer in a group.",
		tags: [DOCS_TAGS.EVENTS.SMALL_GROUPS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Small group deleted successfully"),
			APIResponseSpec.notFound("Small group not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the small groups of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "small_groups:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the small groups of this event");
		}

		const group = c.get("smallGroup");
		await DB.instance()
			.delete(DB.Tables.smallGroups)
			.where(and(inOrg(DB.Tables.smallGroups), eq(DB.Tables.smallGroups.id, group.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "small_group",
			entityId: group.id,
			summary: `Kleingruppe „${group.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Small group deleted successfully");
	},
);
