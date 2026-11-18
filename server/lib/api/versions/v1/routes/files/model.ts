import { z } from "zod";
import { Collab as CollabModule } from "../../../../utils/collab";
import { FileService } from "../../../../utils/fileService";
import { FileVersions } from "../../../../utils/fileVersions";
import { FileAccessModel } from "../../../../utils/shared-models/fileAccess";

export namespace FilesModel {
	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;

	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace FilesModel.Details {
	/** A file or folder with where it lives (for the file page). */
	export const Response = FilesModel.Item.extend({
		/** Folders above it, from the top (only org and event documents). */
		path: z.array(z.object({ id: z.number(), name: z.string() })),
		/** The event of event documents. */
		event: z.object({ id: z.number(), name: z.string() }).nullable(),
	});
	export type Response = z.infer<typeof Response>;
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

export namespace FilesModel.Access {
	export const Response = FileAccessModel.View;
	export type Response = z.infer<typeof Response>;

	export const Body = FileAccessModel.UpdateBody;
	export type Body = z.infer<typeof Body>;

	export const Candidates = z.array(FileAccessModel.Candidate);
	export type Candidates = z.infer<typeof Candidates>;
}

export namespace FilesModel.Upload {
	/** New contents for a file ("Neue Fassung"). */
	export const Form = z.object({
		file: z.file().describe("The new contents"),
	});
	export type Form = z.infer<typeof Form>;
}

export namespace FilesModel.Collab {
	export const SyncBody = CollabModule.SyncBody;
	export type SyncBody = z.infer<typeof SyncBody>;
	export const SyncResponse = CollabModule.SyncResponse;
	export type SyncResponse = z.infer<typeof SyncResponse>;
	export const SaveBody = CollabModule.SaveBody;
	export type SaveBody = z.infer<typeof SaveBody>;
	export const SaveResponse = CollabModule.SaveResponse;
	export type SaveResponse = z.infer<typeof SaveResponse>;
}

export namespace FilesModel.Versions {
	export const Response = z.array(FileVersions.ItemSchema);
	export type Response = z.infer<typeof Response>;

	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
		versionId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const ContentParams = Params.extend({
		/** Only names the browser tab and the download; not checked. */
		filename: z.string().max(255).optional(),
	});
	export type ContentParams = z.infer<typeof ContentParams>;
}

export namespace FilesModel.Office {
	/** How the browser opens the office editor: post `access_token` + `access_token_ttl` to `url`. */
	export const Response = z.object({
		url: z.string(),
		access_token: z.string(),
		/** When the token expires (unix ms). */
		access_token_ttl: z.number(),
		/** `view` when the person may only read, or a Markdown session holds the file. */
		mode: z.enum(["edit", "view"]),
	});
	export type Response = z.infer<typeof Response>;
}
