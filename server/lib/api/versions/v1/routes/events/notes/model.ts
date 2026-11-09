import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventNotesModel {
	export const GroupRef = z.object({
		id: z.number(),
		name: z.string(),
		color: z.string().nullable(),
	});
	export type GroupRef = z.infer<typeof GroupRef>;

	export const Note = createSelectSchema(DB.Tables.notes).omit({ org_id: true }).extend({
		creator: UserSummary.Schema.nullable(),
		updater: UserSummary.Schema.nullable(),
		group: GroupRef.nullable(),
		can_edit: z.boolean(),
		can_delete: z.boolean(),
	});
	export type Note = z.infer<typeof Note>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		noteId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const NoteFields = {
		title: z.string().trim().min(1).max(200),
		/** Markdown. */
		content: z.string().max(100_000),
		pinned: z.boolean(),
	};
}

export namespace EventNotesModel.GetAll {
	export const Query = z.object({
		/** Only the notes of this group. */
		group_id: z.coerce.number().int().positive().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(EventNotesModel.Note);
	export type Response = z.infer<typeof Response>;
}

export namespace EventNotesModel.Create {
	export const Body = z.object({
		title: EventNotesModel.NoteFields.title,
		content: EventNotesModel.NoteFields.content.default(""),
		pinned: EventNotesModel.NoteFields.pinned.default(false),
		/** Set for a group note (e.g. Küchenteam); omit/null for an event-wide note. */
		group_id: z.number().int().positive().nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventNotesModel.Note;
	export type Response = z.infer<typeof Response>;
}

export namespace EventNotesModel.Update {
	export const Body = z
		.object(EventNotesModel.NoteFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventNotesModel.Note;
	export type Response = z.infer<typeof Response>;
}
