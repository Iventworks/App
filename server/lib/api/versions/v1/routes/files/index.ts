import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../db";
import { FileStorage } from "../../../../../utils/fileStorage";
import { Logger } from "../../../../../utils/logger";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { FileAccess } from "../../../../utils/fileAccess";
import { FileService } from "../../../../utils/fileService";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { FilesModel } from "./model";

type FilesEnv = {
	Variables: { file: DB.Models.File };
};

export const router = new Hono<FilesEnv>().basePath("/files");

/** Locks down inline responses: no script, no plugins, no requests to anywhere. */
const INLINE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

/** `Content-Disposition` with an ASCII fallback and the RFC 5987 UTF-8 file name. */
function contentDisposition(type: "inline" | "attachment", name: string) {
	const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function auditEventId(file: DB.Models.File) {
	return file.scope === "org" ? null : file.event_id;
}

const LOCATION_LABELS: Record<DB.Models.File["scope"], string> = {
	org: "Organisationsdokument",
	event: "Dokument",
	receipt: "Beleg",
};

router.get(
	"/download/:token",

	APIRouteSpec.unauthenticated({
		summary: "Download a file",
		description:
			"Stream a file using a signed, short-lived token from a file listing (`download_token`). No Authorization header needed, so the URL works in `<img>`, links and new tabs. Images, PDFs and plain text are served inline unless `download=1`.",
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
			...APIResponseSpec.notFound("File not found or link expired"),
		},
	}),

	zValidator("param", FilesModel.Download.Params),
	zValidator("query", FilesModel.Download.Query),

	async (c) => {
		const { token } = c.req.valid("param") as FilesModel.Download.Params;
		const { download } = c.req.valid("query") as FilesModel.Download.Query;

		const fileId = FileService.verifyDownloadToken(token);
		if (fileId === null) return APIResponse.notFound(c, "File not found or link expired");

		const file = await FileService.get(fileId);
		if (!file || file.kind !== "file" || !file.storage_key) {
			return APIResponse.notFound(c, "File not found or link expired");
		}

		const blob = FileStorage.open(file.storage_key);
		if (!(await blob.exists())) {
			Logger.error(`Stored blob for file ${file.id} is missing (${file.storage_key})`);
			return APIResponse.notFound(c, "File not found or link expired");
		}

		// Only allow-listed types are rendered by the browser; anything else (SVG, HTML, …) is
		// downloaded as opaque bytes so it can never run script on the app origin.
		const inline = download !== "1" && FileService.isInlineSafe(file.mime_type);
		const safeType = FileService.isInlineSafe(file.mime_type)
			? (file.mime_type as string)
			: "application/octet-stream";

		const headers: Record<string, string> = {
			"Content-Type": safeType,
			"Content-Length": String(blob.size),
			"Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, max-age=300",
		};
		// Chrome refuses to render PDFs in sandboxed documents; PDFs cannot run page script anyway.
		if (inline && safeType !== "application/pdf") {
			headers["Content-Security-Policy"] = INLINE_CSP;
		}

		return new Response(blob, { status: 200, headers });
	},
);

router.use(
	"/:fileId/*",
	requireOrgRole("volunteer"),
	zValidator("param", FilesModel.Params),
	async (c, next) => {
		const fileId = FilesModel.Params.shape.fileId.safeParse(c.req.param("fileId"));
		if (!fileId.success) return APIResponse.badRequest(c, "Invalid file id");

		const file = await FileService.get(fileId.data);
		if (!file) return APIResponse.notFound(c, "File not found");

		const authContext = AuthHandler.AuthContext.get(c);
		if (!(await FileAccess.canRead(authContext, file))) {
			return APIResponse.forbidden(c, "You are not allowed to access this file");
		}

		c.set("file", file);
		await next();
	},
);

router.get(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Get file",
		description: "Retrieve a file's or folder's metadata including a fresh download token.",
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
			FileService.toResponse(c.get("file")),
		);
	},
);

router.put(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Rename or move file",
		description:
			"Rename a file or folder and/or move it to another folder of the same library (`parent_id: null` = root).",
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
		const authContext = AuthHandler.AuthContext.get(c);
		if (!(await FileAccess.canWrite(authContext, file))) {
			return APIResponse.forbidden(c, "You are not allowed to change this file");
		}

		const body = c.req.valid("json") as FilesModel.Update.Body;

		if (body.parent_id !== undefined && body.parent_id !== null) {
			const parent = await FileService.resolveParent(
				{ scope: file.scope, eventId: file.event_id },
				body.parent_id,
			);
			if (!parent.ok) return APIResponse.badRequest(c, parent.message);

			if (file.kind === "folder" && (await FileService.isDescendantOrSelf(file.id, body.parent_id))) {
				return APIResponse.badRequest(c, "A folder cannot be moved into itself");
			}
		}

		const updated = await FileService.update(file, body);

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: auditEventId(file),
			action: "update",
			entityType: "file",
			entityId: file.id,
			summary:
				body.name !== undefined && updated.name !== file.name
					? `${LOCATION_LABELS[file.scope]} „${file.name}“ in „${updated.name}“ umbenannt`
					: `${LOCATION_LABELS[file.scope]} „${updated.name}“ verschoben`,
		});

		return APIResponse.success(c, "File updated successfully", FileService.toResponse(updated));
	},
);

router.delete(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Delete file",
		description: "Delete a file, or a folder with everything inside it.",
		tags: [DOCS_TAGS.FILES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("File deleted successfully"),
			APIResponseSpec.notFound("File not found"),
			APIResponseSpec.forbidden("You are not allowed to change this file"),
		),
	}),

	async (c) => {
		const file = c.get("file");
		const authContext = AuthHandler.AuthContext.get(c);
		if (!(await FileAccess.canWrite(authContext, file))) {
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
			summary: `${file.kind === "folder" ? "Ordner" : LOCATION_LABELS[file.scope]} „${file.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "File deleted successfully");
	},
);
