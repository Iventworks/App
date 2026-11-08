import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { FileService } from "../../../../../utils/fileService";
import { getAuthUserId } from "../../../../../utils/guards";
import { PermissionHelper } from "../../../../../utils/permissions";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OrgDocumentsModel } from "./model";

/**
 * The organisation-wide document library: guides, templates and tools everyone may read; only
 * the core team uploads. Rename/move/delete go through the shared `/files/{fileId}` routes.
 */
export const router = new Hono().basePath("/documents");

const LOCATION: FileService.Location = { scope: "org", eventId: null };

function can(c: Context, permission: "org_documents:read" | "org_documents:write") {
	return PermissionHelper.can({ authContext: AuthHandler.AuthContext.get(c), permission });
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List organisation documents",
		description:
			"List a folder of the organisation's document library (the root without `parent_id`), with the breadcrumb path.",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Documents retrieved successfully", OrgDocumentsModel.GetAll.Response),
			APIResponseSpec.forbidden("You do not have permission to access this resource"),
			APIResponseSpec.notFound("Folder not found"),
		),
	}),

	zValidator("query", OrgDocumentsModel.GetAll.Query),

	async (c) => {
		if (!can(c, "org_documents:read")) {
			return APIResponse.forbidden(c, "You do not have permission to access this resource");
		}

		const { parent_id } = c.req.valid("query") as OrgDocumentsModel.GetAll.Query;

		let folder = null;
		if (parent_id) {
			folder = await FileService.get(parent_id);
			if (!folder || !FileService.isInLocation(folder, LOCATION) || folder.kind !== "folder") {
				return APIResponse.notFound(c, "Folder not found");
			}
		}

		const [path, items] = await Promise.all([
			folder ? FileService.getPath(folder.id) : Promise.resolve([]),
			FileService.listFolder(LOCATION, folder?.id ?? null),
		]);

		return APIResponse.success(c, "Documents retrieved successfully", {
			folder: folder ? FileService.toResponse(folder) : null,
			path: path.map((entry) => FileService.toResponse(entry)),
			items: items.map((entry) => FileService.toResponse(entry)),
		} satisfies OrgDocumentsModel.GetAll.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Upload organisation document",
		description: "Upload a file into the organisation's document library (core team).",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Document uploaded successfully", OrgDocumentsModel.Upload.Response),
			APIResponseSpec.badRequest(
				"Parent folder not found / File is too large / Syntax or validation error in request",
			),
			APIResponseSpec.forbidden("Only the core team can manage organisation documents"),
		),
	}),

	// Multipart only: otherwise the generated client may pick the URL-encoded serializer.
	zValidator("form", OrgDocumentsModel.Upload.Form, undefined, { media: "multipart/form-data" }),

	async (c) => {
		if (!can(c, "org_documents:write")) {
			return APIResponse.forbidden(c, "Only the core team can manage organisation documents");
		}

		const userId = getAuthUserId(c);
		const form = c.req.valid("form") as OrgDocumentsModel.Upload.Form;

		const parent = await FileService.resolveParent(LOCATION, form.parent_id);
		if (!parent.ok) return APIResponse.badRequest(c, parent.message);

		try {
			const file = await FileService.upload(LOCATION, parent.parentId, form.file, userId);
			if (!file) return APIResponse.badRequest(c, "File is too large");

			await AuditLog.record({
				userId,
				action: "create",
				entityType: "file",
				entityId: file.id,
				summary: `Dokument „${file.name}“ in die Organisationsablage hochgeladen`,
			});

			return APIResponse.created(c, "Document uploaded successfully", FileService.toResponse(file));
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
		description: "Create a folder in the organisation's document library (core team).",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Folder created successfully", OrgDocumentsModel.CreateFolder.Response),
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
			APIResponseSpec.forbidden("Only the core team can manage organisation documents"),
		),
	}),

	zValidator("json", OrgDocumentsModel.CreateFolder.Body),

	async (c) => {
		if (!can(c, "org_documents:write")) {
			return APIResponse.forbidden(c, "Only the core team can manage organisation documents");
		}

		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as OrgDocumentsModel.CreateFolder.Body;

		const parent = await FileService.resolveParent(LOCATION, body.parent_id);
		if (!parent.ok) return APIResponse.badRequest(c, parent.message);

		const folder = await FileService.createFolder(
			LOCATION,
			parent.parentId,
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

		return APIResponse.created(c, "Folder created successfully", FileService.toResponse(folder));
	},
);
