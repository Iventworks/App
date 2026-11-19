import { and, eq, gt, inArray } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileService } from "./fileService";

/**
 * Who is editing a file right now (`file_locks`): the office server while someone edits there
 * (kind `office`, WOPI locks). A lock expires unless it is renewed; while it holds, nobody may
 * replace the contents, restore a version or delete the file or a folder above it.
 */
export namespace FileLocks {
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

	/** Valid locks of several files (listings: "wird bearbeitet"). */
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

	// --- the office server's locks (WOPI) ---------------------------------------------------------

	/** WOPI locks last 30 minutes unless refreshed. */
	export const OFFICE_TTL_MS = 30 * 60 * 1000;

	/** The office server's current lock string, "" when the file is free. */
	export async function officeLockOf(fileId: number, now = Date.now()) {
		return (await current(fileId, now))?.lock_id ?? "";
	}

	/**
	 * LOCK (and UnlockAndRelock with `oldLockId`): take or refresh the office lock. On a conflict,
	 * `current` is the lock string to report (`X-WOPI-Lock`).
	 */
	export function officeLock(
		fileId: number,
		lockId: string,
		options: { oldLockId?: string; now?: number } = {},
	): { ok: true } | { ok: false; current: string } {
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
					.set({ kind: "office", lock_id: lockId, user_id: null, expires_at: now + OFFICE_TTL_MS })
					.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
					.run();
			} else {
				tx
					.insert(DB.Tables.fileLocks)
					.values({
						org_id: OrgContext.id(),
						file_id: fileId,
						kind: "office",
						lock_id: lockId,
						user_id: null,
						expires_at: now + OFFICE_TTL_MS,
					})
					.run();
			}
			return { ok: true as const };
		});
	}

	/** REFRESH_LOCK. */
	export async function officeRefresh(
		fileId: number,
		lockId: string,
		now = Date.now(),
	): Promise<{ ok: true } | { ok: false; current: string }> {
		const currentLock = await officeLockOf(fileId, now);
		if (currentLock !== lockId) return { ok: false, current: currentLock };
		await DB.instance()
			.update(DB.Tables.fileLocks)
			.set({ expires_at: now + OFFICE_TTL_MS })
			.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
			.run();
		return { ok: true };
	}

	/** UNLOCK. */
	export async function officeUnlock(
		fileId: number,
		lockId: string,
		now = Date.now(),
	): Promise<{ ok: true } | { ok: false; current: string }> {
		const currentLock = await officeLockOf(fileId, now);
		if (currentLock !== lockId) return { ok: false, current: currentLock };
		await DB.instance()
			.delete(DB.Tables.fileLocks)
			.where(
				and(
					inOrg(DB.Tables.fileLocks),
					eq(DB.Tables.fileLocks.file_id, fileId),
					eq(DB.Tables.fileLocks.kind, "office"),
				),
			)
			.run();
		return { ok: true };
	}

	/** The lock that keeps anyone from changing the file's contents from outside its session. */
	export async function blocking(fileId: number, now = Date.now()) {
		return await current(fileId, now);
	}

	/**
	 * Someone is editing `file` or, for a folder, a file inside it (outside the Papierkorb):
	 * deleting it would end their editing.
	 */
	export async function blockingWithin(file: DB.Models.File, now = Date.now()) {
		if (file.kind !== "folder") return Boolean(await blocking(file.id, now));
		const levels = await FileService.descendantLevels(file.id, { skipTrashed: true });
		const fileIds = levels
			.flat()
			.filter((entry) => entry.kind === "file")
			.map((entry) => entry.id);
		return (await forFiles(fileIds, now)).size > 0;
	}

	export interface Editing {
		kind: "office";
		expires_at: number;
	}

	/** "Wird in Office bearbeitet" for the API (`FileService.Item.editing`), per file id. */
	export function describe(locks: Iterable<DB.Models.FileLock>) {
		const result = new Map<number, Editing>();
		for (const lock of locks)
			result.set(lock.file_id, { kind: "office", expires_at: lock.expires_at });
		return result;
	}
}
