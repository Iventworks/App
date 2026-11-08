import { beforeAll, describe, expect, test } from "bun:test";
import { API } from "../server/lib/api";
import { EventsModel } from "../server/lib/api/versions/v1/routes/events/model";
import { EventParticipantsModel } from "../server/lib/api/versions/v1/routes/events/participants/model";
import { EventProgramModel } from "../server/lib/api/versions/v1/routes/events/program/model";
import { DB } from "../server/lib/db";
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
let outsider: SeededUser;

let coreSession: SeededSession;
let leaderSession: SeededSession;
let staffSession: SeededSession;
let outsiderSession: SeededSession;

let eventId: number;
let otherEventId: number;
let roomId: number;
let otherRoomId: number;

const HOUR = 60 * 60 * 1000;
const BASE = Date.UTC(2027, 6, 2, 8, 0, 0); // 2027-07-02 08:00 UTC

async function createEvent(name: string, extra: Record<string, unknown> = {}) {
	const event = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: {
			name,
			start_date: "2027-07-01",
			end_date: "2027-07-10",
			leader_ids: [leader.id],
			...extra,
		},
		expectedBodySchema: EventsModel.Create.Response,
	});
	return event.id;
}

function insertRoom(event_id: number, name: string) {
	return DB.instance().insert(DB.Tables.rooms).values({ event_id, name }).returning().get().id;
}

function insertFile(scope: "event" | "org" | "receipt", event_id: number | null, name: string) {
	return DB.instance()
		.insert(DB.Tables.files)
		.values({ scope, event_id, kind: "file", name, mime_type: "application/pdf", size: 10 })
		.returning()
		.get().id;
}

beforeAll(async () => {
	coreTeam = await seedUser("core_team");
	leader = await seedUser("volunteer");
	staff = await seedUser("volunteer");
	outsider = await seedUser("volunteer");

	coreSession = await seedSession(coreTeam.id);
	leaderSession = await seedSession(leader.id);
	staffSession = await seedSession(staff.id);
	outsiderSession = await seedSession(outsider.id);

	eventId = await createEvent("Sommerfreizeit Teilnehmer", { max_participants: 2 });
	otherEventId = await createEvent("Andere Freizeit");
	await addEventMember(eventId, staff.id, "staff");

	roomId = insertRoom(eventId, "Zimmer 1");
	otherRoomId = insertRoom(otherEventId, "Fremdes Zimmer");
});

describe("Event participants", () => {
	let participantId: number;
	let staffNoteId: number;

	test("leaders create participants with medical info and emergency contacts", async () => {
		const participant = await makeAPIRequest(`/v1/events/${eventId}/participants`, {
			method: "POST",
			authToken: leaderSession.token,
			body: {
				first_name: "Max",
				last_name: "Muster",
				birth_date: "2013-08-15",
				gender: "male",
				allergies: "Erdnüsse",
				room_id: roomId,
				emergency_contacts: [{ name: "Erika Muster", relation: "Mutter", phone: "0123 456" }],
			},
			expectedBodySchema: EventParticipantsModel.Create.Response,
		});

		expect(participant.status).toBe("registered");
		expect(participant.age).toBe(13);
		expect(participant.room?.name).toBe("Zimmer 1");
		expect(participant.emergency_contacts).toHaveLength(1);
		expect(participant.staff_notes).toEqual([]);
		participantId = participant.id;

		const audit = DB.instance().select().from(DB.Tables.auditLogs).all();
		const entry = audit.find(
			(row) => row.entity_type === "participant" && row.entity_id === participantId,
		);
		expect(entry?.summary).toContain("Max Muster");
		expect(JSON.stringify(entry)).not.toContain("Erdnüsse");
	});

	test("health data and staff notes are only visible to the event's own team", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}/notes`, {
			method: "POST",
			authToken: staffSession.token,
			body: { content: "Braucht abends sein Inhalationsspray." },
		});

		// Staff of the event see everything.
		const forStaff = await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			authToken: staffSession.token,
			expectedBodySchema: EventParticipantsModel.ParticipantDetail,
		});
		expect(forStaff.medical_visible).toBe(true);
		expect(forStaff.allergies).toBe("Erdnüsse");
		expect(forStaff.staff_notes.length).toBeGreaterThan(0);

		// Core team manage the event (implicit leader) but are not on its team: no health data.
		const forCore = await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			authToken: coreSession.token,
			expectedBodySchema: EventParticipantsModel.ParticipantDetail,
		});
		expect(forCore.medical_visible).toBe(false);
		expect(forCore.allergies).toBe("");
		expect(forCore.staff_notes).toEqual([]);
		expect(forCore.first_name).toBe("Max");

		const list = await makeAPIRequest(`/v1/events/${eventId}/participants`, {
			authToken: coreSession.token,
		});
		expect(list.every((p: any) => p.medical_visible === false && p.allergies === "")).toBe(true);

		const csv = await (
			await API.getApp().request(`/v1/events/${eventId}/participants/export`, {
				headers: { Authorization: `Bearer ${coreSession.token}` },
			})
		).text();
		expect(csv).not.toContain("Erdnüsse");

		// Saving the (blanked) form as core team must not wipe the hidden values.
		await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { first_name: "Max", allergies: "", medical_notes: "" },
		});
		const after = await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			authToken: staffSession.token,
		});
		expect(after.allergies).toBe("Erdnüsse");

		// The event permissions tell the frontend which case applies.
		const coreEvent = await makeAPIRequest(`/v1/events/${eventId}`, { authToken: coreSession.token });
		expect(coreEvent.permissions).not.toContain("participants:view_medical");
		expect(coreEvent.permissions).toContain("participants:manage");
		const staffEvent = await makeAPIRequest(`/v1/events/${eventId}`, { authToken: staffSession.token });
		expect(staffEvent.permissions).toContain("participants:view_medical");

		// Leave the note list as the following tests expect it.
		const ownNote = forStaff.staff_notes.find((note) => note.content.includes("Inhalationsspray"));
		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}/notes/${ownNote!.id}`,
			{ method: "DELETE", authToken: staffSession.token },
		);
	});

	test("rejects rooms of other events, invalid dates and missing names", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/participants`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { first_name: "A", last_name: "B", room_id: otherRoomId },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/participants`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { first_name: "A", last_name: "B", birth_date: "15.08.2013" },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/participants`,
			{ method: "POST", authToken: leaderSession.token, body: { first_name: "A" } },
			400,
		);
	});

	test("staff cannot manage participants, outsiders cannot see them", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/participants`,
			{
				method: "POST",
				authToken: staffSession.token,
				body: { first_name: "Nope", last_name: "Nope" },
			},
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}`,
			{ method: "PUT", authToken: staffSession.token, body: { notes: "x" } },
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/participants`,
			{ authToken: outsiderSession.token },
			403,
		);
	});

	test("puts registrations over max_participants on the waitlist", async () => {
		const second = await makeAPIRequest(`/v1/events/${eventId}/participants`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { first_name: "Anna", last_name: "Beispiel", status: "confirmed" },
			expectedBodySchema: EventParticipantsModel.Create.Response,
		});
		expect(second.status).toBe("confirmed");

		const third = await makeAPIRequest(`/v1/events/${eventId}/participants`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { first_name: "Zoe", last_name: "Zuspät" },
			expectedBodySchema: EventParticipantsModel.Create.Response,
		});
		expect(third.status).toBe("waitlist");
	});

	test("staff list and search participants", async () => {
		const all = await makeAPIRequest(`/v1/events/${eventId}/participants`, {
			authToken: staffSession.token,
			expectedBodySchema: EventParticipantsModel.GetAll.Response,
		});
		expect(all.map((participant) => participant.last_name)).toEqual(["Beispiel", "Muster", "Zuspät"]);

		const found = await makeAPIRequest(`/v1/events/${eventId}/participants?search=must`, {
			authToken: staffSession.token,
		});
		expect(found.map((participant: any) => participant.id)).toEqual([participantId]);

		const waitlist = await makeAPIRequest(`/v1/events/${eventId}/participants?status=waitlist`, {
			authToken: staffSession.token,
		});
		expect(waitlist).toHaveLength(1);
	});

	test("staff add notes; only the author or a leader deletes them", async () => {
		const note = await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}/notes`, {
			method: "POST",
			authToken: staffSession.token,
			body: { content: "Hatte Heimweh am ersten Abend." },
			expectedBodySchema: EventParticipantsModel.CreateNote.Response,
		});
		expect(note.author?.id).toBe(staff.id);
		expect(note.can_delete).toBe(true);
		staffNoteId = note.id;

		const leaderNote = await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}/notes`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { content: "Eltern informiert." },
			},
		);

		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}/notes/${leaderNote.id}`,
			{ method: "DELETE", authToken: staffSession.token },
			403,
		);

		const detail = await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			authToken: staffSession.token,
			expectedBodySchema: EventParticipantsModel.ParticipantDetail,
		});
		expect(detail.staff_notes).toHaveLength(2);
		expect(typeof detail.notes).toBe("string");
		expect(detail.staff_notes.find((entry) => entry.id === leaderNote.id)?.can_delete).toBe(false);
		expect(detail.note_count).toBe(2);

		await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}/notes/${staffNoteId}`, {
			method: "DELETE",
			authToken: staffSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}/notes/${staffNoteId}`,
			{ method: "DELETE", authToken: leaderSession.token },
			404,
		);
	});

	test("updates replace emergency contacts", async () => {
		const updated = await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: {
				fee_paid: true,
				emergency_contacts: [
					{ name: "Papa", phone: "111" },
					{ name: "Oma", relation: "Großmutter", phone: "222" },
				],
			},
			expectedBodySchema: EventParticipantsModel.Update.Response,
		});
		expect(updated.fee_paid).toBe(true);
		expect(updated.emergency_contacts.map((contact) => contact.name)).toEqual(["Papa", "Oma"]);
		expect(updated.allergies).toBe("Erdnüsse");

		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}`,
			{ method: "PUT", authToken: leaderSession.token, body: {} },
			400,
		);
	});

	test("participants of another event are not found", async () => {
		await makeAPIRequest(
			`/v1/events/${otherEventId}/participants/${participantId}`,
			{ authToken: leaderSession.token },
			404,
		);
	});

	test("CSV export", async () => {
		const res = await API.getApp().request(`/v1/events/${eventId}/participants/export`, {
			headers: { Authorization: `Bearer ${staffSession.token}` },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("content-disposition")).toContain("attachment");

		const bytes = new Uint8Array(await res.arrayBuffer());
		// UTF-8 BOM so Excel detects the encoding (text decoding strips it again).
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const text = new TextDecoder().decode(bytes);
		const [header, ...rows] = text.trim().split("\r\n");
		expect(header?.startsWith("Nachname;Vorname;Geburtsdatum;Alter")).toBe(true);
		expect(rows).toHaveLength(3);
		expect(text).toContain("Erdnüsse");

		const forbidden = await API.getApp().request(`/v1/events/${eventId}/participants/export`, {
			headers: { Authorization: `Bearer ${outsiderSession.token}` },
		});
		expect(forbidden.status).toBe(403);
	});

	test("deleting a participant removes notes and contacts", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}`,
			{ method: "DELETE", authToken: staffSession.token },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}/participants/${participantId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/participants/${participantId}`,
			{ authToken: leaderSession.token },
			404,
		);

		const contacts = DB.instance().select().from(DB.Tables.participantEmergencyContacts).all();
		expect(contacts.filter((contact) => contact.participant_id === participantId)).toEqual([]);
	});
});

describe("Event program", () => {
	let itemId: number;
	let eventFileId: number;
	let orgFileId: number;
	let foreignFileId: number;

	beforeAll(() => {
		eventFileId = insertFile("event", eventId, "Regeln.pdf");
		orgFileId = insertFile("org", null, "Leitfaden.pdf");
		foreignFileId = insertFile("event", otherEventId, "Fremd.pdf");
	});

	test("leaders create items with responsibles and linked files; responsibles are notified", async () => {
		const item = await makeAPIRequest(`/v1/events/${eventId}/program`, {
			method: "POST",
			authToken: leaderSession.token,
			body: {
				title: "Geländespiel",
				location: "Wald",
				color: "#22c55e",
				start_at: BASE,
				end_at: BASE + 2 * HOUR,
				responsible_user_ids: [staff.id],
				file_ids: [eventFileId, orgFileId],
			},
			expectedBodySchema: EventProgramModel.Create.Response,
		});

		expect(item.responsible.map((user) => user.id)).toEqual([staff.id]);
		expect(item.files.map((file) => file.id).sort()).toEqual([eventFileId, orgFileId].sort());
		expect(item.files.every((file) => file.download_token !== null)).toBe(true);
		expect(item.is_mine).toBe(false);
		itemId = item.id;

		const notifications = DB.instance().select().from(DB.Tables.notifications).all();
		expect(
			notifications.some(
				(n) =>
					n.user_id === staff.id && n.type === "program_assigned" && n.title.includes("Geländespiel"),
			),
		).toBe(true);
	});

	test("validates times, responsibles and file ownership", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { title: "Falsch", start_at: BASE, end_at: BASE - HOUR },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: {
					title: "Fremde",
					start_at: BASE,
					end_at: BASE + HOUR,
					responsible_user_ids: [outsider.id],
				},
			},
			400,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { title: "Datei", start_at: BASE, end_at: BASE + HOUR, file_ids: [foreignFileId] },
			},
			400,
		);
	});

	test("staff view the program but cannot change it", async () => {
		const items = await makeAPIRequest(`/v1/events/${eventId}/program`, {
			authToken: staffSession.token,
			expectedBodySchema: EventProgramModel.GetAll.Response,
		});
		expect(items).toHaveLength(1);
		expect(items[0]!.is_mine).toBe(true);

		await makeAPIRequest(
			`/v1/events/${eventId}/program/${itemId}`,
			{ method: "PUT", authToken: staffSession.token, body: { title: "x" } },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}/program`, { authToken: outsiderSession.token }, 403);
	});

	test("drag & drop moves an item; end before start is rejected", async () => {
		const moved = await makeAPIRequest(`/v1/events/${eventId}/program/${itemId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { start_at: BASE + 24 * HOUR, end_at: BASE + 26 * HOUR },
			expectedBodySchema: EventProgramModel.Update.Response,
		});
		expect(moved.start_at).toBe(BASE + 24 * HOUR);
		expect(moved.responsible.map((user) => user.id)).toEqual([staff.id]);
		expect(moved.files).toHaveLength(2);

		// Only start_at, ending up after the stored end_at.
		await makeAPIRequest(
			`/v1/events/${eventId}/program/${itemId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { start_at: BASE + 30 * HOUR } },
			400,
		);

		const audit = DB.instance().select().from(DB.Tables.auditLogs).all();
		expect(audit.some((row) => row.summary === "Programmpunkt „Geländespiel“ verschoben")).toBe(true);
	});

	test("updates replace responsibles and files", async () => {
		const updated = await makeAPIRequest(`/v1/events/${eventId}/program/${itemId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { responsible_user_ids: [leader.id, staff.id], file_ids: [orgFileId] },
			expectedBodySchema: EventProgramModel.Update.Response,
		});
		expect(updated.responsible.map((user) => user.id).sort()).toEqual([leader.id, staff.id].sort());
		expect(updated.files.map((file) => file.id)).toEqual([orgFileId]);
		expect(updated.is_mine).toBe(true);

		await makeAPIRequest(
			`/v1/events/${eventId}/program/${itemId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { file_ids: [foreignFileId] } },
			400,
		);
	});

	test("range filter", async () => {
		const inRange = await makeAPIRequest(
			`/v1/events/${eventId}/program?from=${BASE + 23 * HOUR}&to=${BASE + 25 * HOUR}`,
			{ authToken: staffSession.token },
		);
		expect(inRange).toHaveLength(1);

		const outOfRange = await makeAPIRequest(
			`/v1/events/${eventId}/program?from=${BASE}&to=${BASE + 2 * HOUR}`,
			{ authToken: staffSession.token },
		);
		expect(outOfRange).toHaveLength(0);
	});

	test("duplicate keeps duration, responsibles and files", async () => {
		const copy = await makeAPIRequest(`/v1/events/${eventId}/program/${itemId}/duplicate`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { start_at: BASE + 48 * HOUR },
			expectedBodySchema: EventProgramModel.Duplicate.Response,
		});
		expect(copy.id).not.toBe(itemId);
		expect(copy.end_at - copy.start_at).toBe(2 * HOUR);
		expect(copy.title).toBe("Geländespiel");
		expect(copy.responsible).toHaveLength(2);
		expect(copy.files.map((file) => file.id)).toEqual([orgFileId]);
	});

	test("delete and 404s", async () => {
		await makeAPIRequest(
			`/v1/events/${otherEventId}/program/${itemId}`,
			{ method: "DELETE", authToken: leaderSession.token },
			404,
		);
		await makeAPIRequest(`/v1/events/${eventId}/program/${itemId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/program/${itemId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { title: "weg" } },
			404,
		);
		// Linked files survive the program item.
		const file = DB.instance().select().from(DB.Tables.files).all();
		expect(file.some((row) => row.id === orgFileId)).toBe(true);
	});
});
