import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { OfficeDiscovery } from "../../../../../office/discovery";
import { OfficeTokens } from "../../../../../office/tokens";
import { inOrg, OrgContext } from "../../../../../orgs/context";
import { Logger } from "../../../../../utils/logger";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { Collab } from "../../../../utils/collab";
import { CollabSessions } from "../../../../utils/collabSessions";
import { CollabState } from "../../../../utils/collabState";
import { FileAccess } from "../../../../utils/fileAccess";
import { FileAccessLists } from "../../../../utils/fileAccessLists";
import { FileLibrary } from "../../../../utils/fileLibrary";
import { FileLocks } from "../../../../utils/fileLocks";
import { FileService } from "../../../../utils/fileService";
import { FileTrash } from "../../../../utils/fileTrash";
import { FileVersions } from "../../../../utils/fileVersions";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { Notifier } from "../../../../utils/notifications";
import { UserSummary } from "../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { FilesModel } from "./model";
import { router as sharesRouter } from "./shares";

type FilesEnv = {
	Variables: {
		file: DB.Models.File;
		permissions: FileAccess.Permissions;
		/** Documents: the folder chain from the root down to the file (empty otherwise). */
		path: DB.Models.File[];
	};
};

export const router = new Hono<FilesEnv>().basePath("/files");

function auditEventId(file: DB.Models.File) {
	return file.scope === "org" ? null : file.event_id;
}

const LOCATION_LABELS: Record<DB.Models.File["scope"], string> = {
	org: "Organisationsdokument",
	event: "Dokument",
	receipt: "Beleg",
	message: "Anhang",
};

const CUSTOM_ACCESS_BELOW =
	"Only managers can delete or move a folder that holds items with their own access";
const TOO_DEEP = FileService.TOO_DEEP;

function describeItem(file: DB.Models.File) {
	return `${file.kind === "folder" ? "Ordner" : LOCATION_LABELS[file.scope]} „${file.name}“`;
}

router.use(
	"/:fileId/*",
	requireOrgRole("volunteer"),
	zValidator("param", FilesModel.Params),
	async (c, next) => {
		const fileId = FilesModel.Params.shape.fileId.safeParse(c.req.param("fileId"));
		if (!fileId.success) return APIResponse.badRequest(c, "Invalid file id");

		const file = await FileService.get(fileId.data);
		if (!file) return APIResponse.notFound(c, "File not found");
		// Documents in the Papierkorb only exist there (`/…/trash`).
		const isDocument = file.scope === "org" || file.scope === "event";
		const path = isDocument ? await FileService.getPath(file.id) : [];
		if (isDocument && FileService.isTrashed(path)) {
			return APIResponse.notFound(c, "File not found");
		}

		const permissions = await FileAccess.permissionsFor(
			AuthHandler.AuthContext.get(c),
			file,
			isDocument ? path : undefined,
		);
		// Visible: readable, or a folder the caller may only upload into ("Nur hochladen").
		if (!permissions.read && !permissions.upload) {
			return APIResponse.forbidden(c, "You are not allowed to access this file");
		}

		c.set("file", file);
		c.set("permissions", permissions);
		c.set("path", path);
		await next();
	},
);

router.get(
	"/:fileId/content/:filename?",

	APIRouteSpec.authenticated({
		summary: "Get file contents",
		description:
			"The file's bytes, with an access check on every request. Besides the `Authorization` header, the browser's session cookie is accepted here, so the path works in `<img>`, links and new tabs (`content_url` of every file item). The trailing file name only names the tab and the download. Images, PDFs and plain text open inline unless `download=1`.",
		tags: [DOCS_TAGS.FILES],

		responses: {
			200: {
				description: "The file content",
				content: {
					"application/octet-stream": {
						schema: { type: "string", format: "binary" },
					},
				},
			},
			...APIResponseSpec.notFound("File not found"),
			...APIResponseSpec.forbidden("You are not allowed to access this file"),
		},
	}),

	zValidator("param", FilesModel.Content.Params),
	zValidator("query", FilesModel.Content.Query),

	async (c) => {
		if (!c.get("permissions").read) {
			return APIResponse.forbidden(c, "You are not allowed to access this file");
		}
		const { download } = c.req.valid("query") as FilesModel.Content.Query;
		const response = await FileService.contentResponse(c.get("file"), { download: download === "1" });
		return response ?? APIResponse.notFound(c, "File not found");
	},
);

router.get(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Get file",
		description:
			"Retrieve a file's or folder's metadata, including the path of its contents, what the caller may do with it (`permissions`) and where it lives (`path`, `event`).",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("File retrieved successfully", FilesModel.Details.Response),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden("You are not allowed to access this file"),
		),
	}),

	async (c) => {
		const file = c.get("file");
		// Whoever can see a document can open every folder above it (`FileAccess`).
		const path = c.get("path").slice(0, -1);
		const event =
			file.scope === "event" && file.event_id !== null
				? ((await DB.instance()
						.select({ id: DB.Tables.events.id, name: DB.Tables.events.name })
						.from(DB.Tables.events)
						.where(and(inOrg(DB.Tables.events), eq(DB.Tables.events.id, file.event_id)))
						.get()) ?? null)
				: null;

		const lock = await FileLocks.current(file.id);
		const editing = lock ? (FileLocks.describe([lock]).get(file.id) ?? null) : null;

		return APIResponse.success(c, "File retrieved successfully", {
			...FileService.toResponse(file, { permissions: c.get("permissions"), editing }),
			path: path.map((folder) => ({ id: folder.id, name: folder.name })),
			event,
		} satisfies FilesModel.Details.Response);
	},
);

router.put(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Rename or move file",
		description:
			"Rename a file or folder (`permissions.rename`) and/or move it to another folder of the same library (`parent_id: null` = root). Moving needs `permissions.delete` on the item and the right to upload into the target folder; a folder that holds items with their own access list is moved by managers only.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("File updated successfully", FilesModel.Update.Response),
			APIResponseSpec.badRequest(
				`Parent folder not found / A folder cannot be moved into itself / ${TOO_DEEP} / Syntax or validation error in request`,
			),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(`You are not allowed to change this file / ${CUSTOM_ACCESS_BELOW}`),
		),
	}),

	zValidator("json", FilesModel.Update.Body),

	async (c) => {
		const file = c.get("file");
		const permissions = c.get("permissions");
		const authContext = AuthHandler.AuthContext.get(c);
		const body = c.req.valid("json") as FilesModel.Update.Body;
		const forbidden = () => APIResponse.forbidden(c, "You are not allowed to change this file");

		const renames = body.name !== undefined && FileService.sanitizeName(body.name) !== file.name;
		const moves = body.parent_id !== undefined && body.parent_id !== file.parent_id;
		if (renames && !permissions.rename) return forbidden();
		if (moves && !permissions.delete) return forbidden();

		if (moves) {
			const location = FileService.locationOf(file);
			if (!permissions.manage && (await FileAccess.hasCustomAccessBelow(file))) {
				return APIResponse.forbidden(c, CUSTOM_ACCESS_BELOW);
			}
			if (body.parent_id !== null && body.parent_id !== undefined) {
				const parent = await FileService.resolveParent(location, body.parent_id);
				if (!parent.ok) return APIResponse.badRequest(c, parent.message);

				if (file.kind === "folder" && (await FileService.isDescendantOrSelf(file.id, body.parent_id))) {
					return APIResponse.badRequest(c, "A folder cannot be moved into itself");
				}
			}
			if (
				file.kind === "folder" &&
				!(await FileService.fitsDepth(
					body.parent_id ?? null,
					await FileService.folderLevelsBelow(file),
				))
			) {
				return APIResponse.badRequest(c, TOO_DEEP);
			}

			// Documents: the target must be a place the caller may add things to.
			if (file.scope === "org" || file.scope === "event") {
				const viewer = await FileAccess.viewer(authContext, location);
				if (!viewer) return forbidden();
				const target = await FileLibrary.resolveTarget(viewer, body.parent_id);
				if (!target.ok) {
					return target.status === 400 ? APIResponse.badRequest(c, target.message) : forbidden();
				}
			}
		}

		// Nothing changes: no write (read-only callers may send their item's current name).
		const updated =
			renames || moves
				? await FileService.update(file, {
						...(renames ? { name: body.name } : {}),
						...(moves ? { parent_id: body.parent_id } : {}),
					})
				: file;

		if (renames || moves) {
			await AuditLog.record({
				userId: getAuthUserId(c),
				eventId: auditEventId(file),
				action: "update",
				entityType: "file",
				entityId: file.id,
				summary: renames
					? `${LOCATION_LABELS[file.scope]} „${file.name}“ in „${updated.name}“ umbenannt`
					: `${LOCATION_LABELS[file.scope]} „${updated.name}“ verschoben`,
			});
		}

		return APIResponse.success(
			c,
			"File updated successfully",
			FileService.toResponse(updated, {
				permissions: await FileAccess.permissionsFor(authContext, updated),
			}),
		);
	},
);

router.delete(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Delete file",
		description:
			"Delete a file, or a folder with everything inside it (`permissions.delete`). Org and event documents go to the Papierkorb (restorable for 30 days, see `…/trash`); receipts and attachments are deleted right away. Refused while someone is editing the file (or a file inside the folder). A folder that holds items with their own access list is deleted by managers only.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("File deleted successfully"),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(`You are not allowed to change this file / ${CUSTOM_ACCESS_BELOW}`),
			APIResponseSpec.conflict(
				"The file is being edited right now / A document in this folder is being edited right now",
			),
		),
	}),

	async (c) => {
		const file = c.get("file");
		const permissions = c.get("permissions");
		if (!permissions.delete) {
			return APIResponse.forbidden(c, "You are not allowed to change this file");
		}
		if (!permissions.manage && (await FileAccess.hasCustomAccessBelow(file))) {
			return APIResponse.forbidden(c, CUSTOM_ACCESS_BELOW);
		}
		if (await FileLocks.blockingWithin(file)) {
			return APIResponse.conflict(
				c,
				file.kind === "folder"
					? "A document in this folder is being edited right now"
					: "The file is being edited right now",
			);
		}

		const toTrash = file.scope === "org" || file.scope === "event";
		try {
			if (toTrash) await FileTrash.trash(file, getAuthUserId(c));
			else await FileService.deleteRecursive(file);
		} catch (error: any) {
			Logger.error("Failed to delete file", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to delete file");
		}

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(file),
			action: "delete",
			entityType: "file",
			entityId: file.id,
			summary: toTrash
				? `${describeItem(file)} in den Papierkorb verschoben`
				: `${describeItem(file)} gelöscht`,
		});

		return APIResponse.successNoData(c, "File deleted successfully");
	},
);

// --- contents: new versions, shared Markdown editing ------------------------------------------

const EDIT_FORBIDDEN = "You are not allowed to edit this file";
const LOCKED = "The file is being edited right now";

router.put(
	"/:fileId/content",

	APIRouteSpec.authenticated({
		summary: "Upload new contents",
		description:
			"Replace a file's contents with an upload (multipart/form-data, field `file`) — „Neue Fassung“. Needs `permissions.edit`; the old contents become a version. Refused while someone else is editing the file.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("File replaced successfully", FilesModel.Item),
			APIResponseSpec.badRequest(
				"Only files have contents / File is too large / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(EDIT_FORBIDDEN),
			APIResponseSpec.conflict(LOCKED),
		),
	}),

	zValidator("form", FilesModel.Upload.Form, undefined, { media: "multipart/form-data" }),

	async (c) => {
		const file = c.get("file");
		const userId = getAuthUserId(c);
		if (!c.get("permissions").edit) return APIResponse.forbidden(c, EDIT_FORBIDDEN);
		if (file.kind !== "file") return APIResponse.badRequest(c, "Only files have contents");
		if (await FileLocks.blocking(file.id)) return APIResponse.conflict(c, LOCKED);

		const { file: upload } = c.req.valid("form") as FilesModel.Upload.Form;
		const updated = await FileService.replaceContent(file, upload, userId);
		if (!updated) return APIResponse.badRequest(c, "File is too large");

		await AuditLog.record({
			userId,
			eventId: auditEventId(file),
			action: "update",
			entityType: "file",
			entityId: file.id,
			summary: `Neue Fassung von ${describeItem(file)} hochgeladen`,
		});

		return APIResponse.success(
			c,
			"File replaced successfully",
			FileService.toResponse(updated, { permissions: c.get("permissions") }),
		);
	},
);

router.post(
	"/:fileId/collab",

	APIRouteSpec.authenticated({
		summary: "Shared editing: sync",
		description:
			'Everything a Markdown editor tab does in a shared editing session (`permissions.edit`): join (`after: null` → the whole Yjs state), send its Yjs updates and awareness, pull others\' updates, leave. The first tab of a fresh session is told to `initialize` the document from the file (`init: true` with its updates); the others wait until `ready`. While anyone is in the session the file is locked. The realtime channel announces changes (`{ type: "document" }`).',
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Document synced successfully (no data after `leave`)",
				FilesModel.Collab.SyncResponse,
			),
			APIResponseSpec.badRequest(
				"Only Markdown documents can be edited here / Invalid document update / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(EDIT_FORBIDDEN),
			APIResponseSpec.conflict("The file is being edited elsewhere / The document is not ready yet"),
		),
	}),

	zValidator("json", FilesModel.Collab.SyncBody),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").edit) return APIResponse.forbidden(c, EDIT_FORBIDDEN);
		if (file.kind !== "file" || !FileService.isMarkdownName(file.name)) {
			return APIResponse.badRequest(c, "Only Markdown documents can be edited here");
		}

		const body = c.req.valid("json") as FilesModel.Collab.SyncBody;
		const userId = getAuthUserId(c);
		const user = (await UserSummary.fetchMap([userId])).get(userId);
		if (!user) return APIResponse.forbidden(c, EDIT_FORBIDDEN);

		// Audited once per person joining (not per tab or reconnect).
		const joining =
			body.after === null &&
			!body.leave &&
			!CollabSessions.participants(OrgContext.id(), file.id).some((entry) => entry.userId === userId);
		const result = await Collab.sync(file, user, body);
		if (!result.ok) {
			return result.status === 409
				? APIResponse.conflict(c, result.message)
				: APIResponse.badRequest(c, result.message);
		}

		if (joining) {
			await AuditLog.record({
				userId,
				eventId: auditEventId(file),
				action: "update",
				entityType: "file",
				entityId: file.id,
				summary: `${describeItem(file)} im Editor geöffnet`,
			});
		}

		if (!result.data) return APIResponse.successNoData(c, "Left the document");
		return APIResponse.success(c, "Document synced successfully", result.data);
	},
);

router.put(
	"/:fileId/collab/content",

	APIRouteSpec.authenticated({
		summary: "Shared editing: save",
		description:
			"Write the Markdown a tab serialised at `seq` back into the file — only when it is newer than what was saved (`saved: false` otherwise). While the same person keeps saving, at most one version is kept every few minutes.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Document saved successfully", FilesModel.Collab.SaveResponse),
			APIResponseSpec.badRequest("Only Markdown documents can be edited here / File is too large"),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(EDIT_FORBIDDEN),
			APIResponseSpec.conflict("Unknown document state"),
		),
	}),

	zValidator("json", FilesModel.Collab.SaveBody),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").edit) return APIResponse.forbidden(c, EDIT_FORBIDDEN);
		if (file.kind !== "file" || !FileService.isMarkdownName(file.name)) {
			return APIResponse.badRequest(c, "Only Markdown documents can be edited here");
		}
		const body = c.req.valid("json") as FilesModel.Collab.SaveBody;
		const result = await Collab.save(file, getAuthUserId(c), body);
		if (!result.ok) {
			return result.status === 409
				? APIResponse.conflict(c, result.message)
				: APIResponse.badRequest(c, result.message);
		}
		return APIResponse.success(c, "Document saved successfully", result.data);
	},
);

// --- office (Euro-Office over WOPI) ----------------------------------------------------------

router.post(
	"/:fileId/office",

	APIRouteSpec.authenticated({
		summary: "Open in the office editor",
		description:
			"An access token and the editor URL of the office server (WOPI) for this document: the browser posts `access_token` and `access_token_ttl` to `url` in a frame. Editing when the caller may edit (`permissions.edit`) and the file type allows it, otherwise viewing. Only for browser logins, and only when office editing is configured (`office` in `GET /instance`).",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Editor ready", FilesModel.Office.Response),
			APIResponseSpec.badRequest("This file can't be opened in the office editor"),
			APIResponseSpec.notFound("File not found / Office editing is not available"),
			APIResponseSpec.forbidden("Only available in the browser"),
		),
	}),

	async (c) => {
		const file = c.get("file");
		const permissions = c.get("permissions");
		if (!OfficeDiscovery.enabled()) return APIResponse.notFound(c, "Office editing is not available");
		if (
			file.kind !== "file" ||
			(file.scope !== "org" && file.scope !== "event") ||
			!permissions.read
		) {
			return APIResponse.badRequest(c, "This file can't be opened in the office editor");
		}
		const authContext = AuthHandler.AuthContext.get(c);
		if (authContext.type !== "session")
			return APIResponse.forbidden(c, "Only available in the browser");

		const discovery = await OfficeDiscovery.get();
		if (!discovery) return APIResponse.serverError(c, "The office server can't be reached");

		// A Markdown editing session has the file: view only.
		const lock = await FileLocks.current(file.id);
		const extension = file.name.includes(".") ? (file.name.split(".").pop() ?? "") : "";
		const choice = OfficeDiscovery.actionFor(
			discovery,
			extension,
			permissions.edit && lock?.kind !== "editor",
		);
		if (!choice) return APIResponse.badRequest(c, "This file can't be opened in the office editor");

		const { token, expiresAt } = await OfficeTokens.create(file, authContext, choice.mode === "edit");
		const wopiSrc = `${OrgContext.current().url}/api/v1/wopi/files/${file.id}`;
		return APIResponse.success(c, "Editor ready", {
			url: OfficeDiscovery.editorUrl(choice.action, wopiSrc),
			access_token: token,
			access_token_ttl: expiresAt,
			mode: choice.mode,
		} satisfies FilesModel.Office.Response);
	},
);

// --- versions -------------------------------------------------------------------------------

router.get(
	"/:fileId/versions",

	APIRouteSpec.authenticated({
		summary: "List versions",
		description:
			"Earlier contents of a file, newest first: who wrote them and when, with the path of their contents. Kept for 30 days (the newest ten longer).",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Versions retrieved successfully", FilesModel.Versions.Response),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden("You are not allowed to access this file"),
		),
	}),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").read) {
			return APIResponse.forbidden(c, "You are not allowed to access this file");
		}
		const versions = await FileVersions.toResponses(file, await FileVersions.list(file.id));
		return APIResponse.success(
			c,
			"Versions retrieved successfully",
			versions satisfies FilesModel.Versions.Response,
		);
	},
);

router.get(
	"/:fileId/versions/:versionId/content/:filename?",

	APIRouteSpec.authenticated({
		summary: "Get version contents",
		description:
			"The bytes of an earlier version, like `GET /files/{fileId}/content` (the session cookie works here too; `download=1` forces a download).",
		tags: [DOCS_TAGS.FILES],

		responses: {
			200: {
				description: "The version's content",
				content: {
					"application/octet-stream": { schema: { type: "string", format: "binary" } },
				},
			},
			...APIResponseSpec.notFound("Version not found"),
			...APIResponseSpec.forbidden("You are not allowed to access this file"),
		},
	}),

	zValidator("param", FilesModel.Versions.ContentParams),
	zValidator("query", FilesModel.Content.Query),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").read) {
			return APIResponse.forbidden(c, "You are not allowed to access this file");
		}
		const { versionId } = c.req.valid("param") as FilesModel.Versions.ContentParams;
		const version = await FileVersions.get(file.id, versionId);
		if (!version) return APIResponse.notFound(c, "Version not found");

		const { download } = c.req.valid("query") as FilesModel.Content.Query;
		const response = await FileService.contentResponse(
			{ ...file, storage_key: version.storage_key, mime_type: version.mime_type, size: version.size },
			{ download: download === "1" },
		);
		return response ?? APIResponse.notFound(c, "Version not found");
	},
);

router.post(
	"/:fileId/versions/:versionId/restore",

	APIRouteSpec.authenticated({
		summary: "Restore version",
		description:
			"Make an earlier version the current contents again (`permissions.edit`); the current contents become a version, so this can be undone. Refused while someone else is editing the file.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Version restored successfully", FilesModel.Item),
			APIResponseSpec.notFound("Version not found"),
			APIResponseSpec.forbidden(EDIT_FORBIDDEN),
			APIResponseSpec.conflict(LOCKED),
		),
	}),

	zValidator("param", FilesModel.Versions.Params),

	async (c) => {
		const file = c.get("file");
		const userId = getAuthUserId(c);
		if (!c.get("permissions").edit) return APIResponse.forbidden(c, EDIT_FORBIDDEN);
		if (await FileLocks.blocking(file.id)) return APIResponse.conflict(c, LOCKED);

		const { versionId } = c.req.valid("param") as FilesModel.Versions.Params;
		const version = await FileVersions.get(file.id, versionId);
		if (!version) return APIResponse.notFound(c, "Version not found");

		const updated = FileVersions.restore(file, version, userId);
		if (!updated) return APIResponse.notFound(c, "Version not found");
		await CollabState.discard(file.id);

		await AuditLog.record({
			userId,
			eventId: auditEventId(file),
			action: "update",
			entityType: "file",
			entityId: file.id,
			summary: `Ältere Fassung von ${describeItem(file)} wiederhergestellt`,
			metadata: { version_modified_at: version.modified_at },
		});

		return APIResponse.success(
			c,
			"Version restored successfully",
			FileService.toResponse(updated, { permissions: c.get("permissions") }),
		);
	},
);

// --- access lists ---------------------------------------------------------------------------

const ACCESS_FORBIDDEN = "You are not allowed to manage access to this item";

router.get(
	"/:fileId/access",

	APIRouteSpec.authenticated({
		summary: "Get access list",
		description:
			"Who has access to a document or folder: its own access list, or the one it inherits (`inherited_from`, null = the library's default). Kernteam (org documents) and Leitung (event documents) only.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Access list retrieved successfully", FilesModel.Access.Response),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(ACCESS_FORBIDDEN),
		),
	}),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").manage) return APIResponse.forbidden(c, ACCESS_FORBIDDEN);

		const path = await FileService.getPath(file.id);
		const view = await FileAccessLists.describe(
			FileService.locationOf(file),
			path,
			await FileAccess.loadEntries(path),
		);
		return APIResponse.success(
			c,
			"Access list retrieved successfully",
			view satisfies FilesModel.Access.Response,
		);
	},
);

router.put(
	"/:fileId/access",

	APIRouteSpec.authenticated({
		summary: "Set access list",
		description:
			"Give a document or folder its own access list (`custom: true`; replaces the whole list) or let it inherit from its folder again (`custom: false`). Org documents: `members`, `org_group`, `user`; event documents: `team`, `event_group` and people on the event's team. Rights as for share links; files can only be viewed or edited. Kernteam / Leitung only — they always keep full access.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Access list updated successfully", FilesModel.Access.Response),
			APIResponseSpec.badRequest(
				"Group not found / User not found / Only people on the event's team can be added / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(ACCESS_FORBIDDEN),
		),
	}),

	zValidator("json", FilesModel.Access.Body),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").manage) return APIResponse.forbidden(c, ACCESS_FORBIDDEN);

		const body = c.req.valid("json") as FilesModel.Access.Body;
		const checked = await FileAccessLists.validate(file, body.custom ? body.entries : []);
		if (!checked.ok) return APIResponse.badRequest(c, checked.message);

		const before = new Set(
			[...(await FileAccess.loadEntries([file])).values()]
				.flat()
				.filter((entry) => entry.principal === "user")
				.map((entry) => entry.user_id),
		);
		FileAccessLists.replace(file, body.custom, checked.entries);

		// People added by name hear about it (not "everyone" or whole groups: that would be noise).
		const added = checked.entries
			.filter((entry) => entry.principal === "user" && !before.has(entry.user_id ?? null))
			.map((entry) => entry.user_id as number);
		if (added.length > 0) {
			const actorId = getAuthUserId(c);
			const actor = (await UserSummary.fetchMap([actorId])).get(actorId);
			const base = file.scope === "event" ? `/events/${file.event_id}/documents` : "/documents";
			await Notifier.notify(
				added,
				{
					type: "document_shared",
					title: `${actor?.display_name ?? "Jemand"} hat dir Zugriff auf „${file.name}“ gegeben`,
					body: file.kind === "folder" ? "Ordner mit allem darin" : undefined,
					link: file.kind === "folder" ? `${base}?folder=${file.id}` : `/files/${file.id}`,
				},
				{ excludeUserId: actorId },
			);
		}

		const updated = (await FileService.get(file.id)) as DB.Models.File;
		const path = await FileService.getPath(updated.id);
		const location = FileService.locationOf(updated);
		const view = await FileAccessLists.describe(location, path, await FileAccess.loadEntries(path));

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(file),
			action: "update",
			entityType: "file",
			entityId: file.id,
			summary: body.custom
				? `Zugriff auf ${describeItem(file)} festgelegt: ${FileAccessLists.summary(view.entries, file.scope === "org" ? "org" : "event")}`
				: `${describeItem(file)} übernimmt wieder den Zugriff des übergeordneten Ordners`,
		});

		return APIResponse.success(
			c,
			"Access list updated successfully",
			view satisfies FilesModel.Access.Response,
		);
	},
);

router.get(
	"/:fileId/access/candidates",

	APIRouteSpec.authenticated({
		summary: "List access candidates",
		description:
			"Who can be added to the access list of this document or folder: everyone in the org / on the team, groups and single people. Kernteam and Leitung are not listed — they always have full access.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Candidates retrieved successfully", FilesModel.Access.Candidates),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden(ACCESS_FORBIDDEN),
		),
	}),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").manage) return APIResponse.forbidden(c, ACCESS_FORBIDDEN);

		return APIResponse.success(
			c,
			"Candidates retrieved successfully",
			(await FileAccessLists.candidates(
				FileService.locationOf(file),
			)) satisfies FilesModel.Access.Candidates,
		);
	},
);

// Share links of a file or folder (behind the loader above: the item is loaded and checked).
router.route("/", sharesRouter);
