import { and, asc, eq, inArray, ne } from "drizzle-orm";
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
import { EventRoomsModel } from "./model";

type RoomsEnv = {
	Variables: EventRouterEnv["Variables"] & { room: DB.Models.Room };
};

/** The handle of a synchronous transaction (see AGENTS.md › Transactions). */
type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export const router = new Hono<RoomsEnv>().basePath("/:eventId/rooms");

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

async function responsibleIdsOf(roomId: number) {
	const rows = await DB.instance()
		.select({ user_id: DB.Tables.roomResponsibles.user_id })
		.from(DB.Tables.roomResponsibles)
		.where(and(inOrg(DB.Tables.roomResponsibles), eq(DB.Tables.roomResponsibles.room_id, roomId)))
		.all();
	return rows.map((row) => row.user_id);
}

function replaceResponsibles(tx: Tx, roomId: number, userIds: number[]) {
	tx
		.delete(DB.Tables.roomResponsibles)
		.where(and(inOrg(DB.Tables.roomResponsibles), eq(DB.Tables.roomResponsibles.room_id, roomId)))
		.run();
	const unique = [...new Set(userIds)];
	if (unique.length) {
		tx
			.insert(DB.Tables.roomResponsibles)
			.values(unique.map((user_id) => ({ org_id: OrgContext.id(), room_id: roomId, user_id })))
			.run();
	}
}

async function notifyResponsibles(
	event: DB.Models.Event,
	room: DB.Models.Room,
	userIds: number[],
	actorId: number,
) {
	await Notifier.notify(
		userIds,
		{
			type: "room_assigned",
			title: `Zimmer: ${room.name}`,
			body: `Du bist für das Zimmer „${room.name}“ verantwortlich (${event.name}).`,
			link: `/events/${event.id}/rooms`,
		},
		{ excludeUserId: actorId },
	);
}

async function listRooms(eventId: number, onlyIds?: number[]): Promise<EventRoomsModel.Room[]> {
	const rooms = await DB.instance()
		.select()
		.from(DB.Tables.rooms)
		.where(
			and(
				inOrg(DB.Tables.rooms),
				eq(DB.Tables.rooms.event_id, eventId),
				onlyIds ? inArray(DB.Tables.rooms.id, onlyIds) : undefined,
			),
		)
		.orderBy(asc(DB.Tables.rooms.name))
		.all();
	if (rooms.length === 0) return [];
	const roomIds = rooms.map((room) => room.id);

	const participants = await DB.instance()
		.select({
			id: DB.Tables.participants.id,
			first_name: DB.Tables.participants.first_name,
			last_name: DB.Tables.participants.last_name,
			gender: DB.Tables.participants.gender,
			birth_date: DB.Tables.participants.birth_date,
			room_id: DB.Tables.participants.room_id,
		})
		.from(DB.Tables.participants)
		.where(
			and(
				inOrg(DB.Tables.participants),
				eq(DB.Tables.participants.event_id, eventId),
				inArray(DB.Tables.participants.room_id, roomIds),
				ne(DB.Tables.participants.status, "cancelled"),
			),
		)
		.orderBy(asc(DB.Tables.participants.last_name), asc(DB.Tables.participants.first_name))
		.all();

	const staff = await DB.instance()
		.select({ user_id: DB.Tables.eventMembers.user_id, room_id: DB.Tables.eventMembers.room_id })
		.from(DB.Tables.eventMembers)
		.where(
			and(
				inOrg(DB.Tables.eventMembers),
				eq(DB.Tables.eventMembers.event_id, eventId),
				inArray(DB.Tables.eventMembers.room_id, roomIds),
			),
		)
		.all();
	const responsibles = await DB.instance()
		.select()
		.from(DB.Tables.roomResponsibles)
		.where(
			and(inOrg(DB.Tables.roomResponsibles), inArray(DB.Tables.roomResponsibles.room_id, roomIds)),
		)
		.all();
	const users = await UserSummary.fetchMap([
		...staff.map((entry) => entry.user_id),
		...responsibles.map((entry) => entry.user_id),
	]);

	return rooms.map((room) => {
		const roomParticipants = participants
			.filter((participant) => participant.room_id === room.id)
			.map(({ room_id: _roomId, ...participant }) => participant);
		const roomStaff = staff
			.filter((entry) => entry.room_id === room.id)
			.map((entry) => users.get(entry.user_id))
			.filter((user): user is UserSummary.Schema => Boolean(user));
		return {
			...room,
			participants: roomParticipants,
			staff: roomStaff,
			responsibles: responsibles
				.filter((entry) => entry.room_id === room.id)
				.map((entry) => users.get(entry.user_id))
				.filter((user): user is UserSummary.Schema => Boolean(user))
				.sort((a, b) => a.display_name.localeCompare(b.display_name)),
			occupancy: roomParticipants.length + roomStaff.length,
		};
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event rooms",
		description: "List the rooms of an event with the participants and staff sleeping in them.",
		tags: [DOCS_TAGS.EVENTS.ROOMS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Rooms retrieved successfully", EventRoomsModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "rooms:view")) {
			return APIResponse.forbidden(c, "You are not a member of this event");
		}
		return APIResponse.success(c, "Rooms retrieved successfully", await listRooms(c.get("event").id));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event room",
		description:
			"Create a room, optionally with responsible staff (`responsible_ids`, staff of the event). Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.ROOMS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Room created successfully", EventRoomsModel.Create.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the rooms of this event"),
		),
	}),

	zValidator("json", EventRoomsModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "rooms:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the rooms of this event");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { responsible_ids, ...body } = c.req.valid("json") as EventRoomsModel.Create.Body;

		if (!(await areEventMembers(event.id, responsible_ids))) {
			return APIResponse.badRequest(c, "All responsible people must be staff of this event");
		}

		let room: DB.Models.Room;
		try {
			room = DB.instance().transaction((tx) => {
				const created = tx
					.insert(DB.Tables.rooms)
					.values({ ...body, event_id: event.id, org_id: OrgContext.id() })
					.returning()
					.get();
				replaceResponsibles(tx, created.id, responsible_ids);
				return created;
			});
		} catch (error: any) {
			Logger.error("Failed to create room", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create room");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "room",
			entityId: room.id,
			summary: `Zimmer „${room.name}“ angelegt`,
		});
		await notifyResponsibles(event, room, responsible_ids, userId);

		const [result] = await listRooms(event.id, [room.id]);
		return APIResponse.created(c, "Room created successfully", result!);
	},
);

// Registered before the `/:roomId/*` loader, so "assignments" is never parsed as a room id.
router.put(
	"/assignments",

	APIRouteSpec.authenticated({
		summary: "Assign rooms",
		description:
			"Assign participants and/or staff to rooms in one go (`room_id: null` removes the assignment). Over-capacity is allowed. Returns all rooms.",
		tags: [DOCS_TAGS.EVENTS.ROOMS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Room assignments updated successfully",
				EventRoomsModel.Assignments.Response,
			),
			APIResponseSpec.badRequest(
				"Unknown room, participant or staff member for this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the rooms of this event"),
		),
	}),

	zValidator("json", EventRoomsModel.Assignments.Body),

	async (c) => {
		if (!EventAccess.can(c, "rooms:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the rooms of this event");
		}

		const event = c.get("event");
		const body = c.req.valid("json") as EventRoomsModel.Assignments.Body;
		const participantAssignments = body.participants ?? [];
		const staffAssignments = body.staff ?? [];

		const roomIds = [
			...new Set(
				[...participantAssignments, ...staffAssignments]
					.map((entry) => entry.room_id)
					.filter((id): id is number => id !== null),
			),
		];
		const participantIds = [...new Set(participantAssignments.map((entry) => entry.participant_id))];
		const userIds = [...new Set(staffAssignments.map((entry) => entry.user_id))];

		const [validRooms, validParticipants, validStaff] = await Promise.all([
			roomIds.length
				? DB.instance()
						.select({ id: DB.Tables.rooms.id })
						.from(DB.Tables.rooms)
						.where(
							and(
								inOrg(DB.Tables.rooms),
								eq(DB.Tables.rooms.event_id, event.id),
								inArray(DB.Tables.rooms.id, roomIds),
							),
						)
						.all()
				: [],
			participantIds.length
				? DB.instance()
						.select({ id: DB.Tables.participants.id })
						.from(DB.Tables.participants)
						.where(
							and(
								inOrg(DB.Tables.participants),
								eq(DB.Tables.participants.event_id, event.id),
								inArray(DB.Tables.participants.id, participantIds),
							),
						)
						.all()
				: [],
			userIds.length
				? DB.instance()
						.select({ user_id: DB.Tables.eventMembers.user_id })
						.from(DB.Tables.eventMembers)
						.where(
							and(
								inOrg(DB.Tables.eventMembers),
								eq(DB.Tables.eventMembers.event_id, event.id),
								inArray(DB.Tables.eventMembers.user_id, userIds),
							),
						)
						.all()
				: [],
		]);

		if (
			validRooms.length !== roomIds.length ||
			validParticipants.length !== participantIds.length ||
			validStaff.length !== userIds.length
		) {
			return APIResponse.badRequest(c, "Unknown room, participant or staff member for this event");
		}

		try {
			await DB.instance().transaction(async (tx: DrizzleDB) => {
				for (const entry of participantAssignments) {
					await tx
						.update(DB.Tables.participants)
						.set({ room_id: entry.room_id, updated_at: Date.now() })
						.where(
							and(
								inOrg(DB.Tables.participants),
								eq(DB.Tables.participants.id, entry.participant_id),
								eq(DB.Tables.participants.event_id, event.id),
							),
						)
						.run();
				}
				for (const entry of staffAssignments) {
					await tx
						.update(DB.Tables.eventMembers)
						.set({ room_id: entry.room_id })
						.where(
							and(
								inOrg(DB.Tables.eventMembers),
								eq(DB.Tables.eventMembers.user_id, entry.user_id),
								eq(DB.Tables.eventMembers.event_id, event.id),
							),
						)
						.run();
				}
			});
		} catch (error: any) {
			Logger.error("Failed to update room assignments", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update room assignments");
		}

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "assign",
			entityType: "room",
			summary: `Zimmerbelegung geändert (${participantAssignments.length} Teilnehmer, ${staffAssignments.length} Mitarbeiter)`,
		});

		return APIResponse.success(c, "Room assignments updated successfully", await listRooms(event.id));
	},
);

router.use("/:roomId/*", zValidator("param", EventRoomsModel.Params), async (c, next) => {
	const event = c.get("event");
	const roomId = EventRoomsModel.Params.shape.roomId.safeParse(c.req.param("roomId"));
	if (!roomId.success) return APIResponse.badRequest(c, "Invalid room id");

	const room = await DB.instance()
		.select()
		.from(DB.Tables.rooms)
		.where(
			and(
				inOrg(DB.Tables.rooms),
				eq(DB.Tables.rooms.id, roomId.data),
				eq(DB.Tables.rooms.event_id, event.id),
			),
		)
		.get();

	if (!room) return APIResponse.notFound(c, "Room not found");

	c.set("room", room);
	await next();
});

router.put(
	"/:roomId",

	APIRouteSpec.authenticated({
		summary: "Update event room",
		description:
			"Update a room's name, capacity, notes or responsible staff (`responsible_ids` replaces the set). Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.ROOMS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Room updated successfully", EventRoomsModel.Update.Response),
			APIResponseSpec.notFound("Room not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the rooms of this event"),
		),
	}),

	zValidator("json", EventRoomsModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "rooms:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the rooms of this event");
		}

		const event = c.get("event");
		const room = c.get("room");
		const { userId } = c.get("eventAccess");
		const { responsible_ids, ...fields } = c.req.valid("json") as EventRoomsModel.Update.Body;

		if (responsible_ids && !(await areEventMembers(event.id, responsible_ids))) {
			return APIResponse.badRequest(c, "All responsible people must be staff of this event");
		}
		const previousResponsibles = responsible_ids ? await responsibleIdsOf(room.id) : [];

		let updated: DB.Models.Room;
		try {
			updated = DB.instance().transaction((tx) => {
				const row =
					Object.keys(fields).length > 0
						? tx
								.update(DB.Tables.rooms)
								.set(fields)
								.where(and(inOrg(DB.Tables.rooms), eq(DB.Tables.rooms.id, room.id)))
								.returning()
								.get()
						: room;
				if (responsible_ids) replaceResponsibles(tx, room.id, responsible_ids);
				return row;
			});
		} catch (error: any) {
			Logger.error("Failed to update room", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update room");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "room",
			entityId: room.id,
			summary: `Zimmer „${updated.name}“ bearbeitet`,
		});
		if (responsible_ids) {
			const added = responsible_ids.filter((id) => !previousResponsibles.includes(id));
			await notifyResponsibles(event, updated, added, userId);
		}

		const [result] = await listRooms(event.id, [room.id]);
		return APIResponse.success(c, "Room updated successfully", result!);
	},
);

router.delete(
	"/:roomId",

	APIRouteSpec.authenticated({
		summary: "Delete event room",
		description: "Delete a room. Its participants and staff become unassigned.",
		tags: [DOCS_TAGS.EVENTS.ROOMS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Room deleted successfully"),
			APIResponseSpec.notFound("Room not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the rooms of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "rooms:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the rooms of this event");
		}

		const room = c.get("room");
		await DB.instance()
			.delete(DB.Tables.rooms)
			.where(and(inOrg(DB.Tables.rooms), eq(DB.Tables.rooms.id, room.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "room",
			entityId: room.id,
			summary: `Zimmer „${room.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Room deleted successfully");
	},
);
