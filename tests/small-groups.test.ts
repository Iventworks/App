/**
 * Kleingruppen (small groups of participants led by staff), responsible staff for rooms, and
 * program items that take place in the Kleingruppen.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { EventsModel } from "../server/lib/api/versions/v1/routes/events/model";
import { EventParticipantsModel } from "../server/lib/api/versions/v1/routes/events/participants/model";
import { EventProgramModel } from "../server/lib/api/versions/v1/routes/events/program/model";
import { EventRoomsModel } from "../server/lib/api/versions/v1/routes/events/rooms/model";
import { EventSmallGroupsModel } from "../server/lib/api/versions/v1/routes/events/small-groups/model";
import { DB } from "../server/lib/db";
import { TimeUtils } from "../server/lib/utils/time";
import { makeAPIRequest } from "./helpers/api";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let leader: SeededUser;
let anna: SeededUser;
let ben: SeededUser;
let outsider: SeededUser;
let leaderSession: SeededSession;
let annaSession: SeededSession;
let outsiderSession: SeededSession;

let eventId: number;
let otherEventId: number;
let mia: number;
let tom: number;
let foreignParticipant: number;

const base = () => `/v1/events/${eventId}`;

function notificationsOf(userId: number, type: string) {
	return DB.instance()
		.select()
		.from(DB.Tables.notifications)
		.where(and(eq(DB.Tables.notifications.user_id, userId), eq(DB.Tables.notifications.type, type)))
		.all();
}

beforeAll(async () => {
	const core = await seedUser("core_team");
	leader = await seedUser("volunteer", { display_name: "Lea Leitung" });
	anna = await seedUser("volunteer", { display_name: "Anna Kleingruppe" });
	ben = await seedUser("volunteer", { display_name: "Ben Betreuer" });
	outsider = await seedUser("volunteer", { display_name: "Olli Außen" });
	const coreSession = await seedSession(core.id);
	leaderSession = await seedSession(leader.id);
	annaSession = await seedSession(anna.id);
	outsiderSession = await seedSession(outsider.id);

	const event = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: {
			name: "Jungscharlager",
			start_date: "2027-07-01",
			end_date: "2027-07-05",
			leader_ids: [leader.id],
		},
	});
	eventId = event.id;
	const other = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: { name: "Anderes Lager", start_date: "2027-08-01", end_date: "2027-08-03" },
	});
	otherEventId = other.id;

	await addEventMember(eventId, anna.id, "staff");
	await addEventMember(eventId, ben.id, "staff");

	const participant = (body: Record<string, unknown>, event = eventId) =>
		makeAPIRequest(`/v1/events/${event}/participants`, {
			method: "POST",
			authToken: coreSession.token,
			body,
		});
	mia = (await participant({ first_name: "Mia", last_name: "Muster", gender: "female" })).id;
	tom = (await participant({ first_name: "Tom", last_name: "Test", gender: "male" })).id;
	foreignParticipant = (await participant({ first_name: "Fremd", last_name: "Lager" }, otherEventId))
		.id;
});

describe("Kleingruppen", () => {
	let foxes: number;
	let owls: number;

	test("leaders create groups with staff of the event as leaders", async () => {
		await makeAPIRequest(
			`${base()}/small-groups`,
			{ method: "POST", authToken: annaSession.token, body: { name: "Füchse" } },
			403,
		);
		await makeAPIRequest(
			`${base()}/small-groups`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { name: "Füchse", leader_ids: [outsider.id] },
			},
			400,
		);

		const created = await makeAPIRequest(`${base()}/small-groups`, {
			method: "POST",
			authToken: leaderSession.token,
			body: {
				name: "Füchse",
				meeting_point: "Lagerfeuer",
				color: "#22c55e",
				leader_ids: [anna.id, ben.id],
			},
			expectedBodySchema: EventSmallGroupsModel.Create.Response,
		});
		foxes = created.id;
		expect(created.leaders.map((user) => user.display_name)).toEqual([
			"Anna Kleingruppe",
			"Ben Betreuer",
		]);
		expect(created.participant_count).toBe(0);
		expect(notificationsOf(anna.id, "small_group_assigned")).toHaveLength(1);

		owls = (
			await makeAPIRequest(`${base()}/small-groups`, {
				method: "POST",
				authToken: leaderSession.token,
				body: { name: "Eulen" },
			})
		).id;
	});

	test("staff see the groups; people outside the event don't", async () => {
		const list = await makeAPIRequest(`${base()}/small-groups`, {
			authToken: annaSession.token,
			expectedBodySchema: EventSmallGroupsModel.GetAll.Response,
		});
		expect(list.map((group) => group.name)).toEqual(["Eulen", "Füchse"]);
		await makeAPIRequest(`${base()}/small-groups`, { authToken: outsiderSession.token }, 403);
	});

	test("updating leaders replaces the set and only tells the new ones", async () => {
		const before = notificationsOf(anna.id, "small_group_assigned").length;
		const updated = await makeAPIRequest(`${base()}/small-groups/${foxes}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { leader_ids: [anna.id], meeting_point: "Wiese" },
			expectedBodySchema: EventSmallGroupsModel.Update.Response,
		});
		expect(updated.leaders.map((user) => user.id)).toEqual([anna.id]);
		expect(updated.meeting_point).toBe("Wiese");
		expect(notificationsOf(anna.id, "small_group_assigned")).toHaveLength(before);

		await makeAPIRequest(
			`/v1/events/${otherEventId}/small-groups/${foxes}`,
			{ method: "PUT", authToken: leaderSession.token, body: { name: "X" } },
			// The leader is not on the other event's team.
			403,
		);
	});

	test("bulk assignment: one group per participant, only this event's people and groups", async () => {
		await makeAPIRequest(
			`${base()}/small-groups/assignments`,
			{
				method: "PUT",
				authToken: leaderSession.token,
				body: { participants: [{ participant_id: foreignParticipant, small_group_id: foxes }] },
			},
			400,
		);
		await makeAPIRequest(
			`${base()}/small-groups/assignments`,
			{
				method: "PUT",
				authToken: annaSession.token,
				body: { participants: [{ participant_id: mia, small_group_id: foxes }] },
			},
			403,
		);

		const groups = await makeAPIRequest(`${base()}/small-groups/assignments`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: {
				participants: [
					{ participant_id: mia, small_group_id: foxes },
					{ participant_id: tom, small_group_id: owls },
				],
			},
			expectedBodySchema: EventSmallGroupsModel.Assignments.Response,
		});
		expect(groups.find((group) => group.id === foxes)!.participants.map((p) => p.first_name)).toEqual(
			["Mia"],
		);

		// Moving Mia takes her out of the Füchse.
		const moved = await makeAPIRequest(`${base()}/small-groups/assignments`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { participants: [{ participant_id: mia, small_group_id: owls }] },
		});
		expect(moved.find((group: any) => group.id === foxes).participant_count).toBe(0);
		expect(moved.find((group: any) => group.id === owls).participant_count).toBe(2);

		const participants = await makeAPIRequest(`${base()}/participants`, {
			authToken: leaderSession.token,
			expectedBodySchema: EventParticipantsModel.GetAll.Response,
		});
		expect(participants.find((p) => p.id === mia)!.small_group).toMatchObject({
			id: owls,
			name: "Eulen",
		});
	});

	test("participants take a Kleingruppe of their own event only", async () => {
		const foreignGroup = await makeAPIRequest(`/v1/events/${otherEventId}/small-groups`, {
			method: "POST",
			authToken: (await seedSession((await seedUser("core_team")).id)).token,
			body: { name: "Fremde Gruppe" },
		});
		await makeAPIRequest(
			`${base()}/participants/${tom}`,
			{ method: "PUT", authToken: leaderSession.token, body: { small_group_id: foreignGroup.id } },
			400,
		);
		const updated = await makeAPIRequest(`${base()}/participants/${tom}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { small_group_id: foxes },
		});
		expect(updated.small_group?.id).toBe(foxes);
	});

	test("the overview lists the groups someone leads", async () => {
		const overview = await makeAPIRequest(`${base()}/overview`, {
			authToken: annaSession.token,
			expectedBodySchema: EventsModel.Overview.Response,
		});
		expect(overview.my_small_groups).toEqual([
			{ id: foxes, name: "Füchse", color: "#22c55e", meeting_point: "Wiese", participant_count: 1 },
		]);
	});

	test("waitlisted participants keep their group but are not listed until they take part", async () => {
		const wally = await makeAPIRequest(`${base()}/participants`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { first_name: "Wally", last_name: "Warte", status: "waitlist", small_group_id: foxes },
		});
		const foxesNow = async () =>
			(
				await makeAPIRequest(`${base()}/small-groups`, {
					authToken: leaderSession.token,
					expectedBodySchema: EventSmallGroupsModel.GetAll.Response,
				})
			).find((group) => group.id === foxes)!;
		const overviewCount = async () =>
			(
				await makeAPIRequest(`${base()}/overview`, {
					authToken: annaSession.token,
					expectedBodySchema: EventsModel.Overview.Response,
				})
			).my_small_groups.find((group) => group.id === foxes)?.participant_count;

		expect((await foxesNow()).participants.map((p) => p.first_name)).toEqual(["Tom"]);
		expect(await overviewCount()).toBe(1);

		await makeAPIRequest(`${base()}/participants/${wally.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { status: "confirmed" },
		});
		const foxesAfter = await foxesNow();
		expect(foxesAfter.participants.map((p) => p.first_name).sort()).toEqual(["Tom", "Wally"]);
		expect(foxesAfter.participant_count).toBe(2);
		expect(await overviewCount()).toBe(2);

		await makeAPIRequest(`${base()}/participants/${wally.id}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
	});

	test("program items can take place in the Kleingruppen", async () => {
		const item = await makeAPIRequest(`${base()}/program`, {
			method: "POST",
			authToken: leaderSession.token,
			body: {
				title: "Kleingruppenzeit",
				start_at: TimeUtils.instantOf("2027-07-02", "10:00"),
				end_at: TimeUtils.instantOf("2027-07-02", "11:00"),
				in_small_groups: true,
			},
			expectedBodySchema: EventProgramModel.Create.Response,
		});
		expect(item.in_small_groups).toBe(true);

		const copy = await makeAPIRequest(`${base()}/program/${item.id}/duplicate`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { start_at: TimeUtils.instantOf("2027-07-03", "10:00") },
		});
		expect(copy.in_small_groups).toBe(true);

		const plain = await makeAPIRequest(`${base()}/program/${item.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { in_small_groups: false },
		});
		expect(plain.in_small_groups).toBe(false);
	});

	test("deleting a group leaves its participants without one", async () => {
		await makeAPIRequest(`${base()}/small-groups/${owls}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		const row = DB.instance()
			.select()
			.from(DB.Tables.participants)
			.where(eq(DB.Tables.participants.id, mia))
			.get();
		expect(row?.small_group_id).toBeNull();
		await makeAPIRequest(
			`${base()}/small-groups/${owls}`,
			{ method: "DELETE", authToken: leaderSession.token },
			404,
		);
	});
});

describe("Room responsibles", () => {
	let roomId: number;

	test("rooms take staff of the event as responsibles (optional)", async () => {
		await makeAPIRequest(
			`${base()}/rooms`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { name: "Zimmer 1", responsible_ids: [outsider.id] },
			},
			400,
		);
		const teamRoom = await makeAPIRequest(`${base()}/rooms`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { name: "Teamzimmer" },
			expectedBodySchema: EventRoomsModel.Create.Response,
		});
		expect(teamRoom.responsibles).toEqual([]);

		const room = await makeAPIRequest(`${base()}/rooms`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { name: "Zimmer 1", capacity: 4, responsible_ids: [ben.id] },
			expectedBodySchema: EventRoomsModel.Create.Response,
		});
		roomId = room.id;
		expect(room.responsibles.map((user) => user.id)).toEqual([ben.id]);
		expect(notificationsOf(ben.id, "room_assigned")).toHaveLength(1);

		const updated = await makeAPIRequest(`${base()}/rooms/${roomId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { responsible_ids: [ben.id, anna.id] },
			expectedBodySchema: EventRoomsModel.Update.Response,
		});
		expect(updated.responsibles.map((user) => user.display_name)).toEqual([
			"Anna Kleingruppe",
			"Ben Betreuer",
		]);
		// Ben was already responsible: no second notification.
		expect(notificationsOf(ben.id, "room_assigned")).toHaveLength(1);
		expect(notificationsOf(anna.id, "room_assigned")).toHaveLength(1);

		// Changing only the name keeps them.
		const renamed = await makeAPIRequest(`${base()}/rooms/${roomId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { name: "Zimmer 1a" },
		});
		expect(renamed.responsibles).toHaveLength(2);

		const overview = await makeAPIRequest(`${base()}/overview`, {
			authToken: annaSession.token,
			expectedBodySchema: EventsModel.Overview.Response,
		});
		expect(overview.my_responsible_rooms).toEqual([{ id: roomId, name: "Zimmer 1a" }]);
	});

	test("leaving the team ends room responsibility and Kleingruppen leadership", async () => {
		const groups = await makeAPIRequest(`${base()}/small-groups`, { authToken: leaderSession.token });
		expect(groups.some((group: any) => group.leaders.some((user: any) => user.id === anna.id))).toBe(
			true,
		);

		const members = await makeAPIRequest(`${base()}/members`, { authToken: leaderSession.token });
		const annaMember = members.find((member: any) => member.user_id === anna.id);
		await makeAPIRequest(`${base()}/members/${annaMember.id}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});

		const rooms = await makeAPIRequest(`${base()}/rooms`, { authToken: leaderSession.token });
		expect(
			rooms.find((room: any) => room.id === roomId).responsibles.map((user: any) => user.id),
		).toEqual([ben.id]);
		const after = await makeAPIRequest(`${base()}/small-groups`, { authToken: leaderSession.token });
		expect(after.some((group: any) => group.leaders.some((user: any) => user.id === anna.id))).toBe(
			false,
		);
	});
});
