import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { EventGroupsModel } from "../server/lib/api/versions/v1/routes/events/groups/model";
import { EventInsightsModel } from "../server/lib/api/versions/v1/routes/events/insights/model";
import { EventMembersModel } from "../server/lib/api/versions/v1/routes/events/members/model";
import { EventResponsibilitiesModel } from "../server/lib/api/versions/v1/routes/events/responsibilities/model";
import { EventRoomsModel } from "../server/lib/api/versions/v1/routes/events/rooms/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { makeAPIRequest } from "./helpers/api";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let coreTeam: SeededUser;
let leader: SeededUser;
let staff: SeededUser;
let staff2: SeededUser;
let newcomer: SeededUser;
let outsider: SeededUser;
let unverified: SeededUser;

let coreSession: SeededSession;
let leaderSession: SeededSession;
let staffSession: SeededSession;
let outsiderSession: SeededSession;

let eventId: number;
let otherEventId: number;

function seedParticipant(event_id: number, overrides: Partial<DB.Models.Participant> = {}) {
	return DB.instance()
		.insert(DB.Tables.participants)
		.values({
			org_id: OrgContext.id(),
			event_id,
			first_name: "Max",
			last_name: "Muster",
			...overrides,
		})
		.returning()
		.get();
}

beforeAll(async () => {
	coreTeam = await seedUser("core_team");
	leader = await seedUser("volunteer", { display_name: "Lea Leitung" });
	staff = await seedUser("volunteer", { display_name: "Sam Staff" });
	staff2 = await seedUser("volunteer", { display_name: "Kim Küche" });
	newcomer = await seedUser("volunteer", { display_name: "Nina Neu" });
	outsider = await seedUser("volunteer");
	unverified = await seedUser("unverified");

	coreSession = await seedSession(coreTeam.id);
	leaderSession = await seedSession(leader.id);
	staffSession = await seedSession(staff.id);
	outsiderSession = await seedSession(outsider.id);

	const event = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: {
			name: "Zeltlager 2027",
			start_date: "2027-07-01",
			end_date: "2027-07-10",
			participant_fee_cents: 25000,
			budget_cents: 500000,
			leader_ids: [leader.id],
		},
	});
	eventId = event.id;

	const other = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: { name: "Anderes Event", start_date: "2027-08-01", end_date: "2027-08-02" },
	});
	otherEventId = other.id;

	await addEventMember(eventId, staff.id, "staff");
	await addEventMember(eventId, staff2.id, "staff");
});

describe("Event members", () => {
	let newcomerMemberId: number;

	test("staff can list members, leader notes are hidden from them", async () => {
		const leaderMember = DB.instance()
			.select()
			.from(DB.Tables.eventMembers)
			.where(
				and(eq(DB.Tables.eventMembers.event_id, eventId), eq(DB.Tables.eventMembers.user_id, staff.id)),
			)
			.get()!;
		await makeAPIRequest(`/v1/events/${eventId}/members/${leaderMember.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { leader_notes: "Zuverlässig", position: "Erste Hilfe" },
		});

		const asStaff = await makeAPIRequest(`/v1/events/${eventId}/members`, {
			authToken: staffSession.token,
			expectedBodySchema: EventMembersModel.GetAll.Response,
		});
		expect(asStaff.length).toBe(3);
		expect(asStaff.every((member) => member.leader_notes === "")).toBe(true);

		const asLeader = await makeAPIRequest(`/v1/events/${eventId}/members`, {
			authToken: leaderSession.token,
			expectedBodySchema: EventMembersModel.GetAll.Response,
		});
		const sam = asLeader.find((member) => member.user_id === staff.id)!;
		expect(sam.leader_notes).toBe("Zuverlässig");
		expect(sam.position).toBe("Erste Hilfe");
		expect(sam.user.display_name).toBe("Sam Staff");
	});

	test("outsiders get 403", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/members`, { authToken: outsiderSession.token }, 403);
	});

	test("only leaders add members; validation errors", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/members`,
			{ method: "POST", authToken: staffSession.token, body: { user_id: newcomer.id } },
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/members`,
			{ method: "POST", authToken: leaderSession.token, body: { user_id: 999999 } },
			404,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/members`,
			{ method: "POST", authToken: leaderSession.token, body: { user_id: unverified.id } },
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/members`,
			{ method: "POST", authToken: leaderSession.token, body: { user_id: staff.id } },
			409,
		);

		const member = await makeAPIRequest(`/v1/events/${eventId}/members`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { user_id: newcomer.id, position: "Musik" },
			expectedBodySchema: EventMembersModel.Create.Response,
		});
		expect(member.role).toBe("staff");
		newcomerMemberId = member.id;

		const notification = DB.instance()
			.select()
			.from(DB.Tables.notifications)
			.where(eq(DB.Tables.notifications.user_id, newcomer.id))
			.all();
		expect(notification.some((n) => n.type === "event_added")).toBe(true);
	});

	test("rejects a room of another event", async () => {
		const foreignRoom = DB.instance()
			.insert(DB.Tables.rooms)
			.values({ org_id: OrgContext.id(), event_id: otherEventId, name: "Fremd" })
			.returning()
			.get();
		await makeAPIRequest(
			`/v1/events/${eventId}/members/${newcomerMemberId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { room_id: foreignRoom.id } },
			400,
		);
	});

	test("unknown member id is 404", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/members/999999`,
			{ method: "PUT", authToken: leaderSession.token, body: { position: "x" } },
			404,
		);
	});

	test("removing a member cleans up their assignments", async () => {
		const group = await makeAPIRequest(`/v1/events/${eventId}/groups`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { name: "Musikteam", member_ids: [newcomer.id] },
		});
		const responsibility = await makeAPIRequest(`/v1/events/${eventId}/responsibilities`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { title: "Gitarren", assignee_ids: [newcomer.id] },
		});
		const program = DB.instance()
			.insert(DB.Tables.programItems)
			.values({
				org_id: OrgContext.id(),
				event_id: eventId,
				title: "Lobpreis",
				start_at: 1,
				end_at: 2,
			})
			.returning()
			.get();
		DB.instance()
			.insert(DB.Tables.programItemResponsibles)
			.values({ org_id: OrgContext.id(), program_item_id: program.id, user_id: newcomer.id })
			.run();
		const task = DB.instance()
			.insert(DB.Tables.tasks)
			.values({
				org_id: OrgContext.id(),
				event_id: eventId,
				title: "Noten drucken",
				assignee_id: newcomer.id,
			})
			.returning()
			.get();

		await makeAPIRequest(
			`/v1/events/${eventId}/members/${newcomerMemberId}`,
			{ method: "DELETE", authToken: staffSession.token },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}/members/${newcomerMemberId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});

		const db = DB.instance();
		expect(
			db
				.select()
				.from(DB.Tables.eventGroupMembers)
				.where(eq(DB.Tables.eventGroupMembers.group_id, group.id))
				.all(),
		).toEqual([]);
		expect(
			db
				.select()
				.from(DB.Tables.responsibilityAssignees)
				.where(eq(DB.Tables.responsibilityAssignees.responsibility_id, responsibility.id))
				.all(),
		).toEqual([]);
		expect(
			db
				.select()
				.from(DB.Tables.programItemResponsibles)
				.where(eq(DB.Tables.programItemResponsibles.program_item_id, program.id))
				.all(),
		).toEqual([]);
		expect(
			db.select().from(DB.Tables.tasks).where(eq(DB.Tables.tasks.id, task.id)).get()?.assignee_id,
		).toBeNull();

		// The removed member loses access to the event.
		const newcomerSession = await seedSession(newcomer.id);
		await makeAPIRequest(`/v1/events/${eventId}`, { authToken: newcomerSession.token }, 403);
	});
});

describe("Event groups", () => {
	let groupId: number;

	test("leaders create groups with event members only", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/groups`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { name: "Küchenteam", member_ids: [outsider.id] },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/groups`,
			{ method: "POST", authToken: staffSession.token, body: { name: "Küchenteam" } },
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/groups`,
			{ method: "POST", authToken: leaderSession.token, body: { name: "X", color: "rot" } },
			400,
		);

		const group = await makeAPIRequest(`/v1/events/${eventId}/groups`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { name: "Küchenteam", color: "#f97316", member_ids: [staff2.id, staff.id] },
			expectedBodySchema: EventGroupsModel.Create.Response,
		});
		expect(group.member_count).toBe(2);
		expect(group.members.map((member) => member.display_name)).toEqual(["Kim Küche", "Sam Staff"]);
		groupId = group.id;
	});

	test("member_ids replaces the set; staff can list", async () => {
		const updated = await makeAPIRequest(`/v1/events/${eventId}/groups/${groupId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { member_ids: [staff2.id], description: "Kocht" },
			expectedBodySchema: EventGroupsModel.Update.Response,
		});
		expect(updated.members.map((member) => member.id)).toEqual([staff2.id]);
		expect(updated.description).toBe("Kocht");

		const list = await makeAPIRequest(`/v1/events/${eventId}/groups`, {
			authToken: staffSession.token,
			expectedBodySchema: EventGroupsModel.GetAll.Response,
		});
		expect(list.some((group) => group.id === groupId)).toBe(true);
	});

	test("a group of another event is 404; delete works", async () => {
		await makeAPIRequest(
			`/v1/events/${otherEventId}/groups/${groupId}`,
			{ method: "DELETE", authToken: coreSession.token },
			404,
		);
		await makeAPIRequest(`/v1/events/${eventId}/groups/${groupId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/groups/${groupId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { name: "y" } },
			404,
		);
	});
});

describe("Event rooms", () => {
	let roomA: number;
	let roomB: number;
	let participantId: number;

	test("leaders manage rooms", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/rooms`,
			{ method: "POST", authToken: staffSession.token, body: { name: "Zimmer 1" } },
			403,
		);
		const a = await makeAPIRequest(`/v1/events/${eventId}/rooms`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { name: "Zimmer 1", capacity: 1 },
			expectedBodySchema: EventRoomsModel.Create.Response,
		});
		const b = await makeAPIRequest(`/v1/events/${eventId}/rooms`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { name: "Zimmer 2", capacity: 4, notes: "Etage 2" },
		});
		roomA = a.id;
		roomB = b.id;

		const renamed = await makeAPIRequest(`/v1/events/${eventId}/rooms/${roomA}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { name: "Zimmer 1a" },
			expectedBodySchema: EventRoomsModel.Update.Response,
		});
		expect(renamed.name).toBe("Zimmer 1a");
	});

	test("bulk assignments (over capacity allowed) and validation", async () => {
		participantId = seedParticipant(eventId, { first_name: "Mia", gender: "female" }).id;
		const second = seedParticipant(eventId, { first_name: "Ben", gender: "male" }).id;
		const foreignParticipant = seedParticipant(otherEventId).id;

		await makeAPIRequest(
			`/v1/events/${eventId}/rooms/assignments`,
			{
				method: "PUT",
				authToken: leaderSession.token,
				body: { participants: [{ participant_id: foreignParticipant, room_id: roomA }] },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/rooms/assignments`,
			{
				method: "PUT",
				authToken: leaderSession.token,
				body: { staff: [{ user_id: outsider.id, room_id: roomA }] },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/rooms/assignments`,
			{
				method: "PUT",
				authToken: staffSession.token,
				body: { participants: [{ participant_id: participantId, room_id: roomA }] },
			},
			403,
		);

		const rooms = await makeAPIRequest(`/v1/events/${eventId}/rooms/assignments`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: {
				participants: [
					{ participant_id: participantId, room_id: roomA },
					{ participant_id: second, room_id: roomA },
				],
				staff: [{ user_id: staff.id, room_id: roomB }],
			},
			expectedBodySchema: EventRoomsModel.Assignments.Response,
		});
		const a = rooms.find((room) => room.id === roomA)!;
		expect(a.occupancy).toBe(2);
		expect(a.participants.map((p) => p.first_name).sort()).toEqual(["Ben", "Mia"]);
		expect(rooms.find((room) => room.id === roomB)!.staff.map((user) => user.id)).toEqual([staff.id]);

		// Staff see the rooms too.
		const list = await makeAPIRequest(`/v1/events/${eventId}/rooms`, {
			authToken: staffSession.token,
			expectedBodySchema: EventRoomsModel.GetAll.Response,
		});
		expect(list.length).toBe(2);

		const unassigned = await makeAPIRequest(`/v1/events/${eventId}/rooms/assignments`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { participants: [{ participant_id: second, room_id: null }] },
		});
		expect(unassigned.find((room: any) => room.id === roomA).occupancy).toBe(1);
	});

	test("deleting a room unassigns its occupants", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/rooms/${roomB}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		const member = DB.instance()
			.select()
			.from(DB.Tables.eventMembers)
			.where(
				and(eq(DB.Tables.eventMembers.event_id, eventId), eq(DB.Tables.eventMembers.user_id, staff.id)),
			)
			.get();
		expect(member?.room_id).toBeNull();
		await makeAPIRequest(
			`/v1/events/${eventId}/rooms/${roomB}`,
			{ method: "DELETE", authToken: leaderSession.token },
			404,
		);
	});
});

describe("Event responsibilities", () => {
	let responsibilityId: number;

	test("leaders create responsibilities; assignees are notified", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/responsibilities`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { title: "Erste Hilfe", assignee_ids: [outsider.id] },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/responsibilities`,
			{ method: "POST", authToken: staffSession.token, body: { title: "Erste Hilfe" } },
			403,
		);

		const responsibility = await makeAPIRequest(`/v1/events/${eventId}/responsibilities`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { title: "Erste Hilfe", location: "Haus 1", assignee_ids: [staff.id] },
			expectedBodySchema: EventResponsibilitiesModel.Create.Response,
		});
		expect(responsibility.assignees.map((user) => user.id)).toEqual([staff.id]);
		responsibilityId = responsibility.id;

		const notifications = DB.instance()
			.select()
			.from(DB.Tables.notifications)
			.where(eq(DB.Tables.notifications.user_id, staff.id))
			.all();
		expect(notifications.some((n) => n.type === "responsibility_assigned")).toBe(true);
	});

	test("assignee_ids replaces the set; staff can view", async () => {
		const updated = await makeAPIRequest(
			`/v1/events/${eventId}/responsibilities/${responsibilityId}`,
			{
				method: "PUT",
				authToken: leaderSession.token,
				body: { assignee_ids: [staff2.id, staff.id] },
				expectedBodySchema: EventResponsibilitiesModel.Update.Response,
			},
		);
		expect(updated.assignees.length).toBe(2);

		const list = await makeAPIRequest(`/v1/events/${eventId}/responsibilities`, {
			authToken: staffSession.token,
			expectedBodySchema: EventResponsibilitiesModel.GetAll.Response,
		});
		expect(list.find((entry) => entry.id === responsibilityId)?.location).toBe("Haus 1");
	});

	test("delete and 404", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/responsibilities/${responsibilityId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/responsibilities/${responsibilityId}`,
			{ method: "DELETE", authToken: leaderSession.token },
			404,
		);
	});
});

describe("Event insights", () => {
	test("stats are leader-only and well-formed", async () => {
		seedParticipant(eventId, {
			first_name: "Alt",
			birth_date: "1990-01-01",
			allergies: "Nüsse",
			fee_paid: true,
		});
		seedParticipant(eventId, { first_name: "Weg", status: "cancelled" });
		DB.instance()
			.insert(DB.Tables.expenses)
			.values([
				{
					org_id: OrgContext.id(),
					event_id: eventId,
					title: "Brot",
					category: "Essen",
					amount_cents: 1200,
					spent_on: "2027-07-02",
					status: "approved",
				},
				{
					org_id: OrgContext.id(),
					event_id: eventId,
					title: "Seile",
					category: "Material",
					amount_cents: 800,
					spent_on: "2027-07-02",
				},
			])
			.run();

		await makeAPIRequest(`/v1/events/${eventId}/stats`, { authToken: staffSession.token }, 403);

		const stats = await makeAPIRequest(`/v1/events/${eventId}/stats`, {
			authToken: leaderSession.token,
			expectedBodySchema: EventInsightsModel.Stats.Response,
		});
		expect(stats.participants.total).toBe(3);
		expect(stats.participants.by_status.cancelled).toBe(1);
		expect(stats.participants.with_allergies).toBe(1);
		expect(stats.participants.age_buckets.find((bucket) => bucket.label === "26+")?.count).toBe(1);
		expect(stats.finances.expected_fees_cents).toBe(25000 * 3);
		expect(stats.finances.expenses_by_status.approved).toBe(1200);
		expect(stats.finances.expenses_by_status.submitted).toBe(800);
		expect(stats.finances.expenses_by_category).toEqual([{ category: "Essen", amount_cents: 1200 }]);
		expect(stats.staff.leaders).toBe(1);
	});

	test("audit log is leader-only and contains this event's entries", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/audit-log`, { authToken: staffSession.token }, 403);

		const log = await makeAPIRequest(`/v1/events/${eventId}/audit-log?limit=5`, {
			authToken: leaderSession.token,
			expectedBodySchema: EventInsightsModel.AuditLog.Response,
		});
		expect(log.total).toBeGreaterThan(5);
		expect(log.entries.length).toBe(5);
		expect(log.entries.every((entry) => entry.event_id === eventId)).toBe(true);

		const rooms = await makeAPIRequest(`/v1/events/${eventId}/audit-log?entity_type=room`, {
			authToken: coreSession.token,
			expectedBodySchema: EventInsightsModel.AuditLog.Response,
		});
		expect(rooms.entries.length).toBeGreaterThan(0);
		expect(rooms.entries.every((entry) => entry.entity_type === "room")).toBe(true);
		expect(rooms.entries[0]!.user?.id).toBe(leader.id);

		await makeAPIRequest(
			`/v1/events/${eventId}/audit-log?limit=500`,
			{ authToken: leaderSession.token },
			400,
		);
	});
});
