import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { OfficeDiscovery } from "../../../../../../office/discovery";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { FileAccess } from "../../../../../utils/fileAccess";
import { FileLibrary } from "../../../../../utils/fileLibrary";
import { FileService } from "../../../../../utils/fileService";
import { FileTrash } from "../../../../../utils/fileTrash";
import { getAuthUserId } from "../../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OrgDocumentsModel } from "./model";

/**
 * The organisation-wide document library. The Kernteam manages it; everything is Kernteam-only
 * unless an access list opens it to members, org groups or single people (`FileAccess`). Rename,
 * move, delete, access lists and share links go through the shared `/files/{fileId}` routes.
 */
export const router = new Hono().basePath("/documents");

const LOCATION: FileService.Location = { scope: "org", eventId: null };

async function viewerOf(c: Context, options: { asMember?: boolean } = {}) {
	return await FileAccess.viewer(AuthHandler.AuthContext.get(c), LOCATION, options);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List organisation documents",
		description:
			"List a folder of the organisation's document library (the root without `parent_id`) with the breadcrumb path — only what the caller may see, each item with the caller's `permissions`. The Kernteam sees everything plus the access lists (`access`); with `view=member` it sees the library like a member.",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Documents retrieved successfully", OrgDocumentsModel.GetAll.Response),
			APIResponseSpec.forbidden("You are not allowed to view documents"),
			APIResponseSpec.notFound("Folder not found"),
		),
	}),

	zValidator("query", OrgDocumentsModel.GetAll.Query),

	async (c) => {
		const { parent_id, view } = c.req.valid("query") as OrgDocumentsModel.GetAll.Query;
		const viewer = await viewerOf(c, { asMember: view === "member" });
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to view documents");

		const result = await FileLibrary.list(viewer, parent_id);
		if (!result.ok) {
			return result.status === 404
				? APIResponse.notFound(c, result.message)
				: APIResponse.forbidden(c, result.message);
		}
		return APIResponse.success(
			c,
			"Documents retrieved successfully",
			result.data satisfies OrgDocumentsModel.GetAll.Response,
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Upload organisation document",
		description:
			"Upload a file into the organisation's document library — the Kernteam anywhere, others where an access list lets them upload.",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Document uploaded successfully", OrgDocumentsModel.Upload.Response),
			APIResponseSpec.badRequest(
				"Parent folder not found / File is too large / Syntax or validation error in request",
			),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	// Multipart only: otherwise the generated client may pick the URL-encoded serializer.
	zValidator("form", OrgDocumentsModel.Upload.Form, undefined, { media: "multipart/form-data" }),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const userId = getAuthUserId(c);
		const form = c.req.valid("form") as OrgDocumentsModel.Upload.Form;

		const target = await FileLibrary.resolveTarget(viewer, form.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		try {
			const file = await FileService.upload(LOCATION, target.parentId, form.file, userId);
			if (!file) return APIResponse.badRequest(c, "File is too large");

			await AuditLog.record({
				userId,
				action: "create",
				entityType: "file",
				entityId: file.id,
				summary: `Dokument „${file.name}“ in die Organisationsablage hochgeladen`,
			});

			return APIResponse.created(
				c,
				"Document uploaded successfully",
				await FileLibrary.created(viewer, file),
			);
		} catch (error: any) {
			Logger.error("Failed to upload organisation document", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to upload document");
		}
	},
);

router.post(
	"/folders",

	APIRouteSpec.authenticated({
		summary: "Create organisation folder",
		description:
			"Create a folder in the organisation's document library — the Kernteam anywhere, others where an access list lets them upload.",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Folder created successfully", OrgDocumentsModel.CreateFolder.Response),
			APIResponseSpec.badRequest(
				`Parent folder not found / ${FileService.TOO_DEEP} / Syntax or validation error in request`,
			),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	zValidator("json", OrgDocumentsModel.CreateFolder.Body),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as OrgDocumentsModel.CreateFolder.Body;

		const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		if (!(await FileService.fitsDepth(target.parentId))) {
			return APIResponse.badRequest(c, FileService.TOO_DEEP);
		}

		const folder = await FileService.createFolder(
			LOCATION,
			target.parentId,
			FileService.sanitizeName(body.name),
			userId,
		);

		await AuditLog.record({
			userId,
			action: "create",
			entityType: "file",
			entityId: folder.id,
			summary: `Ordner „${folder.name}“ in der Organisationsablage angelegt`,
		});

		return APIResponse.created(
			c,
			"Folder created successfully",
			await FileLibrary.created(viewer, folder),
		);
	},
);

// --- Papierkorb -----------------------------------------------------------------------------

router.get(
	"/trash",

	APIRouteSpec.authenticated({
		summary: "List Papierkorb",
		description:
			"Deleted documents and folders of this library, newest first: everything for managers, otherwise what the caller deleted. Deleted for good after 30 days (`purge_at`).",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Papierkorb retrieved successfully", OrgDocumentsModel.Trash.Response),
			APIResponseSpec.forbidden("You are not allowed to view documents"),
		),
	}),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer?.inLibrary) return APIResponse.forbidden(c, "You are not allowed to view documents");
		return APIResponse.success(
			c,
			"Papierkorb retrieved successfully",
			(await FileTrash.list(viewer)) satisfies OrgDocumentsModel.Trash.Response,
		);
	},
);

router.post(
	"/trash/:fileId/restore",

	APIRouteSpec.authenticated({
		summary: "Restore from Papierkorb",
		description:
			"Put a deleted document or folder back into its folder. When that folder is in the Papierkorb too, managers restore it to the top level with an access list of its own that lets only them in; others restore the folder first. Managers restore everything, others what they deleted.",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Restored successfully", OrgDocumentsModel.Trash.Item),
			APIResponseSpec.notFound("Not in the Papierkorb"),
			APIResponseSpec.conflict(
				"The folder it was in is in the Papierkorb too: restore the folder first",
			),
		),
	}),

	zValidator("param", OrgDocumentsModel.Trash.Params),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.notFound(c, "Not in the Papierkorb");
		const { fileId } = c.req.valid("param") as OrgDocumentsModel.Trash.Params;
		const result = await FileTrash.restore(viewer, fileId);
		if (!result.ok) {
			return result.status === 409
				? APIResponse.conflict(c, result.message)
				: APIResponse.notFound(c, result.message);
		}

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "file",
			entityId: result.file.id,
			summary: `${result.file.kind === "folder" ? "Ordner" : "Dokument"} „${result.file.name}“ aus dem Papierkorb wiederhergestellt`,
		});

		return APIResponse.success(
			c,
			"Restored successfully",
			await FileLibrary.created(viewer, result.file),
		);
	},
);

router.delete(
	"/trash/:fileId",

	APIRouteSpec.authenticated({
		summary: "Delete for good",
		description:
			"Delete an item in the Papierkorb for good, with everything inside it (managers only).",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Deleted successfully"),
			APIResponseSpec.notFound("Not in the Papierkorb"),
			APIResponseSpec.forbidden("Only managers can delete for good"),
		),
	}),

	zValidator("param", OrgDocumentsModel.Trash.Params),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.notFound(c, "Not in the Papierkorb");
		const { fileId } = c.req.valid("param") as OrgDocumentsModel.Trash.Params;
		const result = await FileTrash.purge(viewer, fileId);
		if (!result.ok) {
			return result.status === 403
				? APIResponse.forbidden(c, result.message)
				: APIResponse.notFound(c, result.message);
		}

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "file",
			entityId: result.file.id,
			summary: `${result.file.kind === "folder" ? "Ordner" : "Dokument"} „${result.file.name}“ endgültig gelöscht`,
		});

		return APIResponse.successNoData(c, "Deleted successfully");
	},
);

router.delete(
	"/trash",

	APIRouteSpec.authenticated({
		summary: "Empty Papierkorb",
		description: "Delete everything in this library's Papierkorb for good (managers only).",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Papierkorb emptied successfully"),
			APIResponseSpec.forbidden("Only managers can delete for good"),
		),
	}),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "Only managers can delete for good");
		const result = await FileTrash.empty(viewer);
		if (!result.ok) return APIResponse.forbidden(c, result.message);

		if (result.count > 0) {
			await AuditLog.record({
				userId: getAuthUserId(c),
				action: "delete",
				entityType: "file",
				summary: `Papierkorb geleert (${result.count} Einträge endgültig gelöscht)`,
			});
		}

		return APIResponse.successNoData(c, "Papierkorb emptied successfully");
	},
);

const OFFICE_LABELS = { docx: "Textdokument", xlsx: "Tabelle", pptx: "Präsentation" } as const;

router.post(
	"/office",

	APIRouteSpec.authenticated({
		summary: "Create office document",
		description:
			"Create an empty Word, Excel or PowerPoint document — where the caller may upload, and only when office editing is configured (`office` in `GET /instance`). It then opens in the office editor (`POST /files/{fileId}/office`).",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Document created successfully",
				OrgDocumentsModel.CreateOffice.Response,
			),
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
			APIResponseSpec.notFound("Office editing is not available"),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	zValidator("json", OrgDocumentsModel.CreateOffice.Body),

	async (c) => {
		if (!OfficeDiscovery.enabled()) return APIResponse.notFound(c, "Office editing is not available");
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const body = c.req.valid("json") as OrgDocumentsModel.CreateOffice.Body;
		const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		const userId = getAuthUserId(c);
		const file = await FileService.createOffice(
			LOCATION,
			target.parentId,
			body.name,
			body.type,
			userId,
		);
		if (!file) return APIResponse.badRequest(c, "File is too large");

		await AuditLog.record({
			userId,
			action: "create",
			entityType: "file",
			entityId: file.id,
			summary: `${OFFICE_LABELS[body.type]} „${file.name}“ in der Organisationsablage angelegt`,
		});

		return APIResponse.created(
			c,
			"Document created successfully",
			await FileLibrary.created(viewer, file),
		);
	},
);
