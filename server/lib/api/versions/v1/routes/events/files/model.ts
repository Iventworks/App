import { z } from "zod";
import { FileService } from "../../../../../utils/fileService";
import { FileTrash } from "../../../../../utils/fileTrash";

export namespace EventFilesModel {
	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;
}

export namespace EventFilesModel.GetAll {
	export const Query = FileService.ListQuery.omit({ view: true });
	export type Query = z.infer<typeof Query>;

	export const Response = FileService.FolderListingSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace EventFilesModel.Upload {
	export const Form = FileService.UploadForm;
	export type Form = z.infer<typeof Form>;

	export const Response = EventFilesModel.Item;
	export type Response = z.infer<typeof Response>;
}

export namespace EventFilesModel.CreateFolder {
	export const Body = FileService.CreateFolderBody;
	export type Body = z.infer<typeof Body>;

	export const Response = EventFilesModel.Item;
	export type Response = z.infer<typeof Response>;
}

export namespace EventFilesModel.CreateMarkdown {
	export const Body = FileService.CreateMarkdownBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace EventFilesModel.Trash {
	export const Response = FileTrash.ListResponse;
	export type Response = z.infer<typeof Response>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;
}

export namespace EventFilesModel.CreateOffice {
	export const Body = FileService.CreateOfficeBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}
