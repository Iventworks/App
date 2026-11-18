import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../db";
import { Logger } from "../../../../../utils/logger";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { FileAccess } from "../../../../utils/fileAccess";
import { FileAccessLists } from "../../../../utils/fileAccessLists";
import { FileLibrary } from "../../../../utils/fileLibrary";
import { FileService } from "../../../../utils/fileService";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { FilesModel } from "./model";
import { router as sharesRouter } from "./shares";

type FilesEnv = {
	Variables: { file: DB.Models.File; permissions: FileAccess.Permissions };
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

		const permissions = await FileAccess.permissionsFor(AuthHandler.AuthContext.get(c), file);
		// Visible: readable, or a folder the caller may only upload into ("Nur hochladen").
		if (!permissions.read && !permissions.upload) {
			return APIResponse.forbidden(c, "You are not allowed to access this file");
		}

		c.set("file", file);
		c.set("permissions", permissions);
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
			"Retrieve a file's or folder's metadata, including the path of its contents and what the caller may do with it (`permissions`).",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("File retrieved successfully", FilesModel.Item),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden("You are not allowed to access this file"),
		),
	}),

	async (c) => {
		return APIResponse.success(
			c,
			"File retrieved successfully",
			FileService.toResponse(c.get("file"), { permissions: c.get("permissions") }),
		);
	},
);

router.put(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Rename or move file",
		description:
			"Rename a file or folder (`permissions.rename`) and/or move it to another folder of the same library (`parent_id: null` = root). Moving needs `permissions.delete` on the item and the right to upload into the target folder.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("File updated successfully", FilesModel.Update.Response),
			APIResponseSpec.badRequest(
				"Parent folder not found / A folder cannot be moved into itself / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden("You are not allowed to change this file"),
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
			if (body.parent_id !== null && body.parent_id !== undefined) {
				const parent = await FileService.resolveParent(location, body.parent_id);
				if (!parent.ok) return APIResponse.badRequest(c, parent.message);

				if (file.kind === "folder" && (await FileService.isDescendantOrSelf(file.id, body.parent_id))) {
					return APIResponse.badRequest(c, "A folder cannot be moved into itself");
				}
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
		description: "Delete a file, or a folder with everything inside it (`permissions.delete`).",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("File deleted successfully"),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden("You are not allowed to change this file"),
		),
	}),

	async (c) => {
		const file = c.get("file");
		if (!c.get("permissions").delete) {
			return APIResponse.forbidden(c, "You are not allowed to change this file");
		}

		try {
			await FileService.deleteRecursive(file);
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
			summary: `${describeItem(file)} gelöscht`,
		});

		return APIResponse.successNoData(c, "File deleted successfully");
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

		FileAccessLists.replace(file, body.custom, checked.entries);

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
