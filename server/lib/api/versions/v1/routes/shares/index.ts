import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../db";
import { OrgContext } from "../../../../../orgs/context";
import { ConfigHandler } from "../../../../../utils/config";
import { AppConstants } from "../../../../../utils/constants";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { getClientIP } from "../../../../utils/clientInfo";
import { FileService } from "../../../../utils/fileService";
import { FileShares } from "../../../../utils/fileShares";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PublicSharesModel } from "./model";

type SharesEnv = {
	Variables: { share: DB.Models.FileShare; root: DB.Models.File };
};

/**
 * What a share link opens, for people without an account: `/shares/{token}`. The token (and, if
 * set, the password) is the only credential. Every file id in a request must be the shared item
 * or lie below the shared folder (`FileShares.resolveInShare`); unknown, expired and disabled
 * links all answer 404. The shared item itself is never renamed or deleted through its link.
 */
export const router = new Hono<SharesEnv>().basePath("/shares");

const TAG = DOCS_TAGS.PUBLIC_SHARES;
const NOT_FOUND = "Link not found or expired";
const UNLOCK_COOKIE = `${AppConstants.APP_KEYS_PREFIX}_share`;

// Password attempts per link and client: 10 per 15 minutes.
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_MAX_ATTEMPTS = 10;
const unlockAttempts = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of unlockAttempts) if (entry.resetAt <= now) unlockAttempts.delete(key);
}, UNLOCK_WINDOW_MS).unref();

function share(c: Context<SharesEnv>) {
	return c.get("share");
}

function isUnlocked(c: Context<SharesEnv>) {
	return FileShares.isUnlocked(share(c), getCookie(c, UNLOCK_COOKIE));
}

function contentUrl(token: string, file: DB.Models.File) {
	return `/api/v1/shares/${token}/files/${file.id}/content/${encodeURIComponent(file.name)}`;
}

function item(c: Context<SharesEnv>, file: DB.Models.File): PublicSharesModel.Item {
	return {
		id: file.id,
		kind: file.kind,
		name: file.name,
		mime_type: file.kind === "file" ? file.mime_type : null,
		size: file.size,
		updated_at: file.updated_at,
		content_url: file.kind === "file" && share(c).can_read ? contentUrl(share(c).token, file) : null,
	};
}

function info(c: Context<SharesEnv>, unlocked = isUnlocked(c)): PublicSharesModel.Info {
	const current = share(c);
	return {
		kind: c.get("root").kind,
		requires_password: current.password_hash !== null,
		unlocked,
		item: unlocked ? item(c, c.get("root")) : null,
		permissions: unlocked
			? {
					read: current.can_read,
					upload: current.can_upload,
					edit: current.can_edit,
					delete: current.can_delete,
				}
			: null,
		expires_at: unlocked ? current.expires_at : null,
	};
}

/** Audit entry for a change made through a link (no user: the link did it). */
async function audit(
	c: Context<SharesEnv>,
	action: "create" | "update" | "delete",
	file: DB.Models.File,
	what: string,
) {
	const label = share(c).label ? ` „${share(c).label}“` : "";
	await AuditLog.record({
		userId: null,
		eventId: file.scope === "event" ? file.event_id : null,
		action,
		entityType: "file",
		entityId: file.id,
		summary: `${what} (über Freigabelink${label})`,
		metadata: { share_id: share(c).id },
	});
}

/** The file `fileId` inside this share, or a ready 404. */
async function inShare(c: Context<SharesEnv>, fileId: number) {
	return await FileShares.resolveInShare(c.get("root"), fileId);
}

/** Folder in this share for `folderId` (default: the shared folder); null if not one. */
async function folderInShare(c: Context<SharesEnv>, folderId: number | undefined) {
	const root = c.get("root");
	if (root.kind !== "folder") return null;
	const folder = folderId === undefined ? root : await inShare(c, folderId);
	return folder && folder.kind === "folder" ? folder : null;
}

const resolveShare = async (c: Context<SharesEnv>, next: () => Promise<void>) => {
	const resolved = await FileShares.resolve(c.req.param("token") ?? "");
	if (!resolved) return APIResponse.notFound(c, NOT_FOUND);
	c.set("share", resolved.share);
	c.set("root", resolved.root);
	await next();
};
// `/:token/*` matches `/:token` itself too.
router.use("/:token/*", resolveShare);

/** Everything but the info and the password: only once unlocked. */
const requireUnlocked = async (c: Context<SharesEnv>, next: () => Promise<void>) => {
	if (!isUnlocked(c)) return APIResponse.unauthorized(c, "This link needs its password");
	await next();
};
router.use("/:token/items/*", requireUnlocked);
router.use("/:token/files/*", requireUnlocked);
router.use("/:token/folders/*", requireUnlocked);

router.get(
	"/:token",
	APIRouteSpec.unauthenticated({
		summary: "Open share link",
		description:
			"What the link shares and allows. For a password-protected link, only `requires_password` until it is unlocked in this browser.",
		tags: [TAG],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Share link retrieved successfully", PublicSharesModel.Info),
			APIResponseSpec.notFound(NOT_FOUND),
		),
	}),
	zValidator("param", PublicSharesModel.TokenParams),
	async (c) => {
		const result = info(c);
		if (result.unlocked) await FileShares.recordAccess(share(c));
		return APIResponse.success(c, "Share link retrieved successfully", result);
	},
);

router.post(
	"/:token/unlock",
	APIRouteSpec.unauthenticated({
		summary: "Unlock share link",
		description:
			"Check the link's password; on success a cookie unlocks the link in this browser for 12 hours. 10 attempts per 15 minutes.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Share link unlocked", PublicSharesModel.Info),
			APIResponseSpec.forbidden("Wrong password"),
			APIResponseSpec.notFound(NOT_FOUND),
			APIResponseSpec.tooManyRequests("Too many attempts"),
		),
	}),
	zValidator("param", PublicSharesModel.TokenParams),
	zValidator("json", PublicSharesModel.UnlockBody),
	async (c) => {
		const current = share(c);
		if (current.password_hash === null) {
			return APIResponse.success(c, "Share link unlocked", info(c));
		}

		const key = `${OrgContext.id()}:${current.id}:${getClientIP(c)}`;
		const now = Date.now();
		let attempts = unlockAttempts.get(key);
		if (!attempts || attempts.resetAt <= now) {
			attempts = { count: 0, resetAt: now + UNLOCK_WINDOW_MS };
			unlockAttempts.set(key, attempts);
		}
		if (attempts.count >= UNLOCK_MAX_ATTEMPTS) {
			return APIResponse.tooManyRequests(c, "Too many attempts, try again later");
		}

		const { password } = c.req.valid("json") as PublicSharesModel.UnlockBody;
		if (!(await Bun.password.verify(password, current.password_hash))) {
			attempts.count++;
			return APIResponse.forbidden(c, "Wrong password");
		}
		unlockAttempts.delete(key);

		const value = FileShares.unlockValue(current);
		setCookie(c, UNLOCK_COOKIE, value, {
			path: `/api/v1/shares/${current.token}`,
			httpOnly: true,
			sameSite: "Lax",
			secure: (ConfigHandler.getConfig()?.APP_URL ?? "").startsWith("https://"),
			maxAge: FileShares.UNLOCK_TTL_SECONDS,
		});
		await FileShares.recordAccess(current);

		// The cookie arrives with the next request; this answer already counts as unlocked.
		return APIResponse.success(c, "Share link unlocked", info(c, true));
	},
);

router.get(
	"/:token/items",
	APIRouteSpec.unauthenticated({
		summary: "List shared folder",
		description: "A folder inside the shared folder with its contents (needs view rights).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Folder retrieved successfully", PublicSharesModel.Listing),
			APIResponseSpec.forbidden("This link doesn't allow viewing"),
			APIResponseSpec.notFound("Folder not found"),
		),
	}),
	zValidator("param", PublicSharesModel.TokenParams),
	zValidator("query", PublicSharesModel.ListQuery),
	async (c) => {
		if (!share(c).can_read) return APIResponse.forbidden(c, "This link doesn't allow viewing");
		const { folder_id } = c.req.valid("query") as PublicSharesModel.ListQuery;
		const folder = await folderInShare(c, folder_id);
		if (!folder) return APIResponse.notFound(c, "Folder not found");

		const root = c.get("root");
		const items = await FileService.listFolder(
			{ scope: root.scope, eventId: root.event_id },
			folder.id,
		);
		const path = await FileShares.pathInShare(root, folder);

		return APIResponse.success(c, "Folder retrieved successfully", {
			folder: item(c, folder),
			path: path.map((entry) => item(c, entry)),
			items: items.map((entry) => item(c, entry)),
		} satisfies PublicSharesModel.Listing);
	},
);

router.get(
	"/:token/files/:fileId/content/:filename?",
	APIRouteSpec.unauthenticated({
		summary: "Get shared file contents",
		description:
			"The bytes of a file inside the share (needs view rights). Images, PDFs and plain text open inline unless `download=1`.",
		tags: [TAG],
		responses: {
			200: {
				description: "The file content",
				content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
			},
			...APIResponseSpec.notFound("File not found"),
		},
	}),
	zValidator("param", PublicSharesModel.ContentParams),
	zValidator("query", PublicSharesModel.ContentQuery),
	async (c) => {
		if (!share(c).can_read) return APIResponse.forbidden(c, "This link doesn't allow viewing");
		const { fileId } = c.req.valid("param") as PublicSharesModel.ContentParams;
		const { download } = c.req.valid("query") as PublicSharesModel.ContentQuery;

		const file = await inShare(c, fileId);
		const response = file
			? await FileService.contentResponse(file, { download: download === "1" })
			: null;
		if (!response) return APIResponse.notFound(c, "File not found");

		await FileShares.recordAccess(share(c));
		return response;
	},
);

router.post(
	"/:token/files",
	APIRouteSpec.unauthenticated({
		summary: "Upload into shared folder",
		description:
			"Upload a file (multipart/form-data, field `file`) into the shared folder or a folder inside it (needs upload rights).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("File uploaded successfully", PublicSharesModel.Item),
			APIResponseSpec.forbidden("This link doesn't allow uploads"),
			APIResponseSpec.notFound("Folder not found"),
		),
	}),
	zValidator("param", PublicSharesModel.TokenParams),
	zValidator("form", PublicSharesModel.UploadForm, undefined, { media: "multipart/form-data" }),
	async (c) => {
		if (!share(c).can_upload) return APIResponse.forbidden(c, "This link doesn't allow uploads");
		const form = c.req.valid("form") as PublicSharesModel.UploadForm;
		const parent = await folderInShare(c, form.parent_id);
		if (!parent) return APIResponse.notFound(c, "Folder not found");

		const uploaded = await FileService.upload(
			{ scope: parent.scope, eventId: parent.event_id },
			parent.id,
			form.file,
			null,
		);
		if (!uploaded) return APIResponse.badRequest(c, "File is too large");

		await audit(c, "create", uploaded, `Datei „${uploaded.name}“ hochgeladen`);
		return APIResponse.created(c, "File uploaded successfully", item(c, uploaded));
	},
);

router.post(
	"/:token/folders",
	APIRouteSpec.unauthenticated({
		summary: "Create folder in shared folder",
		description: "Create a folder inside the share (needs upload rights).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Folder created successfully", PublicSharesModel.Item),
			APIResponseSpec.forbidden("This link doesn't allow uploads"),
			APIResponseSpec.notFound("Folder not found"),
		),
	}),
	zValidator("param", PublicSharesModel.TokenParams),
	zValidator("json", PublicSharesModel.CreateFolderBody),
	async (c) => {
		if (!share(c).can_upload) return APIResponse.forbidden(c, "This link doesn't allow uploads");
		const body = c.req.valid("json") as PublicSharesModel.CreateFolderBody;
		const parent = await folderInShare(c, body.parent_id);
		if (!parent) return APIResponse.notFound(c, "Folder not found");

		const folder = await FileService.createFolder(
			{ scope: parent.scope, eventId: parent.event_id },
			parent.id,
			FileService.sanitizeName(body.name),
			null,
		);
		await audit(c, "create", folder, `Ordner „${folder.name}“ angelegt`);
		return APIResponse.created(c, "Folder created successfully", item(c, folder));
	},
);

router.put(
	"/:token/files/:fileId",
	APIRouteSpec.unauthenticated({
		summary: "Rename in shared folder",
		description: "Rename a file or folder inside the share (needs edit rights; not the shared item).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Renamed successfully", PublicSharesModel.Item),
			APIResponseSpec.forbidden("This link doesn't allow editing"),
			APIResponseSpec.notFound("File not found"),
		),
	}),
	zValidator("param", PublicSharesModel.FileParams),
	zValidator("json", PublicSharesModel.RenameBody),
	async (c) => {
		if (!share(c).can_edit) return APIResponse.forbidden(c, "This link doesn't allow editing");
		const { fileId } = c.req.valid("param") as PublicSharesModel.FileParams;
		const file = await inShare(c, fileId);
		if (!file || file.id === c.get("root").id) return APIResponse.notFound(c, "File not found");

		const { name } = c.req.valid("json") as PublicSharesModel.RenameBody;
		const updated = await FileService.update(file, { name });
		await audit(c, "update", updated, `„${file.name}“ in „${updated.name}“ umbenannt`);
		return APIResponse.success(c, "Renamed successfully", item(c, updated));
	},
);

router.put(
	"/:token/files/:fileId/content",
	APIRouteSpec.unauthenticated({
		summary: "Replace shared file contents",
		description:
			"Upload new contents for a file inside the share, or the shared file itself (multipart/form-data, field `file`; needs edit rights).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("File replaced successfully", PublicSharesModel.Item),
			APIResponseSpec.forbidden("This link doesn't allow editing"),
			APIResponseSpec.notFound("File not found"),
		),
	}),
	zValidator("param", PublicSharesModel.FileParams),
	zValidator("form", PublicSharesModel.ReplaceForm, undefined, { media: "multipart/form-data" }),
	async (c) => {
		if (!share(c).can_edit) return APIResponse.forbidden(c, "This link doesn't allow editing");
		const { fileId } = c.req.valid("param") as PublicSharesModel.FileParams;
		const file = await inShare(c, fileId);
		if (!file || file.kind !== "file") return APIResponse.notFound(c, "File not found");

		const { file: upload } = c.req.valid("form") as PublicSharesModel.ReplaceForm;
		const updated = await FileService.replaceContent(file, upload);
		if (!updated) return APIResponse.badRequest(c, "File is too large");

		await audit(c, "update", updated, `Inhalt von „${updated.name}“ ersetzt`);
		return APIResponse.success(c, "File replaced successfully", item(c, updated));
	},
);

router.delete(
	"/:token/files/:fileId",
	APIRouteSpec.unauthenticated({
		summary: "Delete in shared folder",
		description:
			"Delete a file or folder inside the shared folder (needs delete rights; never the shared item).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Deleted successfully"),
			APIResponseSpec.forbidden("This link doesn't allow deleting"),
			APIResponseSpec.notFound("File not found"),
		),
	}),
	zValidator("param", PublicSharesModel.FileParams),
	async (c) => {
		if (!share(c).can_delete) return APIResponse.forbidden(c, "This link doesn't allow deleting");
		const { fileId } = c.req.valid("param") as PublicSharesModel.FileParams;
		const file = await inShare(c, fileId);
		if (!file || file.id === c.get("root").id) return APIResponse.notFound(c, "File not found");

		await FileService.deleteRecursive(file);
		await audit(
			c,
			"delete",
			file,
			`${file.kind === "folder" ? "Ordner" : "Datei"} „${file.name}“ gelöscht`,
		);
		return APIResponse.successNoData(c, "Deleted successfully");
	},
);
