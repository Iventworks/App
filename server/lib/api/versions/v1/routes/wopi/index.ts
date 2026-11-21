import type { Context } from "hono";
import { Hono } from "hono";
import { OfficeDiscovery } from "../../../../../office/discovery";
import { WopiProof } from "../../../../../office/proof";
import { OfficeTokens } from "../../../../../office/tokens";
import { WopiIds } from "../../../../../office/wopiIds";
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
 * The WOPI host for the office server (Nextcloud Office; MS-WOPI): CheckFileInfo, GetFile, PutFile and
 * the lock operations. The office server calls these on the org's public address
 * (`<org url>/api/v1/wopi/files/{id}?access_token=…`), so the org comes from the host as for
 * every request. Every call needs a valid proof (`WopiProof`, the office server's signature; no
 * proof keys in the discovery → every call is refused) and a valid access token (`OfficeTokens`,
 * checked again each time). A proof that doesn't match reloads the discovery once a minute at
 * most, so new keys after an office update are picked up. Files are addressed by their WOPI id
 * (`WopiIds`: file id plus a suffix tied to this installation). The login middleware leaves these
 * routes alone: office servers may send the access token as `Authorization: Bearer …`.
 *
 * WOPI defines its own responses (raw JSON, bytes, status codes, `X-WOPI-*` headers), so these
 * routes don't use the API envelope and aren't in the OpenAPI spec.
 */
export const router = new Hono<WopiEnv>().basePath("/wopi");

const LOCK_HEADER = "X-WOPI-Lock";

/** Why WOPI calls fail shows up in the log — once a minute per reason, not per call. */
const lastLogged = new Map<string, number>();
function logRefusal(reason: string, message: string) {
	const now = Date.now();
	if (now - (lastLogged.get(reason) ?? 0) < 60_000) return;
	lastLogged.set(reason, now);
	Logger.warn(message);
}

/** The URL as the office server called it (what it signed). */
function calledUrl(c: Context) {
	const url = new URL(c.req.url);
	const start = url.pathname.indexOf("/v1/wopi/");
	return `${OrgContext.current().url}/api${url.pathname.slice(start)}${url.search}`;
}

router.use("/files/:fileId/*", async (c, next) => {
	if (!OfficeDiscovery.enabled()) return c.body(null, 404);
	const wopiId = c.req.param("fileId") ?? "";
	const fileId = WopiIds.parse(wopiId);
	if (!fileId) return c.body(null, 404);

	const accessToken = c.req.query("access_token") ?? "";
	// Every call must be signed by the office server. Without its keys (no discovery, or one
	// without a proof key) nothing gets through: a token alone isn't enough.
	const check = (discovery: OfficeDiscovery.Discovery | null) =>
		Boolean(
			discovery?.proofKey &&
				WopiProof.check({
					accessToken,
					url: calledUrl(c),
					timestamp: c.req.header("X-WOPI-TimeStamp"),
					proof: c.req.header("X-WOPI-Proof"),
					proofOld: c.req.header("X-WOPI-ProofOld"),
					current: discovery.proofKey,
					old: discovery.oldProofKey,
				}),
		);
	const discovery = await OfficeDiscovery.get();
	let genuine = check(discovery);
	if (!genuine) {
		// The office server may have new keys (after an update): fetch them (rate limited).
		const fresh = await OfficeDiscovery.reload();
		if (fresh !== discovery) genuine = check(fresh);
	}
	// MS-WOPI: an invalid proof is answered with 500.
	if (!genuine) {
		logRefusal(
			discovery?.proofKey ? "proof" : "keys",
			discovery?.proofKey
				? `WOPI call refused: the office server's signature doesn't match (${c.req.method} ${calledUrl(c).split("?")[0]}). Check that IVENTWORKS_OFFICE_URL / IVENTWORKS_OFFICE_INTERNAL_URL point at the office server that calls us.`
				: "WOPI call refused: no proof keys from the office server (is its discovery reachable, WOPI_ENABLED=true?).",
		);
		return c.body(null, 500);
	}

	const resolved = await OfficeTokens.resolve(accessToken, fileId);
	if (!resolved) {
		logRefusal(
			"token",
			`WOPI call refused: unknown or expired access token for file ${fileId} (logged out, rights or file changed).`,
		);
		return c.body(null, 401);
	}
	// The id names this file of this installation (not one of the same number elsewhere).
	if (!WopiIds.matches(wopiId, resolved.file)) return c.body(null, 404);
	Logger.debug(
		`WOPI ${c.req.method} ${c.req.header("X-WOPI-Override") ?? (c.req.path.endsWith("/contents") ? "contents" : "info")} file ${fileId}`,
	);
	c.set("wopi", resolved);
	c.set("fileId", fileId);
	await next();
});

function fileInfo({ file, user, canWrite, permissions }: OfficeTokens.Resolved) {
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
		// The editor's "Versionsverlauf" and "Freigeben" open the file page's own dialogs
		// (`UI_FileVersions` / `UI_Sharing` to `FilesOfficeFrame`); share links only where allowed.
		FileVersionPostMessage: true,
		FileSharingPostMessage: permissions.manage && org.file_sharing_enabled,
	};
}

// CheckFileInfo
router.get("/files/:fileId", async (c) => {
	return c.json(fileInfo(c.get("wopi")));
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
	// Someone else's lock.
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
			return c.body(null, 200, { [LOCK_HEADER]: current });
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
