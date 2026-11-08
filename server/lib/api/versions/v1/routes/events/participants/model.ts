import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { GENDERS, PARTICIPANT_STATUSES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventParticipantsModel {
	export const EmergencyContact = createSelectSchema(DB.Tables.participantEmergencyContacts);
	export type EmergencyContact = z.infer<typeof EmergencyContact>;

	export const RoomRef = z.object({
		id: z.number(),
		name: z.string(),
	});
	export type RoomRef = z.infer<typeof RoomRef>;

	export const Participant = createSelectSchema(DB.Tables.participants).extend({
		/** Age in full years on the event's start date (null without birth date). */
		age: z.number().nullable(),
		room: RoomRef.nullable(),
		emergency_contacts: z.array(EmergencyContact),
		note_count: z.number(),
	});
	export type Participant = z.infer<typeof Participant>;

	export const Note = z.object({
		id: z.number(),
		content: z.string(),
		created_at: z.number(),
		author: UserSummary.Schema.nullable(),
		/** Whether the caller may delete this note (author or participants:manage). */
		can_delete: z.boolean(),
	});
	export type Note = z.infer<typeof Note>;

	/** `staff_notes` are the staff's notes about the participant; `notes` stays the participant's own "Hinweise" text. */
	export const ParticipantDetail = Participant.extend({
		staff_notes: z.array(Note),
	});
	export type ParticipantDetail = z.infer<typeof ParticipantDetail>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		participantId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const NoteParams = Params.extend({
		noteId: z.coerce.number().int().positive(),
	});
	export type NoteParams = z.infer<typeof NoteParams>;

	export const EmergencyContactInput = z.object({
		name: z.string().trim().min(1).max(120),
		relation: z.string().trim().max(80).nullable().optional(),
		phone: z.string().trim().min(1).max(40),
	});
	export type EmergencyContactInput = z.infer<typeof EmergencyContactInput>;

	const optionalText = (max: number) => z.string().trim().max(max).nullable();
	const longText = z.string().max(10_000);

	/** Field rules shared by create and update. */
	export const ParticipantFields = {
		first_name: z.string().trim().min(1).max(80),
		last_name: z.string().trim().min(1).max(80),
		birth_date: z.iso.date("Expected a date in the format YYYY-MM-DD").nullable(),
		gender: z.enum(GENDERS).nullable(),
		email: optionalText(200),
		phone: optionalText(40),
		address: optionalText(400),
		guardian_name: optionalText(120),
		guardian_phone: optionalText(40),
		allergies: longText,
		medications: longText,
		dietary_requirements: longText,
		medical_notes: longText,
		can_swim: z.boolean().nullable(),
		photo_consent: z.boolean(),
		notes: longText,
		room_id: z.number().int().positive().nullable(),
		status: z.enum(PARTICIPANT_STATUSES),
		fee_paid: z.boolean(),
		emergency_contacts: z.array(EmergencyContactInput).max(5),
	};
}

export namespace EventParticipantsModel.GetAll {
	export const Query = z.object({
		/** Matches first name, last name, guardian name or email. */
		search: z.string().trim().min(1).max(100).optional(),
		status: z.enum(PARTICIPANT_STATUSES).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(EventParticipantsModel.Participant);
	export type Response = z.infer<typeof Response>;
}

export namespace EventParticipantsModel.Create {
	const F = EventParticipantsModel.ParticipantFields;

	export const Body = z.object({
		first_name: F.first_name,
		last_name: F.last_name,
		birth_date: F.birth_date.default(null),
		gender: F.gender.default(null),
		email: F.email.default(null),
		phone: F.phone.default(null),
		address: F.address.default(null),
		guardian_name: F.guardian_name.default(null),
		guardian_phone: F.guardian_phone.default(null),
		allergies: F.allergies.default(""),
		medications: F.medications.default(""),
		dietary_requirements: F.dietary_requirements.default(""),
		medical_notes: F.medical_notes.default(""),
		can_swim: F.can_swim.default(null),
		photo_consent: F.photo_consent.default(false),
		notes: F.notes.default(""),
		room_id: F.room_id.default(null),
		/**
		 * Defaults to `registered`. When the event's `max_participants` is reached, a new
		 * participant with an active status (`registered`/`confirmed`) is created with
		 * status `waitlist` instead.
		 */
		status: F.status.default("registered"),
		fee_paid: F.fee_paid.default(false),
		emergency_contacts: F.emergency_contacts.default([]),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventParticipantsModel.ParticipantDetail;
	export type Response = z.infer<typeof Response>;
}

export namespace EventParticipantsModel.Update {
	export const Body = z
		.object(EventParticipantsModel.ParticipantFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventParticipantsModel.ParticipantDetail;
	export type Response = z.infer<typeof Response>;
}

export namespace EventParticipantsModel.CreateNote {
	export const Body = z.object({
		content: z.string().trim().min(1).max(5_000),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventParticipantsModel.Note;
	export type Response = z.infer<typeof Response>;
}
