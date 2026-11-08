import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { FileService } from "../../../../../utils/fileService";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventFilesModel } from "./model";

export const router = new Hono<EventRouterEnv>().basePath("/:eventId/files");

function eventLocation(eventId: number): FileService.Location {
	return { scope: "event", eventId };
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event documents",
		description:
			"List a folder of the event's documents (the root without `parent_id`) with its breadcrumb path. Each file carries a short-lived `download_token` for `GET /files/download/{token}`.",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Documents retrieved successfully", EventFilesModel.GetAll.Response),
			APIResponseSpec.notFound("Folder not found"),
			APIResponseSpec.forbidden("You are not allowed to view documents"),
		),
	}),

	zValidator("query", EventFilesModel.GetAll.Query),

	async (c) => {
		if (!EventAccess.can(c, "files:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view documents");
		}

		const location = eventLocation(c.get("event").id);
		const { parent_id } = c.req.valid("query") as EventFilesModel.GetAll.Query;

		let folder: Awaited<ReturnType<typeof FileService.get>> = null;
		if (parent_id !== undefined) {
			folder = await FileService.get(parent_id);
			if (!folder || folder.kind !== "folder" || !FileService.isInLocation(folder, location)) {
				return APIResponse.notFound(c, "Folder not found");
			}
		}

		const path = folder ? await FileService.getPath(folder.id) : [];
		const items = await FileService.listFolder(location, folder?.id ?? null);

		return APIResponse.success(c, "Documents retrieved successfully", {
			folder: folder ? FileService.toResponse(folder) : null,
			path: path.map((entry) => FileService.toResponse(entry)),
			items: items.map((entry) => FileService.toResponse(entry)),
		} satisfies EventFilesModel.GetAll.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Upload event document",
		description:
			"Upload a file (multipart/form-data, field `file`) into the event's documents, optionally into the folder `parent_id`.",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Document uploaded successfully", EventFilesModel.Upload.Response),
			APIResponseSpec.badRequest(
				"File is too large / Parent folder not found / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to upload documents"),
		),
	}),

	zValidator("form", EventFilesModel.Upload.Form, undefined, { media: "multipart/form-data" }),

	async (c) => {
		if (!EventAccess.can(c, "files:upload")) {
			return APIResponse.forbidden(c, "You are not allowed to upload documents");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const form = c.req.valid("form") as EventFilesModel.Upload.Form;
		const location = eventLocation(event.id);

		const parent = await FileService.resolveParent(location, form.parent_id);
		if (!parent.ok) return APIResponse.badRequest(c, parent.message);

		const file = await FileService.upload(location, parent.parentId, form.file, userId);
		if (!file) return APIResponse.badRequest(c, "File is too large");

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "file",
			entityId: file.id,
			summary: `Dokument „${file.name}“ hochgeladen`,
		});

		return APIResponse.created(c, "Document uploaded successfully", FileService.toResponse(file));
	},
);

router.post(
	"/folders",

	APIRouteSpec.authenticated({
		summary: "Create event folder",
		description: "Create a folder in the event's documents.",
		tags: [DOCS_TAGS.EVENTS.DOCUMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Folder created successfully", EventFilesModel.CreateFolder.Response),
			APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to upload documents"),
		),
	}),

	zValidator("json", EventFilesModel.CreateFolder.Body),

	async (c) => {
		if (!EventAccess.can(c, "files:upload")) {
			return APIResponse.forbidden(c, "You are not allowed to upload documents");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventFilesModel.CreateFolder.Body;
		const location = eventLocation(event.id);

		const parent = await FileService.resolveParent(location, body.parent_id);
		if (!parent.ok) return APIResponse.badRequest(c, parent.message);

		const folder = await FileService.createFolder(
			location,
			parent.parentId,
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

		return APIResponse.created(c, "Folder created successfully", FileService.toResponse(folder));
	},
);
