import { z } from "zod";
import { FileService } from "../fileService";
import { FileTrash } from "../fileTrash";

/** The document library routes (`createFileLibraryRouter`): the org library and event documents. */
export namespace FileLibraryModel.GetAll {
	export const Query = FileService.ListQuery;
	export type Query = z.infer<typeof Query>;

	export const Response = FileService.FolderListingSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace FileLibraryModel.Upload {
	export const Form = FileService.UploadForm;
	export type Form = z.infer<typeof Form>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace FileLibraryModel.CreateFolder {
	export const Body = FileService.CreateFolderBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace FileLibraryModel.CreateOffice {
	export const Body = FileService.CreateOfficeBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace FileLibraryModel.Trash {
	export const Response = FileTrash.ListResponse;
	export type Response = z.infer<typeof Response>;

	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;
}
