import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import type { EventRouterEnv } from "../../../../../utils/eventAccess";
import { FileAccess } from "../../../../../utils/fileAccess";
import { FileLibrary } from "../../../../../utils/fileLibrary";
import { FileService } from "../../../../../utils/fileService";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventFilesModel } from "./model";

/**
 * An event's documents. The whole team may view and upload unless an access list restricts a
 * folder or file (`FileAccess`); the Leitung (and the Kernteam) may do everything. Rename, move,
 * delete, access lists and share links go through the shared `/files/{fileId}` routes.
 */
export const router = new Hono<EventRouterEnv>().basePath("/:eventId/files");

async function viewerOf(c: Context<EventRouterEnv>) {
	return await FileAccess.viewer(
		AuthHandler.AuthContext.get(c),
		{ scope: "event", eventId: c.get("event").id },
		{ eventAccess: c.get("eventAccess") },
	);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event documents",
		description:
			"List a folder of the event's documents (the root without `parent_id`) with its breadcrumb path — only what the caller may see, each item with the caller's `permissions`. Each file carries its `content_url`; `shared` marks items with a share link. The Leitung also gets the access lists (`access`).",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Documents retrieved successfully", EventFilesModel.GetAll.Response),
			APIResponseSpec.notFound("Folder not found"),
			APIResponseSpec.forbidden("You are not allowed to view documents"),
		),
	}),

	zValidator("query", EventFilesModel.GetAll.Query),

	async (c) => {
		const { parent_id } = c.req.valid("query") as EventFilesModel.GetAll.Query;
		const viewer = await viewerOf(c);
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
			result.data satisfies EventFilesModel.GetAll.Response,
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Upload event document",
		description:
			"Upload a file (multipart/form-data, field `file`) into the event's documents, optionally into the folder `parent_id` — where the caller may upload.",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Document uploaded successfully", EventFilesModel.Upload.Response),
			APIResponseSpec.badRequest(
				"File is too large / Parent folder not found / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	zValidator("form", EventFilesModel.Upload.Form, undefined, { media: "multipart/form-data" }),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const form = c.req.valid("form") as EventFilesModel.Upload.Form;

		const target = await FileLibrary.resolveTarget(viewer, form.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		const file = await FileService.upload(viewer.location, target.parentId, form.file, userId);
		if (!file) return APIResponse.badRequest(c, "File is too large");

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "file",
			entityId: file.id,
			summary: `Dokument „${file.name}“ hochgeladen`,
		});

		return APIResponse.created(
			c,
			"Document uploaded successfully",
			await FileLibrary.created(viewer, file),
		);
	},
);

router.post(
	"/folders",

	APIRouteSpec.authenticated({
		summary: "Create event folder",
		description: "Create a folder in the event's documents — where the caller may upload.",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Folder created successfully", EventFilesModel.CreateFolder.Response),
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	zValidator("json", EventFilesModel.CreateFolder.Body),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventFilesModel.CreateFolder.Body;

		const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		const folder = await FileService.createFolder(
			viewer.location,
			target.parentId,
			FileService.sanitizeName(body.name),
			userId,
		);

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "file",
			entityId: folder.id,
			summary: `Ordner „${folder.name}“ angelegt`,
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
			"Create an empty Markdown document (`.md`, starting with its title as heading) in the event's documents — where the caller may upload.",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Document created successfully",
				EventFilesModel.CreateMarkdown.Response,
			),
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to add documents here"),
		),
	}),

	zValidator("json", EventFilesModel.CreateMarkdown.Body),

	async (c) => {
		const viewer = await viewerOf(c);
		if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventFilesModel.CreateMarkdown.Body;

		const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
		if (!target.ok) {
			return target.status === 400
				? APIResponse.badRequest(c, target.message)
				: APIResponse.forbidden(c, target.message);
		}

		const file = await FileService.createMarkdown(
			viewer.location,
			target.parentId,
			body.name,
			FileLibrary.markdownTemplate(body.name),
			userId,
		);
		if (!file) return APIResponse.badRequest(c, "File is too large");

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "file",
			entityId: file.id,
			summary: `Dokument „${file.name}“ angelegt`,
		});

		return APIResponse.created(
			c,
			"Document created successfully",
			await FileLibrary.created(viewer, file),
		);
	},
);
