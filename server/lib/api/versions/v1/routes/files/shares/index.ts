import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../../db";
import { OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { FileAccess } from "../../../../../utils/fileAccess";
import { FileShares } from "../../../../../utils/fileShares";
import { getAuthUserId } from "../../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { FileSharesModel } from "./model";

type SharesEnv = {
	Variables: { file: DB.Models.File; share: DB.Models.FileShare };
};

/**
 * Share links of one file or folder (`file` is loaded and read-checked by the files router).
 * Managing them needs the right to manage the whole library (`FileAccess.canShare`).
 */
export const router = new Hono<SharesEnv>().basePath("/:fileId/shares");

const TAG = DOCS_TAGS.FILE_SHARES;

export function describeSharedItem(file: Pick<DB.Models.File, "kind" | "name">) {
	return `${file.kind === "folder" ? "Ordner" : "Datei"} „${file.name}“`;
}

function permissionSummary(permissions: FileShares.Permissions) {
	return [
		permissions.read ? "ansehen" : null,
		permissions.upload ? "hochladen" : null,
		permissions.edit ? "bearbeiten" : null,
		permissions.delete ? "löschen" : null,
	]
		.filter(Boolean)
		.join(", ");
}

router.use("*", async (c, next) => {
	if (!OrgContext.current().file_sharing_enabled) {
		return APIResponse.forbidden(c, "Share links are switched off for this organisation");
	}
	if (!(await FileAccess.canShare(AuthHandler.AuthContext.get(c), c.get("file")))) {
		return APIResponse.forbidden(c, "You are not allowed to share this item");
	}
	await next();
});

router.get(
	"/",
	APIRouteSpec.authenticated({
		summary: "List share links",
		description: "The share links of a file or folder, newest first.",
		tags: [TAG],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Share links retrieved successfully", FileShares.View.array()),
			APIResponseSpec.forbidden("You are not allowed to share this item"),
		),
	}),
	zValidator("param", FileSharesModel.Params),
	async (c) => {
		const shares = await FileShares.listForFile(c.get("file").id);
		return APIResponse.success(
			c,
			"Share links retrieved successfully",
			await FileShares.views(shares),
		);
	},
);

router.post(
	"/",
	APIRouteSpec.authenticated({
		summary: "Create share link",
		description:
			"Create a link for people without an account. Folders: any mix of view/upload/edit/delete (upload without view = drop box). Files: view, optionally edit (replace contents). Without `expires_at`, the org's default expiry applies.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Share link created successfully", FileShares.View),
			APIResponseSpec.forbidden("You are not allowed to share this item"),
		),
	}),
	zValidator("param", FileSharesModel.Params),
	zValidator("json", FileSharesModel.Create.Body),
	async (c) => {
		const file = c.get("file");
		const body = c.req.valid("json") as FileSharesModel.Create.Body;
		const share = await FileShares.create(file, body, getAuthUserId(c));
		const [view] = await FileShares.views([share]);

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: file.scope === "event" ? file.event_id : null,
			action: "create",
			entityType: "file_share",
			entityId: share.id,
			summary: `Freigabelink für ${describeSharedItem(file)} erstellt (${permissionSummary(view!.permissions)})`,
			metadata: { file_id: file.id, label: share.label, expires_at: share.expires_at },
		});

		return APIResponse.created(c, "Share link created successfully", view!);
	},
);

router.use("/:shareId", async (c, next) => {
	const parsed = FileSharesModel.ShareParams.safeParse(c.req.param());
	const share = parsed.success ? await FileShares.get(parsed.data.shareId) : null;
	if (!share || share.file_id !== c.get("file").id) {
		return APIResponse.notFound(c, "Share link not found");
	}
	c.set("share", share);
	await next();
});

router.put(
	"/:shareId",
	APIRouteSpec.authenticated({
		summary: "Update share link",
		description: "Change permissions, label, expiry or password (null removes it).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Share link updated successfully", FileShares.View),
			APIResponseSpec.notFound("Share link not found"),
		),
	}),
	zValidator("param", FileSharesModel.ShareParams),
	zValidator("json", FileSharesModel.Update.Body),
	async (c) => {
		const file = c.get("file");
		const body = c.req.valid("json") as FileSharesModel.Update.Body;
		const updated = await FileShares.update(c.get("share"), file, body);
		const [view] = await FileShares.views([updated]);

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: file.scope === "event" ? file.event_id : null,
			action: "update",
			entityType: "file_share",
			entityId: updated.id,
			summary: `Freigabelink für ${describeSharedItem(file)} geändert (${permissionSummary(view!.permissions)})`,
		});

		return APIResponse.success(c, "Share link updated successfully", view!);
	},
);

router.delete(
	"/:shareId",
	APIRouteSpec.authenticated({
		summary: "Delete share link",
		description: "The link stops working immediately.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Share link deleted successfully"),
			APIResponseSpec.notFound("Share link not found"),
		),
	}),
	zValidator("param", FileSharesModel.ShareParams),
	async (c) => {
		const file = c.get("file");
		const share = c.get("share");
		await FileShares.remove(share);

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: file.scope === "event" ? file.event_id : null,
			action: "delete",
			entityType: "file_share",
			entityId: share.id,
			summary: `Freigabelink für ${describeSharedItem(file)} gelöscht`,
		});

		return APIResponse.successNoData(c, "Share link deleted successfully");
	},
);
