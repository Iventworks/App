import { z } from "zod";
import { FileShares } from "../../../../utils/fileShares";

/** What a share link's visitors see: no ids of people, no internal label, no library details. */
export namespace PublicSharesModel {
	export const TokenParams = z.object({
		token: z.string().min(1).max(64),
	});
	export type TokenParams = z.infer<typeof TokenParams>;

	export const FileParams = TokenParams.extend({
		fileId: z.coerce.number().int().positive(),
	});
	export type FileParams = z.infer<typeof FileParams>;

	export const ContentParams = FileParams.extend({
		/** Only names the browser tab and the download; not checked. */
		filename: z.string().max(255).optional(),
	});
	export type ContentParams = z.infer<typeof ContentParams>;

	export const ContentQuery = z.object({
		/** `1` forces a download. */
		download: z.enum(["0", "1"]).optional(),
	});
	export type ContentQuery = z.infer<typeof ContentQuery>;

	export const Item = z.object({
		id: z.number(),
		kind: z.enum(["folder", "file"]),
		name: z.string(),
		mime_type: z.string().nullable(),
		size: z.number(),
		updated_at: z.number(),
		/** Path of the contents through this link (null for folders and drop boxes). */
		content_url: z.string().nullable(),
	});
	export type Item = z.infer<typeof Item>;

	export const Info = z.object({
		kind: z.enum(["folder", "file"]),
		requires_password: z.boolean(),
		/** False until the password was entered in this browser; everything below is null then. */
		unlocked: z.boolean(),
		item: Item.nullable(),
		permissions: FileShares.Permissions.nullable(),
		expires_at: z.number().nullable(),
	});
	export type Info = z.infer<typeof Info>;

	export const UnlockBody = z.object({
		password: z.string().min(1).max(128),
	});
	export type UnlockBody = z.infer<typeof UnlockBody>;

	export const ListQuery = z.object({
		/** A folder inside the share; omitted = the shared folder itself. */
		folder_id: z.coerce.number().int().positive().optional(),
	});
	export type ListQuery = z.infer<typeof ListQuery>;

	export const Listing = z.object({
		folder: Item,
		/** From the shared folder down to `folder`. */
		path: z.array(Item),
		items: z.array(Item),
	});
	export type Listing = z.infer<typeof Listing>;

	export const UploadForm = z.object({
		file: z.file().describe("The file to upload"),
		/** Target folder inside the share; omitted = the shared folder. */
		parent_id: z.coerce.number().int().positive().optional(),
	});
	export type UploadForm = z.infer<typeof UploadForm>;

	export const ReplaceForm = z.object({
		file: z.file().describe("The new contents"),
	});
	export type ReplaceForm = z.infer<typeof ReplaceForm>;

	export const CreateFolderBody = z.object({
		name: z.string().trim().min(1).max(200),
		parent_id: z.number().int().positive().optional(),
	});
	export type CreateFolderBody = z.infer<typeof CreateFolderBody>;

	export const RenameBody = z.object({
		name: z.string().trim().min(1).max(200),
	});
	export type RenameBody = z.infer<typeof RenameBody>;
}
