import { z } from "zod";
import { FileService } from "../../../../utils/fileService";

export namespace FilesModel {
	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;

	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace FilesModel.Content {
	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
		/** Only names the browser tab and the download; not checked. */
		filename: z.string().max(255).optional(),
	});
	export type Params = z.infer<typeof Params>;

	export const Query = z.object({
		/** `1` forces `Content-Disposition: attachment`. */
		download: z.enum(["0", "1"]).optional(),
	});
	export type Query = z.infer<typeof Query>;
}

export namespace FilesModel.Update {
	export const Body = z
		.object({
			name: z.string().trim().min(1).max(200),
			/** Target folder in the same library; `null` moves to the root. */
			parent_id: z.number().int().positive().nullable(),
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = FilesModel.Item;
	export type Response = z.infer<typeof Response>;
}
