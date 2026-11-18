import { z } from "zod";
import { FileService } from "../../../../../utils/fileService";
import { FileTrash } from "../../../../../utils/fileTrash";

export namespace OrgDocumentsModel.GetAll {
	export const Query = FileService.ListQuery;
	export type Query = z.infer<typeof Query>;

	export const Response = FileService.FolderListingSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgDocumentsModel.Upload {
	export const Form = FileService.UploadForm;
	export type Form = z.infer<typeof Form>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgDocumentsModel.CreateFolder {
	export const Body = FileService.CreateFolderBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgDocumentsModel.CreateMarkdown {
	export const Body = FileService.CreateMarkdownBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgDocumentsModel.Trash {
	export const Response = FileTrash.ListResponse;
	export type Response = z.infer<typeof Response>;

	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;
}

export namespace OrgDocumentsModel.CreateOffice {
	export const Body = FileService.CreateOfficeBody;
	export type Body = z.infer<typeof Body>;

	export const Response = FileService.ItemSchema;
	export type Response = z.infer<typeof Response>;
}
