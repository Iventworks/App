import type { Context } from "hono";
import { Hono } from "hono";
import type { DB } from "../../../../../db";
import { OfficeDiscovery } from "../../../../../office/discovery";
import { WopiProof } from "../../../../../office/proof";
import { OfficeTokens } from "../../../../../office/tokens";
import { OrgContext } from "../../../../../orgs/context";
import { FileStorage } from "../../../../../utils/fileStorage";
import { Logger } from "../../../../../utils/logger";
import { AuditLog } from "../../../../utils/auditLog";
import { FileLocks } from "../../../../utils/fileLocks";
import { FileService } from "../../../../utils/fileService";

type WopiEnv = {
	Variables: { wopi: OfficeTokens.Resolved; fileId: number };
};

/**
 * The WOPI host for the office server (Euro-Office; MS-WOPI): CheckFileInfo, GetFile, PutFile and
 * the lock operations. The office server calls these on the org's public address
 * (`<org url>/api/v1/wopi/files/{id}?access_token=…`), so the org comes from the host as for
 * every request. Every call needs a valid access token (`OfficeTokens`, checked again each time)
 * and — when the discovery has proof keys — a valid proof (`WopiProof`).
 *
 * WOPI defines its own responses (raw JSON, bytes, status codes, `X-WOPI-*` headers), so these
 * routes don't use the API envelope and aren't in the OpenAPI spec.
 */
export const router = new Hono<WopiEnv>().basePath("/wopi");

const LOCK_HEADER = "X-WOPI-Lock";

/** The URL as the office server called it (what it signed). */
function calledUrl(c: Context) {
	const url = new URL(c.req.url);
	const start = url.pathname.indexOf("/v1/wopi/");
	return `${OrgContext.current().url}/api${url.pathname.slice(start)}${url.search}`;
}

router.use("/files/:fileId/*", async (c, next) => {
	if (!OfficeDiscovery.enabled()) return c.body(null, 404);
	const fileId = Number(c.req.param("fileId"));
	if (!Number.isInteger(fileId) || fileId <= 0) return c.body(null, 404);

	const accessToken = c.req.query("access_token") ?? "";
	const discovery = await OfficeDiscovery.get();
	if (discovery?.proofKey) {
		const genuine = WopiProof.check({
			accessToken,
			url: calledUrl(c),
			timestamp: c.req.header("X-WOPI-TimeStamp"),
			proof: c.req.header("X-WOPI-Proof"),
			proofOld: c.req.header("X-WOPI-ProofOld"),
			current: discovery.proofKey,
			old: discovery.oldProofKey,
		});
		// MS-WOPI: an invalid proof is answered with 500.
		if (!genuine) return c.body(null, 500);
	}

	const resolved = await OfficeTokens.resolve(accessToken, fileId);
	if (!resolved) return c.body(null, 401);
	c.set("wopi", resolved);
	c.set("fileId", fileId);
	await next();
});

function fileInfo(file: DB.Models.File, user: DB.Models.User, canWrite: boolean) {
	const org = OrgContext.current();
	return {
		BaseFileName: file.name,
		OwnerId: String(file.uploaded_by ?? 0),
		Size: file.size,
		UserId: String(user.id),
		UserFriendlyName: user.display_name,
		Version: String(file.updated_at),
		LastModifiedTime: new Date(file.updated_at).toISOString(),
		UserCanWrite: canWrite,
		ReadOnly: !canWrite,
		UserCanNotWriteRelative: true,
		UserCanRename: false,
		SupportsLocks: true,
		SupportsGetLock: true,
		SupportsExtendedLockLength: true,
		SupportsUpdate: true,
		SupportsRename: false,
		BreadcrumbBrandName: org.display_name,
		PostMessageOrigin: org.url,
		HostEditUrl: `${org.url}/files/${file.id}`,
	};
}

// CheckFileInfo
router.get("/files/:fileId", async (c) => {
	const { file, user, canWrite } = c.get("wopi");
	return c.json(fileInfo(file, user, canWrite));
});

// GetFile
router.get("/files/:fileId/contents", async (c) => {
	const { file } = c.get("wopi");
	if (!file.storage_key) return c.body(null, 404);
	const blob = FileStorage.open(file.storage_key);
	if (!(await blob.exists())) return c.body(null, 404);
	return new Response(blob, {
		status: 200,
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Length": String(blob.size),
			"X-WOPI-ItemVersion": String(file.updated_at),
			"Cache-Control": "private, no-store",
		},
	});
});

// PutFile
router.post("/files/:fileId/contents", async (c) => {
	const { file, user, canWrite } = c.get("wopi");
	if (c.req.header("X-WOPI-Override") !== "PUT") return c.body(null, 501);
	if (!canWrite) return c.body(null, 401);

	const lockId = c.req.header(LOCK_HEADER) ?? "";
	const current = await FileLocks.officeLockOf(file.id);
	// A Markdown editing session has the file, or someone else's lock.
	if (current === null) return c.body(null, 409, { [LOCK_HEADER]: "" });
	if (current !== "" && current !== lockId) return c.body(null, 409, { [LOCK_HEADER]: current });
	// Unlocked: only an empty file may be written without a lock.
	if (current === "" && file.size > 0) return c.body(null, 409, { [LOCK_HEADER]: "" });

	const data = await c.req.arrayBuffer();
	if (data.byteLength > FileStorage.maxUploadBytes) return c.body(null, 413);
	const updated = await FileService.replaceContent(
		file,
		new Blob([data], { type: file.mime_type ?? "application/octet-stream" }),
		user.id,
		{ session: true },
	);
	if (!updated) return c.body(null, 413);
	return c.body(null, 200, { "X-WOPI-ItemVersion": String(updated.updated_at) });
});

// Lock operations (and what we don't support).
router.post("/files/:fileId", async (c) => {
	const { file, user, canWrite } = c.get("wopi");
	const override = c.req.header("X-WOPI-Override") ?? "";
	const lockId = (c.req.header(LOCK_HEADER) ?? "").slice(0, 1024);
	const conflict = (current: string) => c.body(null, 409, { [LOCK_HEADER]: current });

	switch (override) {
		case "GET_LOCK": {
			const current = await FileLocks.officeLockOf(file.id);
			return c.body(null, 200, { [LOCK_HEADER]: current ?? "" });
		}
		case "LOCK": {
			if (!canWrite) return c.body(null, 401);
			if (!lockId) return c.body(null, 400);
			const oldLockId = c.req.header("X-WOPI-OldLock");
			const result = FileLocks.officeLock(file.id, lockId, { oldLockId: oldLockId ?? undefined });
			if (!result.ok) return conflict(result.current);
			if (oldLockId === undefined) {
				await AuditLog.record({
					userId: user.id,
					eventId: file.scope === "event" ? file.event_id : null,
					action: "update",
					entityType: "file",
					entityId: file.id,
					summary: `Dokument „${file.name}“ in Office bearbeitet`,
				}).catch((error) => Logger.error("WOPI audit failed:", error));
			}
			return c.body(null, 200, { "X-WOPI-ItemVersion": String(file.updated_at) });
		}
		case "REFRESH_LOCK": {
			const result = await FileLocks.officeRefresh(file.id, lockId);
			return result.ok ? c.body(null, 200) : conflict(result.current);
		}
		case "UNLOCK": {
			const result = await FileLocks.officeUnlock(file.id, lockId);
			return result.ok
				? c.body(null, 200, { "X-WOPI-ItemVersion": String(file.updated_at) })
				: conflict(result.current);
		}
		default:
			// PUT_RELATIVE, RENAME_FILE, DELETE, … are not offered (CheckFileInfo says so).
			return c.body(null, 501);
	}
});
