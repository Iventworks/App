import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { z } from "zod";
import { OfficeDiscovery } from "../../office/discovery";
import { APIResponse } from "./api-res";
import { AuditLog } from "./auditLog";
import type { FileAccess } from "./fileAccess";
import { FileLibrary } from "./fileLibrary";
import { FileService } from "./fileService";
import { FileTrash } from "./fileTrash";
import { FileLibraryModel } from "./shared-models/fileLibrary";
import { APIResponseSpec, APIRouteSpec } from "./specHelpers";

/** Any mount point's context (the event router's carries the event). */
type AnyContext = Context<any, any>;

/** A failed library operation as its HTTP response. */
function failure(c: Context, result: { status: 400 | 403 | 404 | 409; message: string }) {
	switch (result.status) {
		case 400:
			return APIResponse.badRequest(c, result.message);
		case 404:
			return APIResponse.notFound(c, result.message);
		case 409:
			return APIResponse.conflict(c, result.message);
		default:
			return APIResponse.forbidden(c, result.message);
	}
}

/**
 * The routes of a document library: list a folder, upload, new folders and office documents, the
 * Papierkorb. Mounted twice: the org library (`/org/documents`) and every event's documents
 * (`/events/{eventId}/files`). Rename, move, delete, access lists and share links go through the
 * shared `/files/{fileId}` routes.
 */
export function createFileLibraryRouter(options: {
	basePath: string;
	tag: string;
	/** For the spec: the library in summaries ("organisation") and in descriptions. */
	name: string;
	library: string;
	/** For the spec: who manages it ("The Kernteam"). */
	managers: string;
	/** `?view=member` lists it like a member (the Kernteam's member view of the org library). */
	memberView?: boolean;
	viewerOf: (c: AnyContext, options: { asMember: boolean }) => Promise<FileAccess.Viewer | null>;
	/** Who acts, and in which event (for the audit log). */
	actor: (c: AnyContext) => { userId: number; eventId: number | null };
	/** German, for the audit log: where things are added (`into`) and created (`at`). */
	auditPlace?: { into: string; at: string };
	/** The mount point's path parameters (`{ eventId }`), for the spec. */
	parentParams?: z.ZodObject<z.ZodRawShape>;
	/** The mount point's 404 ("Event not found"), for the spec. */
	parentNotFound?: string;
}) {
	const router = new Hono().basePath(options.basePath);
	const { tag, name, library, managers, viewerOf, actor, parentNotFound } = options;
	const into = options.auditPlace?.into ?? "";
	const at = options.auditPlace?.at ?? "";

	const listQuery = options.memberView
		? FileLibraryModel.GetAll.Query
		: FileLibraryModel.GetAll.Query.omit({ view: true });
	const trashParams = options.parentParams
		? FileLibraryModel.TrashItem.Params.extend(options.parentParams.shape)
		: FileLibraryModel.TrashItem.Params;

	/** 404s of the route, with the mount point's. */
	const notFound = (...messages: string[]) => {
		const all = parentNotFound ? [...messages, parentNotFound] : messages;
		return all.length ? APIResponseSpec.notFound(all.join(" / ")) : {};
	};
	const record = (c: AnyContext, entry: Omit<AuditLog.Entry, "userId" | "eventId">) =>
		AuditLog.record({ ...actor(c), ...entry });

	router.get(
		"/",

		APIRouteSpec.authenticated({
			summary: `List ${name} documents`,
			description: `List a folder of ${library} (the root without \`parent_id\`) with its breadcrumb path — only what the caller may see, each item with the caller's \`permissions\`. Each file carries its \`content_url\`; \`shared\` marks items with a share link. ${managers} sees everything plus the access lists (\`access\`)${options.memberView ? "; with `view=member` it sees the library like a member" : ""}.`,
			tags: [tag],

			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.success("Documents retrieved successfully", FileLibraryModel.GetAll.Response),
				APIResponseSpec.forbidden("You are not allowed to view documents"),
				notFound("Folder not found"),
			),
		}),

		zValidator("query", listQuery),

		async (c) => {
			const { parent_id, view } = c.req.valid("query") as FileLibraryModel.GetAll.Query;
			const viewer = await viewerOf(c, { asMember: view === "member" });
			if (!viewer) return APIResponse.forbidden(c, "You are not allowed to view documents");

			const result = await FileLibrary.list(viewer, parent_id);
			if (!result.ok) return failure(c, result);
			return APIResponse.success(
				c,
				"Documents retrieved successfully",
				result.data satisfies FileLibraryModel.GetAll.Response,
			);
		},
	);

	router.post(
		"/",

		APIRouteSpec.authenticated({
			summary: `Upload ${name} document`,
			description: `Upload a file (multipart/form-data, field \`file\`) into ${library}, optionally into the folder \`parent_id\` — where the caller may upload.`,
			tags: [tag],

			responses: APIResponseSpec.describeBasic(
				APIResponseSpec.created("Document uploaded successfully", FileLibraryModel.Upload.Response),
				APIResponseSpec.badRequest(
					"File is too large / Parent folder not found / Syntax or validation error in request",
				),
				APIResponseSpec.forbidden("You are not allowed to add documents here"),
				notFound(),
			),
		}),

		// Multipart only: otherwise the generated client may pick the URL-encoded serializer.
		zValidator("form", FileLibraryModel.Upload.Form, undefined, { media: "multipart/form-data" }),

		async (c) => {
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

			const form = c.req.valid("form") as FileLibraryModel.Upload.Form;
			const target = await FileLibrary.resolveTarget(viewer, form.parent_id);
			if (!target.ok) return failure(c, target);

			const file = await FileService.upload(
				viewer.location,
				target.parentId,
				form.file,
				actor(c).userId,
			);
			if (!file) return APIResponse.badRequest(c, "File is too large");

			await record(c, {
				action: "create",
				entityType: "file",
				entityId: file.id,
				summary: `Dokument „${file.name}“${into} hochgeladen`,
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
			summary: `Create ${name} folder`,
			description: `Create a folder in ${library} — where the caller may upload.`,
			tags: [tag],

			responses: APIResponseSpec.describeBasic(
				APIResponseSpec.created("Folder created successfully", FileLibraryModel.CreateFolder.Response),
				APIResponseSpec.badRequest(
					`Parent folder not found / ${FileService.TOO_DEEP} / Syntax or validation error in request`,
				),
				APIResponseSpec.forbidden("You are not allowed to add documents here"),
				notFound(),
			),
		}),

		zValidator("json", FileLibraryModel.CreateFolder.Body),

		async (c) => {
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

			const body = c.req.valid("json") as FileLibraryModel.CreateFolder.Body;
			const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
			if (!target.ok) return failure(c, target);
			if (!(await FileService.fitsDepth(target.parentId))) {
				return APIResponse.badRequest(c, FileService.TOO_DEEP);
			}

			const folder = await FileService.createFolder(
				viewer.location,
				target.parentId,
				FileService.sanitizeName(body.name),
				actor(c).userId,
			);

			await record(c, {
				action: "create",
				entityType: "file",
				entityId: folder.id,
				summary: `Ordner „${folder.name}“${at} angelegt`,
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
			tags: [tag],

			responses: APIResponseSpec.describeBasic(
				APIResponseSpec.success(
					"Papierkorb retrieved successfully",
					FileLibraryModel.GetTrash.Response,
				),
				APIResponseSpec.forbidden("You are not allowed to view documents"),
				notFound(),
			),
		}),

		async (c) => {
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer?.inLibrary) return APIResponse.forbidden(c, "You are not allowed to view documents");
			return APIResponse.success(
				c,
				"Papierkorb retrieved successfully",
				(await FileTrash.list(viewer)) satisfies FileLibraryModel.GetTrash.Response,
			);
		},
	);

	router.post(
		"/trash/:fileId/restore",

		APIRouteSpec.authenticated({
			summary: "Restore from Papierkorb",
			description:
				"Put a deleted document or folder back into its folder. When that folder is in the Papierkorb too, managers restore it to the top level with an access list of its own that lets only them in; others restore the folder first. Managers restore everything, others what they deleted.",
			tags: [tag],

			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.success("Restored successfully", FileLibraryModel.RestoreFromTrash.Response),
				notFound("Not in the Papierkorb"),
				APIResponseSpec.conflict(
					"The folder it was in is in the Papierkorb too: restore the folder first",
				),
			),
		}),

		zValidator("param", trashParams),

		async (c) => {
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer) return APIResponse.notFound(c, "Not in the Papierkorb");
			const { fileId } = c.req.valid("param") as FileLibraryModel.RestoreFromTrash.Params;
			const result = await FileTrash.restore(viewer, fileId);
			if (!result.ok) return failure(c, result);

			await record(c, {
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
			tags: [tag],

			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.successNoData("Deleted successfully"),
				notFound("Not in the Papierkorb"),
				APIResponseSpec.forbidden("Only managers can delete for good"),
			),
		}),

		zValidator("param", trashParams),

		async (c) => {
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer) return APIResponse.notFound(c, "Not in the Papierkorb");
			const { fileId } = c.req.valid("param") as FileLibraryModel.DeleteFromTrash.Params;
			const result = await FileTrash.purge(viewer, fileId);
			if (!result.ok) return failure(c, result);

			await record(c, {
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
			tags: [tag],

			responses: APIResponseSpec.describeBasic(
				APIResponseSpec.successNoData("Papierkorb emptied successfully"),
				APIResponseSpec.forbidden("Only managers can delete for good"),
				notFound(),
			),
		}),

		async (c) => {
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer) return APIResponse.forbidden(c, "Only managers can delete for good");
			const result = await FileTrash.empty(viewer);
			if (!result.ok) return failure(c, result);

			if (result.count > 0) {
				await record(c, {
					action: "delete",
					entityType: "file",
					summary: `Papierkorb geleert (${result.count} Einträge endgültig gelöscht)`,
				});
			}

			return APIResponse.successNoData(c, "Papierkorb emptied successfully");
		},
	);

	router.post(
		"/office",

		APIRouteSpec.authenticated({
			summary: "Create office document",
			description:
				"Create a Word, Excel or PowerPoint document — where the caller may upload, and only when office editing is configured (`office` in `GET /instance`). It starts as an empty file; opening it in the office editor (`POST /files/{fileId}/office`) fills it with the office server's German template.",
			tags: [tag],

			responses: APIResponseSpec.describeBasic(
				APIResponseSpec.created(
					"Document created successfully",
					FileLibraryModel.CreateOffice.Response,
				),
				APIResponseSpec.badRequest("Parent folder not found / Syntax or validation error in request"),
				APIResponseSpec.forbidden("You are not allowed to add documents here"),
				notFound("Office editing is not available"),
			),
		}),

		zValidator("json", FileLibraryModel.CreateOffice.Body),

		async (c) => {
			if (!OfficeDiscovery.enabled())
				return APIResponse.notFound(c, "Office editing is not available");
			const viewer = await viewerOf(c, { asMember: false });
			if (!viewer) return APIResponse.forbidden(c, "You are not allowed to add documents here");

			const body = c.req.valid("json") as FileLibraryModel.CreateOffice.Body;
			const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
			if (!target.ok) return failure(c, target);

			const file = await FileService.createOffice(
				viewer.location,
				target.parentId,
				body.name,
				body.type,
				actor(c).userId,
			);

			await record(c, {
				action: "create",
				entityType: "file",
				entityId: file.id,
				summary: `${FileService.OFFICE_LABELS[body.type]} „${file.name}“${at} angelegt`,
			});

			return APIResponse.created(
				c,
				"Document created successfully",
				await FileLibrary.created(viewer, file),
			);
		},
	);

	return router;
}
