import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { FileAccess } from "../../../../../utils/fileAccess";
import { FileLibrary } from "../../../../../utils/fileLibrary";
import { FileService } from "../../../../../utils/fileService";
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
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
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

router.post(
	"/markdown",

	APIRouteSpec.authenticated({
		summary: "Create Markdown document",
		description:
			"Create an empty Markdown document (`.md`, starting with its title as heading) in the organisation's document library — where the caller may upload.",
		tags: [DOCS_TAGS.ORG.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Document created successfully",
				OrgDocumentsModel.CreateMarkdown.Response,
			),
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	zValidator("json", OrgDocumentsModel.CreateMarkdown.Body),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as OrgDocumentsModel.CreateMarkdown.Body;

		const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		const file = await FileService.createMarkdown(
			LOCATION,
			target.parentId,
			body.name,
			FileLibrary.markdownTemplate(body.name),
			userId,
		);
		if (!file) return APIResponse.badRequest(c, "File is too large");

		await AuditLog.record({
			userId,
			action: "create",
			entityType: "file",
			entityId: file.id,
			summary: `Dokument „${file.name}“ in der Organisationsablage angelegt`,
		});

		return APIResponse.created(
			c,
			"Document created successfully",
			await FileLibrary.created(viewer, file),
		);
	},
);
