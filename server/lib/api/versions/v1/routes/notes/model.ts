import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../db";

export namespace PersonalNotesModel {
	export const Note = createSelectSchema(DB.Tables.notes).omit({ org_id: true });
	export type Note = z.infer<typeof Note>;

	export const Params = z.object({
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

export namespace PersonalNotesModel.GetAll {
	export const Query = z.object({
		search: z.string().trim().min(1).max(100).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(PersonalNotesModel.Note);
	export type Response = z.infer<typeof Response>;
}

export namespace PersonalNotesModel.Create {
	export const Body = z.object({
		title: PersonalNotesModel.NoteFields.title,
		content: PersonalNotesModel.NoteFields.content.default(""),
		pinned: PersonalNotesModel.NoteFields.pinned.default(false),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = PersonalNotesModel.Note;
	export type Response = z.infer<typeof Response>;
}

export namespace PersonalNotesModel.Update {
	export const Body = z
		.object(PersonalNotesModel.NoteFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = PersonalNotesModel.Note;
	export type Response = z.infer<typeof Response>;
}
