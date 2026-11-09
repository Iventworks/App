import { and, asc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
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
import { EventMembersModel } from "./model";

type MembersEnv = {
	Variables: EventRouterEnv["Variables"] & { member: DB.Models.EventMember };
};

export const router = new Hono<MembersEnv>().basePath("/:eventId/members");

const ROLE_LABELS: Record<DB.Models.EventMember["role"], string> = {
	leader: "Leitung",
	staff: "Mitarbeiter",
};

async function toResponse(
	c: Context<MembersEnv>,
	members: DB.Models.EventMember[],
): Promise<EventMembersModel.Member[]> {
	if (members.length === 0) return [];
	const event = c.get("event");
	const showLeaderNotes = EventAccess.can(c, "members:view_leader_notes");

	const users = await UserSummary.fetchMap(members.map((member) => member.user_id));

	const userIds = members.map((member) => member.user_id);
	const groupRows = await DB.instance()
		.select({
			user_id: DB.Tables.eventGroupMembers.user_id,
			id: DB.Tables.eventGroups.id,
			name: DB.Tables.eventGroups.name,
			color: DB.Tables.eventGroups.color,
		})
		.from(DB.Tables.eventGroupMembers)
		.innerJoin(
			DB.Tables.eventGroups,
			and(
				inOrg(DB.Tables.eventGroups),
				eq(DB.Tables.eventGroups.id, DB.Tables.eventGroupMembers.group_id),
			),
		)
		.where(
			and(
				inOrg(DB.Tables.eventGroupMembers),
				eq(DB.Tables.eventGroups.event_id, event.id),
				inArray(DB.Tables.eventGroupMembers.user_id, userIds),
			),
		)
		.orderBy(asc(DB.Tables.eventGroups.name))
		.all();

	const roomIds = [
		...new Set(members.map((member) => member.room_id).filter((id): id is number => id !== null)),
	];
	const rooms = roomIds.length
		? await DB.instance()
				.select({ id: DB.Tables.rooms.id, name: DB.Tables.rooms.name })
				.from(DB.Tables.rooms)
				.where(and(inOrg(DB.Tables.rooms), inArray(DB.Tables.rooms.id, roomIds)))
				.all()
		: [];

	return members
		.filter((member) => users.has(member.user_id))
		.map(({ org_id: _orgId, ...member }) => ({
			...member,
			leader_notes: showLeaderNotes ? member.leader_notes : "",
			user: users.get(member.user_id)!,
			groups: groupRows
				.filter((row) => row.user_id === member.user_id)
				.map(({ id, name, color }) => ({ id, name, color })),
			room: rooms.find((room) => room.id === member.room_id) ?? null,
		}));
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event staff",
		description:
			"List the leaders and staff of an event with their groups and room. Leader notes are only included for leaders.",
		tags: [DOCS_TAGS.EVENTS.MEMBERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Members retrieved successfully", EventMembersModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "members:view")) {
			return APIResponse.forbidden(c, "You are not a member of this event");
		}

		const members = await DB.instance()
			.select()
			.from(DB.Tables.eventMembers)
			.where(
				and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.event_id, c.get("event").id)),
			)
			.orderBy(asc(DB.Tables.eventMembers.role), asc(DB.Tables.eventMembers.id))
			.all();

		return APIResponse.success(c, "Members retrieved successfully", await toResponse(c, members));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Add event staff member",
		description: "Add a user to the event as leader or staff. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.MEMBERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Member added successfully", EventMembersModel.Create.Response),
			APIResponseSpec.badRequest(
				"The user's account has not been activated yet / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found / User not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the staff of this event"),
			APIResponseSpec.conflict("The user is already a member of this event"),
		),
	}),

	zValidator("json", EventMembersModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "members:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the staff of this event");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventMembersModel.Create.Body;

		const user = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, body.user_id)))
			.get();
		if (!user) return APIResponse.notFound(c, "User not found");
		if (user.role === "unverified") {
			return APIResponse.badRequest(c, "The user's account has not been activated yet");
		}

		const existing = await DB.instance()
			.select({ id: DB.Tables.eventMembers.id })
			.from(DB.Tables.eventMembers)
			.where(
				and(
					inOrg(DB.Tables.eventMembers),
					eq(DB.Tables.eventMembers.event_id, event.id),
					eq(DB.Tables.eventMembers.user_id, user.id),
				),
			)
			.get();
		if (existing) return APIResponse.conflict(c, "The user is already a member of this event");

		const member = await DB.instance()
			.insert(DB.Tables.eventMembers)
			.values({
				org_id: OrgContext.id(),
				event_id: event.id,
				user_id: user.id,
				role: body.role,
				position: body.position,
			})
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "assign",
			entityType: "event_member",
			entityId: member.id,
			summary: `${user.display_name} als ${ROLE_LABELS[member.role]} hinzugefügt`,
		});

		await Notifier.notify(
			[user.id],
			{
				type: "event_added",
				title:
					member.role === "leader"
						? `Du leitest „${event.name}“`
						: `Du bist im Team von „${event.name}“`,
				body:
					member.role === "leader"
						? "Du wurdest als Leitung eingetragen."
						: "Du wurdest als Mitarbeiter eingetragen.",
				link: `/events/${event.id}`,
			},
			{ excludeUserId: userId },
		);

		const [result] = await toResponse(c, [member]);
		return APIResponse.created(c, "Member added successfully", result!);
	},
);

router.use("/:memberId/*", zValidator("param", EventMembersModel.Params), async (c, next) => {
	const event = c.get("event");
	const memberId = EventMembersModel.Params.shape.memberId.safeParse(c.req.param("memberId"));
	if (!memberId.success) return APIResponse.badRequest(c, "Invalid member id");

	const member = await DB.instance()
		.select()
		.from(DB.Tables.eventMembers)
		.where(
			and(
				inOrg(DB.Tables.eventMembers),
				eq(DB.Tables.eventMembers.id, memberId.data),
				eq(DB.Tables.eventMembers.event_id, event.id),
			),
		)
		.get();

	if (!member) return APIResponse.notFound(c, "Member not found");

	c.set("member", member);
	await next();
});

router.put(
	"/:memberId",

	APIRouteSpec.authenticated({
		summary: "Update event staff member",
		description:
			"Change a staff member's role, position, room or the leader-only notes. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.MEMBERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Member updated successfully", EventMembersModel.Update.Response),
			APIResponseSpec.badRequest(
				"The room does not belong to this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Member not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the staff of this event"),
		),
	}),

	zValidator("json", EventMembersModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "members:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the staff of this event");
		}

		const event = c.get("event");
		const member = c.get("member");
		const body = c.req.valid("json") as EventMembersModel.Update.Body;

		if (body.room_id) {
			const room = await DB.instance()
				.select({ id: DB.Tables.rooms.id })
				.from(DB.Tables.rooms)
				.where(
					and(
						inOrg(DB.Tables.rooms),
						eq(DB.Tables.rooms.id, body.room_id),
						eq(DB.Tables.rooms.event_id, event.id),
					),
				)
				.get();
			if (!room) return APIResponse.badRequest(c, "The room does not belong to this event");
		}

		const updated = await DB.instance()
			.update(DB.Tables.eventMembers)
			.set(body)
			.where(and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.id, member.id)))
			.returning()
			.get();

		const users = await UserSummary.fetchMap([member.user_id]);
		const name = users.get(member.user_id)?.display_name ?? "Mitarbeiter";

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "update",
			entityType: "event_member",
			entityId: member.id,
			summary:
				body.role && body.role !== member.role
					? `${name} ist jetzt ${ROLE_LABELS[body.role]}`
					: `Teammitglied ${name} bearbeitet`,
			metadata: { fields: Object.keys(body) },
		});

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Member updated successfully", result!);
	},
);

router.delete(
	"/:memberId",

	APIRouteSpec.authenticated({
		summary: "Remove event staff member",
		description:
			"Remove a user from the event. Their group memberships, program and responsibility assignments in this event are removed and their tasks become unassigned.",
		tags: [DOCS_TAGS.EVENTS.MEMBERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Member removed successfully"),
			APIResponseSpec.notFound("Member not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the staff of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "members:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the staff of this event");
		}

		const event = c.get("event");
		const member = c.get("member");
		const users = await UserSummary.fetchMap([member.user_id]);

		try {
			await DB.instance().transaction(async (tx: DrizzleDB) => {
				const groupIds = (
					await tx
						.select({ id: DB.Tables.eventGroups.id })
						.from(DB.Tables.eventGroups)
						.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.event_id, event.id)))
						.all()
				).map((row) => row.id);
				if (groupIds.length) {
					await tx
						.delete(DB.Tables.eventGroupMembers)
						.where(
							and(
								inOrg(DB.Tables.eventGroupMembers),
								inArray(DB.Tables.eventGroupMembers.group_id, groupIds),
								eq(DB.Tables.eventGroupMembers.user_id, member.user_id),
							),
						)
						.run();
				}

				const programIds = (
					await tx
						.select({ id: DB.Tables.programItems.id })
						.from(DB.Tables.programItems)
						.where(and(inOrg(DB.Tables.programItems), eq(DB.Tables.programItems.event_id, event.id)))
						.all()
				).map((row) => row.id);
				if (programIds.length) {
					await tx
						.delete(DB.Tables.programItemResponsibles)
						.where(
							and(
								inOrg(DB.Tables.programItemResponsibles),
								inArray(DB.Tables.programItemResponsibles.program_item_id, programIds),
								eq(DB.Tables.programItemResponsibles.user_id, member.user_id),
							),
						)
						.run();
				}

				const responsibilityIds = (
					await tx
						.select({ id: DB.Tables.responsibilities.id })
						.from(DB.Tables.responsibilities)
						.where(
							and(inOrg(DB.Tables.responsibilities), eq(DB.Tables.responsibilities.event_id, event.id)),
						)
						.all()
				).map((row) => row.id);
				if (responsibilityIds.length) {
					await tx
						.delete(DB.Tables.responsibilityAssignees)
						.where(
							and(
								inOrg(DB.Tables.responsibilityAssignees),
								inArray(DB.Tables.responsibilityAssignees.responsibility_id, responsibilityIds),
								eq(DB.Tables.responsibilityAssignees.user_id, member.user_id),
							),
						)
						.run();
				}

				await tx
					.update(DB.Tables.tasks)
					.set({ assignee_id: null, updated_at: Date.now() })
					.where(
						and(
							inOrg(DB.Tables.tasks),
							eq(DB.Tables.tasks.event_id, event.id),
							eq(DB.Tables.tasks.assignee_id, member.user_id),
						),
					)
					.run();

				await tx
					.delete(DB.Tables.eventMembers)
					.where(and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.id, member.id)))
					.run();
			});
		} catch (error: any) {
			Logger.error("Failed to remove event member", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to remove member");
		}

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "unassign",
			entityType: "event_member",
			entityId: member.id,
			summary: `${users.get(member.user_id)?.display_name ?? "Mitarbeiter"} aus dem Team entfernt`,
		});

		return APIResponse.successNoData(c, "Member removed successfully");
	},
);
