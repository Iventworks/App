/**
 * Copying an event ("the same camp again next year"): what comes along, what is left behind, how
 * dates move, and who may do it.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { API } from "../server/lib/api";
import { EventCopyModel } from "../server/lib/api/versions/v1/routes/events/copy/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { TimeUtils } from "../server/lib/utils/time";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders, TEST_HOST } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let core: SeededUser;
let lena: SeededUser;
let sven: SeededUser;
let gone: SeededUser;

let coreSession: SeededSession;
let lenaSession: SeededSession;
let svenSession: SeededSession;

let sourceId: number;
let roomId: number;
let groupId: number;
let folderId: number;
let fileId: number;
let orgFileId: number;
let resourceId: number;

// The source camp is long over; the copy is next year.
const SOURCE_START = "2026-07-06";
const SOURCE_END = "2026-07-12";
const COPY_START = "2027-07-05";

const db = () => DB.instance();
const api = (path: string, token = coreSession.token) => makeAPIRequest(path, { authToken: token });
const post = (path: string, body: Record<string, unknown>, token = coreSession.token, code = 201) =>
	makeAPIRequest(path, { method: "POST", authToken: token, body }, code);

async function upload(path: string, name: string, content: string, parentId?: number) {
	const form = new FormData();
	form.append("file", new File([content], name, { type: "text/plain" }));
	if (parentId) form.append("parent_id", String(parentId));
	return await makeAPIRequest(
		path,
		{ authToken: coreSession.token, additionalOptions: { method: "POST", body: form } },
		201,
	);
}

async function copy(body: Record<string, unknown>, expectedCode = 201, token = coreSession.token) {
	const result = await makeAPIRequest(
		`/v1/events/${sourceId}/copy`,
		{ method: "POST", authToken: token, body },
		expectedCode,
	);
	return expectedCode === 201 ? EventCopyModel.Response.parse(result) : result;
}

const ALL_PARTS = {
	team: true,
	groups: true,
	rooms: true,
	responsibilities: true,
	program: true,
	tasks: true,
	notes: true,
	announcements: true,
	budget: true,
	documents: true,
	resources: true,
	participants: true,
};

beforeAll(async () => {
	core = await seedUser("core_team", { display_name: "Kai Kopie" });
	lena = await seedUser("volunteer", { display_name: "Lena Leiterin" });
	sven = await seedUser("volunteer", { display_name: "Sven Staff" });
	gone = await seedUser("volunteer", { display_name: "Gerd Gesperrt" });
	coreSession = await seedSession(core.id);
	lenaSession = await seedSession(lena.id);
	svenSession = await seedSession(sven.id);

	const source = await post("/v1/events", {
		name: "Sommercamp 2026",
		type: "camp",
		description: "Eine Woche am See",
		location: "Waldsee",
		start_date: SOURCE_START,
		end_date: SOURCE_END,
		color: "#f97316",
		max_participants: 40,
		participant_fee_cents: 18_000,
		budget_cents: 500_000,
		leader_ids: [lena.id],
	});
	sourceId = source.id;
	const base = `/v1/events/${sourceId}`;

	roomId = (await post(`${base}/rooms`, { name: "Haus 1", capacity: 6 })).id;
	const svenMember = await addEventMember(sourceId, sven.id, "staff");
	db()
		.update(DB.Tables.eventMembers)
		.set({ position: "Küche", room_id: roomId, leader_notes: "Vertraulich" })
		.where(eq(DB.Tables.eventMembers.id, svenMember.id))
		.run();
	// Someone on the old team whose account is suspended meanwhile.
	await addEventMember(sourceId, gone.id, "staff");
	db()
		.update(DB.Tables.users)
		.set({ suspended_at: Date.now() })
		.where(eq(DB.Tables.users.id, gone.id))
		.run();

	groupId = (await post(`${base}/groups`, { name: "Küchenteam", member_ids: [sven.id] })).id;
	await post(`${base}/responsibilities`, {
		title: "Erste Hilfe",
		location: "Haus 1",
		assignee_ids: [sven.id, lena.id],
	});

	folderId = (await post(`${base}/files/folders`, { name: "Planung" })).id;
	fileId = (await upload(`${base}/files`, "Ablauf.txt", "Tag 1: Anreise", folderId)).id;
	orgFileId = (await upload("/v1/org/documents", "Hausordnung.txt", "Ruhe ab 22 Uhr")).id;

	// 09:00–10:30 on the second day, Berlin time.
	await post(`${base}/program`, {
		title: "Morgenandacht",
		location: "Zelt",
		start_at: TimeUtils.instantOf("2026-07-07", "09:00"),
		end_at: TimeUtils.instantOf("2026-07-07", "10:30"),
		responsible_user_ids: [sven.id],
		file_ids: [fileId, orgFileId],
	});

	await post(`${base}/tasks`, {
		title: "Zelte aufbauen",
		status: "done",
		priority: "high",
		assignee_id: sven.id,
		due_at: TimeUtils.instantOf("2026-07-05", "18:00"),
	});
	await post(`${base}/tasks`, { title: "Einkaufen", group_id: groupId });

	await post(`${base}/notes`, { title: "Packliste", content: "Zelt, Schlafsack", group_id: null });
	await post(`${base}/notes`, { title: "Rezepte", content: "Chili", group_id: groupId });
	await post(`${base}/announcements`, { title: "Anreise um 15 Uhr", content: "Bitte pünktlich" });
	await post(`${base}/budget`, { kind: "expense", category: "Verpflegung", planned_cents: 200_000 });

	resourceId = (await post("/v1/org/resources", { name: "Großzelt (Kopie)", quantity: 1 })).id;
	await post(`/v1/org/resources/${resourceId}/bookings`, { event_id: sourceId, quantity: 1 });

	const participant = await post(`${base}/participants`, {
		first_name: "Mia",
		last_name: "Muster",
		birth_date: "2012-05-01",
		allergies: "Nüsse",
		room_id: roomId,
		status: "confirmed",
		fee_paid: true,
		emergency_contacts: [{ name: "Papa Muster", relation: "Vater", phone: "0170 111" }],
	});
	await post(`${base}/participants`, {
		first_name: "Abgesagt",
		last_name: "Absage",
		status: "cancelled",
	});
	db()
		.insert(DB.Tables.participantNotes)
		.values({
			org_id: OrgContext.id(),
			participant_id: participant.id,
			author_id: lena.id,
			content: "Heimweh am zweiten Abend",
		})
		.run();

	// Things that record what happened: never copied.
	db()
		.insert(DB.Tables.expenses)
		.values({
			org_id: OrgContext.id(),
			event_id: sourceId,
			submitted_by: sven.id,
			title: "Grillkohle",
			amount_cents: 2_500,
			spent_on: "2026-07-08",
		})
		.run();
});

describe("Copy summary", () => {
	test("counts what there is to copy", async () => {
		const summary = EventCopyModel.Summary.Response.parse(await api(`/v1/events/${sourceId}/copy`));
		expect(summary).toMatchObject({
			team: 3,
			groups: 1,
			rooms: 1,
			responsibilities: 1,
			program: 1,
			tasks: 2,
			notes: 2,
			announcements: 1,
			budget: 1,
			documents: 2,
			resources: 1,
			participants: 1,
		});
		expect(summary.documents_size).toBe("Tag 1: Anreise".length);
	});
});

describe("Copying everything", () => {
	let copyId: number;

	test("the copy is a new event in planning, a year later, as long as the original", async () => {
		const result = await copy({
			name: "Sommercamp 2027",
			start_date: COPY_START,
			include: ALL_PARTS,
		});
		copyId = result.event.id;

		expect(result.event).toMatchObject({
			name: "Sommercamp 2027",
			type: "camp",
			status: "planning",
			description: "Eine Woche am See",
			location: "Waldsee",
			start_date: "2027-07-05",
			end_date: "2027-07-11",
			color: "#f97316",
			max_participants: 40,
			participant_fee_cents: 18_000,
			budget_cents: 500_000,
		});
		expect(result.skipped_files).toBe(0);
		// The original is untouched.
		expect((await api(`/v1/events/${sourceId}`)).name).toBe("Sommercamp 2026");
	});

	test("team with roles, functions and rooms — without suspended accounts and leader notes", async () => {
		const members = await api(`/v1/events/${copyId}/members`);
		expect(members.map((member: any) => [member.user.id, member.role]).sort()).toEqual(
			[
				[lena.id, "leader"],
				[sven.id, "staff"],
			].sort(),
		);
		const svenCopy = members.find((member: any) => member.user.id === sven.id);
		expect(svenCopy.position).toBe("Küche");
		expect(svenCopy.leader_notes ?? "").toBe("");

		const rooms = await api(`/v1/events/${copyId}/rooms`);
		expect(rooms).toHaveLength(1);
		expect(rooms[0]).toMatchObject({ name: "Haus 1", capacity: 6 });
		expect(rooms[0].id).not.toBe(roomId);
		expect(svenCopy.room_id ?? svenCopy.room?.id).toBe(rooms[0].id);

		// They are told.
		const forSven = await api("/v1/notifications?limit=50", svenSession.token);
		expect(
			forSven.items.some(
				(entry: any) => entry.type === "event_added" && entry.link === `/events/${copyId}`,
			),
		).toBe(true);
	});

	test("groups, responsibilities and who is in them", async () => {
		const groups = await api(`/v1/events/${copyId}/groups`);
		expect(groups).toHaveLength(1);
		expect(groups[0].name).toBe("Küchenteam");
		expect(groups[0].id).not.toBe(groupId);
		expect(groups[0].members.map((member: any) => member.id)).toEqual([sven.id]);

		const responsibilities = await api(`/v1/events/${copyId}/responsibilities`);
		expect(responsibilities).toHaveLength(1);
		expect(responsibilities[0]).toMatchObject({ title: "Erste Hilfe", location: "Haus 1" });
		expect(responsibilities[0].assignees.map((user: any) => user.id).sort()).toEqual(
			[lena.id, sven.id].sort(),
		);
	});

	test("program at the same time of day on the matching day, with its people and files", async () => {
		const items = await api(`/v1/events/${copyId}/program`);
		expect(items).toHaveLength(1);
		const item = items[0];
		// Second day of the copy, still 09:00–10:30 in Berlin.
		expect(TimeUtils.toDateString(item.start_at)).toBe("2027-07-06");
		expect(TimeUtils.toTimeString(item.start_at)).toBe("09:00");
		expect(TimeUtils.toTimeString(item.end_at)).toBe("10:30");
		expect(item.responsible.map((user: any) => user.id)).toEqual([sven.id]);

		// The event document points at its copy, the organisation document stays the same one.
		const linked = item.files.map((file: any) => file.id);
		expect(linked).toContain(orgFileId);
		expect(linked).not.toContain(fileId);
		expect(linked).toHaveLength(2);
	});

	test("documents are real copies: deleting the original leaves them", async () => {
		const root = await api(`/v1/events/${copyId}/files`);
		expect(root.items.map((item: any) => [item.kind, item.name])).toEqual([["folder", "Planung"]]);
		const inside = await api(`/v1/events/${copyId}/files?parent_id=${root.items[0].id}`);
		expect(inside.items).toHaveLength(1);
		const file = inside.items[0];
		expect(file.name).toBe("Ablauf.txt");
		expect(file.id).not.toBe(fileId);

		const read = async (contentUrl: string) =>
			await API.getApp().request(contentUrl.replace("/api", ""), {
				headers: { ...hostHeaders(TEST_HOST), Authorization: `Bearer ${coreSession.token}` },
			});
		expect(await (await read(file.content_url)).text()).toBe("Tag 1: Anreise");

		const original = db().select().from(DB.Tables.files).where(eq(DB.Tables.files.id, fileId)).get()!;
		const duplicate = db()
			.select()
			.from(DB.Tables.files)
			.where(eq(DB.Tables.files.id, file.id))
			.get()!;
		expect(duplicate.storage_key).not.toBe(original.storage_key);
	});

	test("tasks are open again and due on the matching day", async () => {
		const tasks = await api(`/v1/events/${copyId}/tasks`);
		expect(tasks).toHaveLength(2);
		const build = tasks.find((task: any) => task.title === "Zelte aufbauen");
		expect(build).toMatchObject({ status: "open", priority: "high", completed_at: null });
		expect(build.assignee?.id ?? build.assignee_id).toBe(sven.id);
		// One day before the camp, 18:00.
		expect(TimeUtils.toDateString(build.due_at)).toBe("2027-07-04");
		expect(TimeUtils.toTimeString(build.due_at)).toBe("18:00");

		const shopping = tasks.find((task: any) => task.title === "Einkaufen");
		const groups = await api(`/v1/events/${copyId}/groups`);
		expect(shopping.group?.id ?? shopping.group_id).toBe(groups[0].id);
	});

	test("notes, news and budget lines", async () => {
		const notes = await api(`/v1/events/${copyId}/notes`);
		expect(notes.map((note: any) => note.title).sort()).toEqual(["Packliste", "Rezepte"]);
		const groups = await api(`/v1/events/${copyId}/groups`);
		expect(notes.find((note: any) => note.title === "Rezepte").group?.id).toBe(groups[0].id);

		const announcements = await api(`/v1/events/${copyId}/announcements`);
		expect(announcements.map((entry: any) => entry.title)).toEqual(["Anreise um 15 Uhr"]);

		const budget = await api(`/v1/events/${copyId}/budget`);
		const lines = budget.items ?? budget;
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ category: "Verpflegung", planned_cents: 200_000 });
	});

	test("participants are registered again, unpaid, without notes about them", async () => {
		const participants = db()
			.select()
			.from(DB.Tables.participants)
			.where(eq(DB.Tables.participants.event_id, copyId))
			.all();
		expect(participants).toHaveLength(1);
		const [mia] = participants;
		expect(mia).toMatchObject({
			first_name: "Mia",
			last_name: "Muster",
			birth_date: "2012-05-01",
			allergies: "Nüsse",
			status: "registered",
			fee_paid: false,
		});
		const rooms = await api(`/v1/events/${copyId}/rooms`);
		expect(mia!.room_id).toBe(rooms[0].id);

		expect(
			db()
				.select()
				.from(DB.Tables.participantEmergencyContacts)
				.where(eq(DB.Tables.participantEmergencyContacts.participant_id, mia!.id))
				.all()
				.map((contact) => contact.name),
		).toEqual(["Papa Muster"]);
		expect(
			db()
				.select()
				.from(DB.Tables.participantNotes)
				.where(eq(DB.Tables.participantNotes.participant_id, mia!.id))
				.all(),
		).toHaveLength(0);
	});

	test("expenses and the old audit trail stay with the original", async () => {
		expect(
			db().select().from(DB.Tables.expenses).where(eq(DB.Tables.expenses.event_id, copyId)).all(),
		).toHaveLength(0);
		const log = db()
			.select()
			.from(DB.Tables.auditLogs)
			.where(eq(DB.Tables.auditLogs.event_id, copyId))
			.all();
		expect(log).toHaveLength(1);
		expect(log[0]!.summary).toBe("„Sommercamp 2027“ als Kopie von „Sommercamp 2026“ angelegt");
		expect(log[0]!.metadata?.source_event_id).toBe(sourceId);
	});

	test("resources are booked again where they are free", async () => {
		const bookings = db()
			.select()
			.from(DB.Tables.resourceBookings)
			.where(eq(DB.Tables.resourceBookings.resource_id, resourceId))
			.all();
		expect(bookings.map((booking) => booking.event_id).sort()).toEqual([sourceId, copyId].sort());

		// A second copy in the same week finds the tent taken.
		const clash = await copy({
			name: "Parallelcamp",
			start_date: "2027-07-08",
			include: { ...ALL_PARTS, participants: false },
		});
		expect(clash.skipped_bookings).toEqual(["Großzelt (Kopie)"]);
		expect(
			db()
				.select()
				.from(DB.Tables.resourceBookings)
				.where(eq(DB.Tables.resourceBookings.event_id, clash.event.id))
				.all(),
		).toHaveLength(0);
	});
});

describe("Choosing what to copy", () => {
	test("by default: structure and plans, no people's data, documents or news", async () => {
		const result = await copy({ name: "Herbstcamp", start_date: "2027-10-11" });
		const id = result.event.id;

		expect(await api(`/v1/events/${id}/members`)).toHaveLength(2);
		expect(await api(`/v1/events/${id}/rooms`)).toHaveLength(1);
		expect(await api(`/v1/events/${id}/groups`)).toHaveLength(1);
		expect(await api(`/v1/events/${id}/program`)).toHaveLength(1);
		expect(await api(`/v1/events/${id}/tasks`)).toHaveLength(2);

		expect(await api(`/v1/events/${id}/notes`)).toHaveLength(0);
		expect(await api(`/v1/events/${id}/announcements`)).toHaveLength(0);
		expect((await api(`/v1/events/${id}/files`)).items).toHaveLength(0);
		expect(
			db().select().from(DB.Tables.participants).where(eq(DB.Tables.participants.event_id, id)).all(),
		).toHaveLength(0);

		// Without the documents, the program keeps only the organisation document.
		const [item] = await api(`/v1/events/${id}/program`);
		expect(item.files.map((file: any) => file.id)).toEqual([orgFileId]);
	});

	test("without the team, nothing names a person", async () => {
		const result = await copy({
			name: "Nur das Gerüst",
			start_date: "2028-07-03",
			end_date: "2028-07-14",
			include: { ...ALL_PARTS, team: false, participants: false, resources: false },
		});
		const id = result.event.id;
		expect(result.event.end_date).toBe("2028-07-14");

		expect(await api(`/v1/events/${id}/members`)).toHaveLength(0);
		const [group] = await api(`/v1/events/${id}/groups`);
		expect(group.members).toHaveLength(0);
		const [responsibility] = await api(`/v1/events/${id}/responsibilities`);
		expect(responsibility.assignees).toHaveLength(0);
		const [item] = await api(`/v1/events/${id}/program`);
		expect(item.responsible).toHaveLength(0);
		const tasks = await api(`/v1/events/${id}/tasks`);
		expect(tasks.every((task: any) => (task.assignee?.id ?? task.assignee_id ?? null) === null)).toBe(
			true,
		);
	});

	test("group notes only come along with their group", async () => {
		const result = await copy({
			name: "Ohne Gruppen",
			start_date: "2028-08-07",
			include: { ...ALL_PARTS, groups: false, participants: false, resources: false },
		});
		const notes = await api(`/v1/events/${result.event.id}/notes`);
		expect(notes.map((note: any) => note.title)).toEqual(["Packliste"]);
		const tasks = await api(`/v1/events/${result.event.id}/tasks`);
		expect(tasks.every((task: any) => (task.group?.id ?? task.group_id ?? null) === null)).toBe(true);
	});
});

describe("Rules", () => {
	test("only the core team copies events", async () => {
		const body = { name: "Unerlaubt", start_date: COPY_START };
		// The leader of the original may edit it, but not create events.
		await copy(body, 403, lenaSession.token);
		await makeAPIRequest(`/v1/events/${sourceId}/copy`, { authToken: lenaSession.token }, 403);
		await copy(body, 403, svenSession.token);
	});

	test("the dates must make sense", async () => {
		await copy({ name: "Rückwärts", start_date: "2027-07-10", end_date: "2027-07-01" }, 400);
		await copy({ name: "", start_date: COPY_START }, 400);
		await copy({ name: "Kein Datum" }, 400);
		await makeAPIRequest(
			"/v1/events/99999999/copy",
			{ method: "POST", authToken: coreSession.token, body: { name: "x", start_date: COPY_START } },
			404,
		);
	});

	test("a recurring event is copied with its rule and gets fresh dates", async () => {
		const today = TimeUtils.today();
		const series = await post("/v1/events", {
			name: "Jugendabend 2026",
			type: "recurring",
			start_date: today,
			end_date: TimeUtils.addDays(today, 27),
			recurrence: {
				frequency: "weekly",
				interval: 1,
				weekdays: [],
				monthly_mode: "day_of_month",
				start_time: "19:30",
				end_time: null,
			},
			leader_ids: [lena.id],
		});
		const occurrences = (await api(`/v1/events/${series.id}/occurrences`)).occurrences;
		expect(occurrences).toHaveLength(4);
		// The topic of an old date is not a plan for the new series.
		await makeAPIRequest(`/v1/events/${series.id}/occurrences/${occurrences[0].id}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { title: "Altes Thema" },
		});

		const start = TimeUtils.addDays(today, 364);
		const result = EventCopyModel.Response.parse(
			await post(`/v1/events/${series.id}/copy`, { name: "Jugendabend 2027", start_date: start }),
		);
		expect(result.event).toMatchObject({
			type: "recurring",
			start_date: start,
			end_date: TimeUtils.addDays(start, 27),
		});
		expect(result.event.recurrence?.start_time).toBe("19:30");
		expect(result.event.next_occurrence?.date).toBe(start);

		const copied = (await api(`/v1/events/${result.event.id}/occurrences`)).occurrences;
		expect(copied.map((occurrence: any) => occurrence.date)).toEqual(
			[0, 7, 14, 21].map((offset) => TimeUtils.addDays(start, offset)),
		);
		expect(copied.every((occurrence: any) => occurrence.title === null)).toBe(true);
	});
});
