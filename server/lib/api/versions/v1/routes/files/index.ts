import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../db";
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
import { router as sharesRouter } from "./shares";

type FilesEnv = {
	Variables: { file: DB.Models.File };
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
		const { download } = c.req.valid("query") as FilesModel.Content.Query;
		const response = await FileService.contentResponse(c.get("file"), { download: download === "1" });
		return response ?? APIResponse.notFound(c, "File not found");
	},
);

router.get(
	"/:fileId",

	APIRouteSpec.authenticated({
		summary: "Get file",
		description: "Retrieve a file's or folder's metadata, including the path of its contents.",
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

// Share links of a file or folder (behind the loader above: the item is loaded and read-checked).
router.route("/", sharesRouter);
