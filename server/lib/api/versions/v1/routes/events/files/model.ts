import type { z } from "zod";
import { FileService } from "../../../../../utils/fileService";

export namespace EventFilesModel {
	export const Item = FileService.ItemSchema;
	export type Item = z.infer<typeof Item>;
}

export namespace EventFilesModel.GetAll {
	export const Query = FileService.ListQuery;
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
