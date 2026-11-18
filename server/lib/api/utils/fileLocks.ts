import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import { UserSummary } from "./shared-models/userSummary";

/**
 * Who is editing a file right now (`file_locks`): the Markdown editor (one person) or, later, the
 * office server. A lock expires unless its holder renews it; while it holds, nobody else may
 * replace the contents, edit them or delete the file.
 */
export namespace FileLocks {
	/** The editor renews every minute; a closed tab frees the file after this. */
	export const EDITOR_TTL_MS = 2 * 60 * 1000;

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

	/**
	 * Take the editor lock for `userId`. Every call hands out a new lock id, so a second tab of
	 * the same person takes over and the first one's saves are refused.
	 */
	export function acquire(
		fileId: number,
		userId: number,
		now = Date.now(),
	): { ok: true; lock: DB.Models.FileLock } | { ok: false; lock: DB.Models.FileLock } {
		return DB.instance().transaction((tx) => {
			const existing = tx
				.select()
				.from(DB.Tables.fileLocks)
				.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
				.get();
			if (
				existing &&
				existing.expires_at > now &&
				(existing.kind !== "editor" || existing.user_id !== userId)
			) {
				return { ok: false as const, lock: existing };
			}
			if (existing) {
				tx
					.delete(DB.Tables.fileLocks)
					.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
					.run();
			}
			const lock = tx
				.insert(DB.Tables.fileLocks)
				.values({
					org_id: OrgContext.id(),
					file_id: fileId,
					kind: "editor",
					lock_id: randomBytes(16).toString("hex"),
					user_id: userId,
					expires_at: now + EDITOR_TTL_MS,
				})
				.returning()
				.get();
			return { ok: true as const, lock };
		});
	}

	/** Whether `lockId` is the valid editor lock of `userId` on the file. */
	export async function holds(fileId: number, userId: number, lockId: string, now = Date.now()) {
		const lock = await current(fileId, now);
		return Boolean(
			lock && lock.kind === "editor" && lock.user_id === userId && lock.lock_id === lockId,
		);
	}

	/** Renew a held lock; false when it is gone or someone else's. */
	export async function renew(fileId: number, userId: number, lockId: string, now = Date.now()) {
		if (!(await holds(fileId, userId, lockId, now))) return null;
		return (
			(await DB.instance()
				.update(DB.Tables.fileLocks)
				.set({ expires_at: now + EDITOR_TTL_MS })
				.where(
					and(
						inOrg(DB.Tables.fileLocks),
						eq(DB.Tables.fileLocks.file_id, fileId),
						eq(DB.Tables.fileLocks.lock_id, lockId),
					),
				)
				.returning()
				.get()) ?? null
		);
	}

	/** Remove the lock (`lockId`: only that one; null: whichever, for managers). */
	export async function release(fileId: number, lockId: string | null) {
		const result = await DB.instance()
			.delete(DB.Tables.fileLocks)
			.where(
				and(
					inOrg(DB.Tables.fileLocks),
					eq(DB.Tables.fileLocks.file_id, fileId),
					lockId === null ? undefined : eq(DB.Tables.fileLocks.lock_id, lockId),
				),
			)
			.returning({ file_id: DB.Tables.fileLocks.file_id })
			.all();
		return result.length > 0;
	}

	/** "Wird bearbeitet von …" for the API (`FileService.Item.editing`), per file id. */
	export async function describe(locks: Iterable<DB.Models.FileLock>) {
		const list = [...locks];
		const users = await UserSummary.fetchMap(list.map((lock) => lock.user_id));
		return new Map(
			list.map((lock) => {
				const user = lock.user_id !== null ? users.get(lock.user_id) : undefined;
				return [
					lock.file_id,
					{
						kind: lock.kind,
						user: user ? { id: user.id, display_name: user.display_name } : null,
						expires_at: lock.expires_at,
					},
				] as const;
			}),
		);
	}

	/**
	 * The lock that keeps `userId` from changing the file's contents: someone else's (or another
	 * kind's) valid lock. A person's own editor lock doesn't block their other writes.
	 */
	export async function blocking(fileId: number, userId: number | null, now = Date.now()) {
		const lock = await current(fileId, now);
		if (!lock) return null;
		if (lock.kind === "editor" && userId !== null && lock.user_id === userId) return null;
		return lock;
	}
}
