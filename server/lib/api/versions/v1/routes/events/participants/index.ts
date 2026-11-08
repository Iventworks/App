import { and, asc, count, eq, inArray, like, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { Logger } from "../../../../../../utils/logger";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventParticipantsModel } from "./model";

type ParticipantsEnv = {
	Variables: EventRouterEnv["Variables"] & { participant: DB.Models.Participant };
};

export const router = new Hono<ParticipantsEnv>().basePath("/:eventId/participants");

/** Statuses that occupy a place (count against `events.max_participants`). */
const ACTIVE_STATUSES: DB.Models.Participant["status"][] = ["registered", "confirmed"];

const GENDER_LABELS: Record<NonNullable<DB.Models.Participant["gender"]>, string> = {
	female: "weiblich",
	male: "männlich",
	diverse: "divers",
};

const STATUS_LABELS: Record<DB.Models.Participant["status"], string> = {
	registered: "angemeldet",
	confirmed: "bestätigt",
	waitlist: "Warteliste",
	cancelled: "abgesagt",
};

function fullName(participant: Pick<DB.Models.Participant, "first_name" | "last_name">) {
	return `${participant.first_name} ${participant.last_name}`;
}

/** A room id must belong to the event (null always passes). */
async function validateRoom(eventId: number, roomId: number | null | undefined) {
	if (!roomId) return null;
	const room = await DB.instance()
		.select({ id: DB.Tables.rooms.id })
		.from(DB.Tables.rooms)
		.where(and(eq(DB.Tables.rooms.id, roomId), eq(DB.Tables.rooms.event_id, eventId)))
		.get();
	return room ? null : "The room does not belong to this event";
}

async function replaceEmergencyContacts(
	participantId: number,
	contacts: EventParticipantsModel.EmergencyContactInput[],
	tx: DrizzleDB,
) {
	await tx
		.delete(DB.Tables.participantEmergencyContacts)
		.where(eq(DB.Tables.participantEmergencyContacts.participant_id, participantId))
		.run();

	if (contacts.length > 0) {
		await tx
			.insert(DB.Tables.participantEmergencyContacts)
			.values(
				contacts.map((contact) => ({
					participant_id: participantId,
					name: contact.name,
					relation: contact.relation ?? null,
					phone: contact.phone,
				})),
			)
			.run();
	}
}

/** Enrich participant rows with age, room, emergency contacts and note counts. */
/** Health fields only the event's own team may see (`participants:view_medical`). */
const MEDICAL_FIELDS = [
	"allergies",
	"medications",
	"dietary_requirements",
	"medical_notes",
	"can_swim",
] as const satisfies readonly (keyof DB.Models.Participant)[];

function maskMedical(participant: DB.Models.Participant): DB.Models.Participant {
	return {
		...participant,
		allergies: "",
		medications: "",
		dietary_requirements: "",
		medical_notes: "",
		can_swim: null,
	};
}

async function toResponse(
	event: DB.Models.Event,
	participants: DB.Models.Participant[],
	medicalVisible: boolean,
): Promise<EventParticipantsModel.Participant[]> {
	if (participants.length === 0) return [];
	const ids = participants.map((participant) => participant.id);

	const roomIds = [
		...new Set(
			participants.map((participant) => participant.room_id).filter((id): id is number => id !== null),
		),
	];
	const rooms = roomIds.length
		? await DB.instance()
				.select({ id: DB.Tables.rooms.id, name: DB.Tables.rooms.name })
				.from(DB.Tables.rooms)
				.where(inArray(DB.Tables.rooms.id, roomIds))
				.all()
		: [];

	const contacts = await DB.instance()
		.select()
		.from(DB.Tables.participantEmergencyContacts)
		.where(inArray(DB.Tables.participantEmergencyContacts.participant_id, ids))
		.orderBy(asc(DB.Tables.participantEmergencyContacts.id))
		.all();

	const noteCounts = await DB.instance()
		.select({ participant_id: DB.Tables.participantNotes.participant_id, value: count() })
		.from(DB.Tables.participantNotes)
		.where(inArray(DB.Tables.participantNotes.participant_id, ids))
		.groupBy(DB.Tables.participantNotes.participant_id)
		.all();

	return participants.map((participant) => ({
		...(medicalVisible ? participant : maskMedical(participant)),
		medical_visible: medicalVisible,
		age: TimeUtils.ageOn(participant.birth_date, event.start_date),
		room: rooms.find((room) => room.id === participant.room_id) ?? null,
		emergency_contacts: contacts.filter((contact) => contact.participant_id === participant.id),
		note_count: medicalVisible
			? (noteCounts.find((entry) => entry.participant_id === participant.id)?.value ?? 0)
			: 0,
	}));
}

function canDeleteNote(c: Context<ParticipantsEnv>, note: DB.Models.ParticipantNote) {
	return EventAccess.can(c, "participants:manage") || note.author_id === c.get("eventAccess").userId;
}

async function toNotesResponse(
	c: Context<ParticipantsEnv>,
	notes: DB.Models.ParticipantNote[],
): Promise<EventParticipantsModel.Note[]> {
	const users = await UserSummary.fetchMap(notes.map((note) => note.author_id));
	return notes.map((note) => ({
		id: note.id,
		content: note.content,
		created_at: note.created_at,
		author: note.author_id ? (users.get(note.author_id) ?? null) : null,
		can_delete: canDeleteNote(c, note),
	}));
}

async function toDetailResponse(
	c: Context<ParticipantsEnv>,
	participant: DB.Models.Participant,
): Promise<EventParticipantsModel.ParticipantDetail> {
	const medicalVisible = EventAccess.can(c, "participants:view_medical");
	const [base] = await toResponse(c.get("event"), [participant], medicalVisible);
	if (!medicalVisible) return { ...base!, staff_notes: [] };

	const staffNotes = await DB.instance()
		.select()
		.from(DB.Tables.participantNotes)
		.where(eq(DB.Tables.participantNotes.participant_id, participant.id))
		.orderBy(asc(DB.Tables.participantNotes.created_at), asc(DB.Tables.participantNotes.id))
		.all();

	return { ...base!, staff_notes: await toNotesResponse(c, staffNotes) };
}

/** Escape a CSV cell (`;`-separated) and defuse spreadsheet formula injection. */
function csvCell(value: string | number | boolean | null | undefined) {
	if (value === null || value === undefined) return "";
	let text = typeof value === "boolean" ? (value ? "ja" : "nein") : String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	if (/[";\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
	return text;
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List participants",
		description:
			"List the participants of an event with age, room, emergency contacts and the number of staff notes. Includes medical information.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Participants retrieved successfully",
				EventParticipantsModel.GetAll.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view participants"),
		),
	}),

	zValidator("query", EventParticipantsModel.GetAll.Query),

	async (c) => {
		if (!EventAccess.can(c, "participants:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view participants");
		}

		const event = c.get("event");
		const query = c.req.valid("query") as EventParticipantsModel.GetAll.Query;

		const conditions = [eq(DB.Tables.participants.event_id, event.id)];
		if (query.status) {
			conditions.push(eq(DB.Tables.participants.status, query.status));
		}
		if (query.search) {
			const pattern = `%${query.search}%`;
			const searchPredicate = or(
				like(DB.Tables.participants.first_name, pattern),
				like(DB.Tables.participants.last_name, pattern),
				like(DB.Tables.participants.guardian_name, pattern),
				like(DB.Tables.participants.email, pattern),
			);
			if (searchPredicate) conditions.push(searchPredicate);
		}

		const participants = await DB.instance()
			.select()
			.from(DB.Tables.participants)
			.where(and(...conditions))
			.orderBy(
				asc(DB.Tables.participants.last_name),
				asc(DB.Tables.participants.first_name),
				asc(DB.Tables.participants.id),
			)
			.all();

		return APIResponse.success(
			c,
			"Participants retrieved successfully",
			await toResponse(event, participants, EventAccess.can(c, "participants:view_medical")),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create participant",
		description:
			"Register a participant, including medical information and up to five emergency contacts. When the event's `max_participants` is reached, an active registration is stored with status `waitlist` instead.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Participant created successfully",
				EventParticipantsModel.Create.Response,
			),
			APIResponseSpec.badRequest(
				"The room does not belong to this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage participants"),
		),
	}),

	zValidator("json", EventParticipantsModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "participants:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage participants");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { emergency_contacts, ...body } = c.req.valid("json") as EventParticipantsModel.Create.Body;

		const roomError = await validateRoom(event.id, body.room_id);
		if (roomError) return APIResponse.badRequest(c, roomError);

		let status = body.status;
		if (event.max_participants !== null && ACTIVE_STATUSES.includes(status)) {
			const active = await DB.instance()
				.select({ value: count() })
				.from(DB.Tables.participants)
				.where(
					and(
						eq(DB.Tables.participants.event_id, event.id),
						inArray(DB.Tables.participants.status, ACTIVE_STATUSES),
					),
				)
				.get();
			if ((active?.value ?? 0) >= event.max_participants) {
				status = "waitlist";
			}
		}

		let participant: DB.Models.Participant;
		try {
			participant = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const created = await tx
					.insert(DB.Tables.participants)
					.values({ ...body, status, event_id: event.id })
					.returning()
					.get();
				await replaceEmergencyContacts(created.id, emergency_contacts, tx);
				return created;
			});
		} catch (error: any) {
			Logger.error("Failed to create participant", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create participant");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "participant",
			entityId: participant.id,
			summary:
				status === body.status
					? `Teilnehmer „${fullName(participant)}“ angelegt`
					: `Teilnehmer „${fullName(participant)}“ angelegt (Warteliste, Platzlimit erreicht)`,
		});

		return APIResponse.created(
			c,
			"Participant created successfully",
			await toDetailResponse(c, participant),
		);
	},
);

router.get(
	"/export",

	APIRouteSpec.authenticated({
		summary: "Export participants as CSV",
		description:
			"Download all participants of the event as a `;`-separated, UTF-8 (with BOM) CSV file for spreadsheets. Includes medical information and emergency contacts.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: {
			200: {
				description: "CSV file with one row per participant",
				content: {
					"text/csv": {
						schema: { type: "string" },
					},
				},
			},
			...APIResponseSpec.notFound("Event not found"),
			...APIResponseSpec.forbidden("You are not allowed to view participants"),
		},
	}),

	async (c) => {
		if (!EventAccess.can(c, "participants:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view participants");
		}

		const event = c.get("event");
		const participants = await toResponse(
			event,
			await DB.instance()
				.select()
				.from(DB.Tables.participants)
				.where(eq(DB.Tables.participants.event_id, event.id))
				.orderBy(asc(DB.Tables.participants.last_name), asc(DB.Tables.participants.first_name))
				.all(),
			// Health columns stay empty for callers outside the event's team.
			EventAccess.can(c, "participants:view_medical"),
		);

		const header = [
			"Nachname",
			"Vorname",
			"Geburtsdatum",
			"Alter",
			"Geschlecht",
			"Zimmer",
			"Status",
			"Beitrag bezahlt",
			"E-Mail",
			"Telefon",
			"Adresse",
			"Erziehungsberechtigte(r)",
			"Telefon Erziehungsberechtigte(r)",
			"Allergien",
			"Medikamente",
			"Ernährung",
			"Medizinische Hinweise",
			"Schwimmer",
			"Fotoerlaubnis",
			"Notfallkontakte",
			"Notizen",
		];

		const rows = participants.map((participant) => [
			participant.last_name,
			participant.first_name,
			participant.birth_date,
			participant.age,
			participant.gender ? GENDER_LABELS[participant.gender] : null,
			participant.room?.name ?? null,
			STATUS_LABELS[participant.status],
			participant.fee_paid,
			participant.email,
			participant.phone,
			participant.address,
			participant.guardian_name,
			participant.guardian_phone,
			participant.allergies,
			participant.medications,
			participant.dietary_requirements,
			participant.medical_notes,
			participant.can_swim,
			participant.photo_consent,
			participant.emergency_contacts
				.map(
					(contact) =>
						`${contact.name}${contact.relation ? ` (${contact.relation})` : ""}: ${contact.phone}`,
				)
				.join(" | "),
			participant.notes,
		]);

		const csv = `﻿${[header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;

		const asciiName =
			event.name
				.normalize("NFKD")
				.replace(/[^\w.-]+/g, "_")
				.replace(/^_+|_+$/g, "") || "event";
		const fileName = `Teilnehmer_${asciiName}.csv`;

		return c.body(csv, 200, {
			"Content-Type": "text/csv; charset=utf-8",
			"Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(`Teilnehmer_${event.name}.csv`)}`,
			"Cache-Control": "no-store",
		});
	},
);

router.use(
	"/:participantId/*",
	zValidator("param", EventParticipantsModel.Params),
	async (c, next) => {
		const event = c.get("event");
		const participantId = EventParticipantsModel.Params.shape.participantId.safeParse(
			c.req.param("participantId"),
		);
		if (!participantId.success) return APIResponse.badRequest(c, "Invalid participant id");

		const participant = await DB.instance()
			.select()
			.from(DB.Tables.participants)
			.where(
				and(
					eq(DB.Tables.participants.id, participantId.data),
					eq(DB.Tables.participants.event_id, event.id),
				),
			)
			.get();

		if (!participant) return APIResponse.notFound(c, "Participant not found");

		c.set("participant", participant);
		await next();
	},
);

router.get(
	"/:participantId",

	APIRouteSpec.authenticated({
		summary: "Get participant",
		description: "Retrieve a participant with emergency contacts and all staff notes.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Participant retrieved successfully",
				EventParticipantsModel.ParticipantDetail,
			),
			APIResponseSpec.notFound("Participant not found"),
			APIResponseSpec.forbidden("You are not allowed to view participants"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "participants:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view participants");
		}

		return APIResponse.success(
			c,
			"Participant retrieved successfully",
			await toDetailResponse(c, c.get("participant")),
		);
	},
);

router.put(
	"/:participantId",

	APIRouteSpec.authenticated({
		summary: "Update participant",
		description: "Update a participant. `emergency_contacts`, when given, replaces the whole list.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Participant updated successfully",
				EventParticipantsModel.Update.Response,
			),
			APIResponseSpec.badRequest(
				"The room does not belong to this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Participant not found"),
			APIResponseSpec.forbidden("You are not allowed to manage participants"),
		),
	}),

	zValidator("json", EventParticipantsModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "participants:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage participants");
		}

		const event = c.get("event");
		const participant = c.get("participant");
		const { emergency_contacts, ...input } = c.req.valid(
			"json",
		) as EventParticipantsModel.Update.Body;
		// Callers who cannot see health data (core team outside the team) must not overwrite it
		// with the blanks they were shown.
		const body: Omit<EventParticipantsModel.Update.Body, "emergency_contacts"> = { ...input };
		if (!EventAccess.can(c, "participants:view_medical")) {
			for (const field of MEDICAL_FIELDS) delete body[field];
		}

		const roomError = await validateRoom(event.id, body.room_id);
		if (roomError) return APIResponse.badRequest(c, roomError);

		let updated: DB.Models.Participant;
		try {
			updated = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const row = await tx
					.update(DB.Tables.participants)
					.set({ ...body, updated_at: Date.now() })
					.where(eq(DB.Tables.participants.id, participant.id))
					.returning()
					.get();
				if (emergency_contacts !== undefined) {
					await replaceEmergencyContacts(participant.id, emergency_contacts, tx);
				}
				return row;
			});
		} catch (error: any) {
			Logger.error("Failed to update participant", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update participant");
		}

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "update",
			entityType: "participant",
			entityId: participant.id,
			summary: `Teilnehmer „${fullName(updated)}“ bearbeitet`,
			// Field names only — never the (medical) values.
			metadata: {
				fields: [
					...Object.keys(body),
					...(emergency_contacts !== undefined ? ["emergency_contacts"] : []),
				],
			},
		});

		return APIResponse.success(
			c,
			"Participant updated successfully",
			await toDetailResponse(c, updated),
		);
	},
);

router.delete(
	"/:participantId",

	APIRouteSpec.authenticated({
		summary: "Delete participant",
		description: "Permanently delete a participant together with emergency contacts and staff notes.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Participant deleted successfully"),
			APIResponseSpec.notFound("Participant not found"),
			APIResponseSpec.forbidden("You are not allowed to manage participants"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "participants:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage participants");
		}

		const participant = c.get("participant");

		await DB.instance()
			.delete(DB.Tables.participants)
			.where(eq(DB.Tables.participants.id, participant.id))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "participant",
			entityId: participant.id,
			summary: `Teilnehmer „${fullName(participant)}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Participant deleted successfully");
	},
);

router.post(
	"/:participantId/notes",

	APIRouteSpec.authenticated({
		summary: "Add participant note",
		description: "Add a staff note about a participant (visible to the event's staff).",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Note created successfully", EventParticipantsModel.CreateNote.Response),
			APIResponseSpec.notFound("Participant not found"),
			APIResponseSpec.forbidden("You are not allowed to add notes to participants"),
		),
	}),

	zValidator("json", EventParticipantsModel.CreateNote.Body),

	async (c) => {
		if (!EventAccess.can(c, "participants:add_note")) {
			return APIResponse.forbidden(c, "You are not allowed to add notes to participants");
		}

		const participant = c.get("participant");
		const { userId } = c.get("eventAccess");
		const { content } = c.req.valid("json") as EventParticipantsModel.CreateNote.Body;

		const note = await DB.instance()
			.insert(DB.Tables.participantNotes)
			.values({ participant_id: participant.id, author_id: userId, content })
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: c.get("event").id,
			action: "create",
			entityType: "participant_note",
			entityId: note.id,
			summary: `Notiz zu Teilnehmer „${fullName(participant)}“ hinzugefügt`,
		});

		const [result] = await toNotesResponse(c, [note]);
		return APIResponse.created(c, "Note created successfully", result!);
	},
);

router.delete(
	"/:participantId/notes/:noteId",

	APIRouteSpec.authenticated({
		summary: "Delete participant note",
		description: "Delete a staff note. Allowed for its author and for leaders.",
		tags: [DOCS_TAGS.EVENTS.PARTICIPANTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Note deleted successfully"),
			APIResponseSpec.notFound("Note not found"),
			APIResponseSpec.forbidden("You are not allowed to delete this note"),
		),
	}),

	zValidator("param", EventParticipantsModel.NoteParams),

	async (c) => {
		const participant = c.get("participant");
		const { noteId } = c.req.valid("param") as EventParticipantsModel.NoteParams;

		const note = await DB.instance()
			.select()
			.from(DB.Tables.participantNotes)
			.where(
				and(
					eq(DB.Tables.participantNotes.id, noteId),
					eq(DB.Tables.participantNotes.participant_id, participant.id),
				),
			)
			.get();

		if (!note) return APIResponse.notFound(c, "Note not found");

		if (!canDeleteNote(c, note)) {
			return APIResponse.forbidden(c, "You are not allowed to delete this note");
		}

		await DB.instance()
			.delete(DB.Tables.participantNotes)
			.where(eq(DB.Tables.participantNotes.id, note.id))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "participant_note",
			entityId: note.id,
			summary: `Notiz zu Teilnehmer „${fullName(participant)}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Note deleted successfully");
	},
);
