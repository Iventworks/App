import type { z } from "zod";
import { FileService } from "../../../../../utils/fileService";

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
