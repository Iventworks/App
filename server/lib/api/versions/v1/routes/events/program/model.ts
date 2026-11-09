import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { FileService } from "../../../../../utils/fileService";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventProgramModel {
	export const ProgramItem = createSelectSchema(DB.Tables.programItems)
		.omit({ org_id: true })
		.extend({
			responsible: z.array(UserSummary.Schema),
			/** Linked documents/folders (event documents or the organisation library). */
			files: z.array(FileService.ItemSchema),
			/** True when the caller is one of the responsible staff members. */
			is_mine: z.boolean(),
		});
	export type ProgramItem = z.infer<typeof ProgramItem>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		programItemId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	/** Field rules shared by create and update. */
	export const ProgramItemFields = {
		title: z.string().trim().min(1).max(200),
		description: z.string().max(10_000),
		location: z.string().trim().max(200).nullable(),
		category: z.string().trim().max(60).nullable(),
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #f97316")
			.nullable(),
		start_at: z.number().int().nonnegative(),
		end_at: z.number().int().nonnegative(),
		/** Staff members of the event responsible for this item (replaces the set). */
		responsible_user_ids: z.array(z.number().int().positive()).max(50),
		/** Event documents or organisation documents (files or folders) to attach. */
		file_ids: z.array(z.number().int().positive()).max(50),
	};
}

export namespace EventProgramModel.GetAll {
	export const Query = z.object({
		/** Only items ending after this instant (unix ms). */
		from: z.coerce.number().int().nonnegative().optional(),
		/** Only items starting before this instant (unix ms). */
		to: z.coerce.number().int().nonnegative().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(EventProgramModel.ProgramItem);
	export type Response = z.infer<typeof Response>;
}

export namespace EventProgramModel.Create {
	const F = EventProgramModel.ProgramItemFields;

	export const Body = z
		.object({
			title: F.title,
			description: F.description.default(""),
			location: F.location.default(null),
			category: F.category.default(null),
			color: F.color.default(null),
			start_at: F.start_at,
			end_at: F.end_at,
			responsible_user_ids: F.responsible_user_ids.default([]),
			file_ids: F.file_ids.default([]),
		})
		.refine((data) => data.end_at > data.start_at, {
			message: "end_at must be after start_at",
			path: ["end_at"],
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventProgramModel.ProgramItem;
	export type Response = z.infer<typeof Response>;
}

export namespace EventProgramModel.Update {
	export const Body = z
		.object(EventProgramModel.ProgramItemFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventProgramModel.ProgramItem;
	export type Response = z.infer<typeof Response>;
}

export namespace EventProgramModel.Duplicate {
	export const Body = z.object({
		/** Start of the copy (unix ms); the duration of the original is kept. */
		start_at: z.number().int().nonnegative(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventProgramModel.ProgramItem;
	export type Response = z.infer<typeof Response>;
}
