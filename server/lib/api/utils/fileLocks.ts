import { and, eq, gt, inArray } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileService } from "./fileService";

/**
 * The office server's locks on files (`file_locks`, WOPI LOCK / UNLOCK): someone is editing the
 * file in the office editor. A lock expires unless it is refreshed; while it holds, nobody may
 * replace the contents, restore a version or delete the file or a folder above it.
 */
export namespace FileLocks {
	/** WOPI locks last 30 minutes unless refreshed. */
	const TTL_MS = 30 * 60 * 1000;

	type Result = { ok: true } | { ok: false; current: string };

	/** The valid lock of a file, if any. */
	export async function current(fileId: number, now = Date.now()) {
		return (
			(await DB.instance()
				.select()
				.from(DB.Tables.fileLocks)
				.where(
					and(
						inOrg(DB.Tables.fileLocks),
						eq(DB.Tables.fileLocks.file_id, fileId),
						gt(DB.Tables.fileLocks.expires_at, now),
					),
				)
				.get()) ?? null
		);
	}

	/** Valid locks of several files, per file id (listings: "wird bearbeitet"). */
	export async function forFiles(fileIds: number[], now = Date.now()) {
		if (fileIds.length === 0) return new Map<number, DB.Models.FileLock>();
		const rows = await DB.instance()
			.select()
			.from(DB.Tables.fileLocks)
			.where(
				and(
					inOrg(DB.Tables.fileLocks),
					inArray(DB.Tables.fileLocks.file_id, fileIds),
					gt(DB.Tables.fileLocks.expires_at, now),
				),
			)
			.all();
		return new Map(rows.map((row) => [row.file_id, row]));
	}

	/**
	 * Someone is editing `file` or, for a folder, a file inside it (outside the Papierkorb):
	 * deleting it would end their editing.
	 */
	export async function blockingWithin(file: DB.Models.File, now = Date.now()) {
		if (file.kind !== "folder") return Boolean(await current(file.id, now));
		const levels = await FileService.descendantLevels(file.id, { skipTrashed: true });
		const fileIds = levels
			.flat()
			.filter((entry) => entry.kind === "file")
			.map((entry) => entry.id);
		return (await forFiles(fileIds, now)).size > 0;
	}

	/** "Wird in Office bearbeitet" for the API (`FileService.Item.editing`). */
	export function editingOf(lock: DB.Models.FileLock | null | undefined) {
		return lock ? { expires_at: lock.expires_at } : null;
	}

	// --- WOPI ------------------------------------------------------------------------------------

	/** The office server's current lock string, "" when the file is free. */
	export async function officeLockOf(fileId: number, now = Date.now()) {
		return (await current(fileId, now))?.lock_id ?? "";
	}

	/**
	 * LOCK (and UnlockAndRelock with `oldLockId`): take or refresh the lock. On a conflict,
	 * `current` is the lock string to report (`X-WOPI-Lock`).
	 */
	export function officeLock(
		fileId: number,
		lockId: string,
		options: { oldLockId?: string; now?: number } = {},
	): Result {
		const now = options.now ?? Date.now();
		return DB.instance().transaction((tx) => {
			const existing = tx
				.select()
				.from(DB.Tables.fileLocks)
				.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
				.get();
			const valid = existing && existing.expires_at > now ? existing : null;
			const expected = options.oldLockId ?? lockId;
			if (valid && valid.lock_id !== expected) return { ok: false as const, current: valid.lock_id };
			if (options.oldLockId !== undefined && !valid) return { ok: false as const, current: "" };
			if (existing) {
				tx
					.update(DB.Tables.fileLocks)
					.set({ lock_id: lockId, expires_at: now + TTL_MS })
					.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
					.run();
			} else {
				tx
					.insert(DB.Tables.fileLocks)
					.values({
						org_id: OrgContext.id(),
						file_id: fileId,
						lock_id: lockId,
						expires_at: now + TTL_MS,
					})
					.run();
			}
			return { ok: true as const };
		});
	}

	/** The valid lock `lockId` of the file — the condition for refreshing and unlocking it. */
	function heldAs(fileId: number, lockId: string, now: number) {
		return and(
			inOrg(DB.Tables.fileLocks),
			eq(DB.Tables.fileLocks.file_id, fileId),
			eq(DB.Tables.fileLocks.lock_id, lockId),
			gt(DB.Tables.fileLocks.expires_at, now),
		);
	}

	/** REFRESH_LOCK. A free file (or another lock) is a conflict. */
	export async function officeRefresh(
		fileId: number,
		lockId: string,
		now = Date.now(),
	): Promise<Result> {
		const refreshed = await DB.instance()
			.update(DB.Tables.fileLocks)
			.set({ expires_at: now + TTL_MS })
			.where(heldAs(fileId, lockId, now))
			.returning({ file_id: DB.Tables.fileLocks.file_id })
			.all();
		if (refreshed.length > 0) return { ok: true };
		return { ok: false, current: await officeLockOf(fileId, now) };
	}

	/** UNLOCK. A free file (or another lock) is a conflict. */
	export async function officeUnlock(
		fileId: number,
		lockId: string,
		now = Date.now(),
	): Promise<Result> {
		const removed = await DB.instance()
			.delete(DB.Tables.fileLocks)
			.where(heldAs(fileId, lockId, now))
			.returning({ file_id: DB.Tables.fileLocks.file_id })
			.all();
		if (removed.length > 0) return { ok: true };
		return { ok: false, current: await officeLockOf(fileId, now) };
	}
}
