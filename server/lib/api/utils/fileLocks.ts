import { and, eq, gt, inArray } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import { CollabSessions } from "./collabSessions";

/**
 * Who is editing a file right now (`file_locks`): a shared Markdown editing session (`editor`,
 * held for everyone in it, see `Collab`) or, later, the office server. A lock expires unless it
 * is renewed; while it holds, nobody may replace the contents, restore a version or delete the
 * file.
 */
export namespace FileLocks {
	/** Renewed with every request of the session; a session that went quiet frees the file after this. */
	export const SESSION_TTL_MS = 2 * 60 * 1000;
	const SESSION_LOCK_ID = "collab";

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
	 * Take or renew the lock of a shared editing session. False while something else (the office
	 * server) holds the file.
	 */
	export function holdSession(fileId: number, now = Date.now()) {
		return DB.instance().transaction((tx) => {
			const existing = tx
				.select()
				.from(DB.Tables.fileLocks)
				.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
				.get();
			if (existing && existing.expires_at > now && existing.kind !== "editor") return false;
			if (existing) {
				tx
					.update(DB.Tables.fileLocks)
					.set({
						kind: "editor",
						lock_id: SESSION_LOCK_ID,
						user_id: null,
						expires_at: now + SESSION_TTL_MS,
					})
					.where(and(inOrg(DB.Tables.fileLocks), eq(DB.Tables.fileLocks.file_id, fileId)))
					.run();
			} else {
				tx
					.insert(DB.Tables.fileLocks)
					.values({
						org_id: OrgContext.id(),
						file_id: fileId,
						kind: "editor",
						lock_id: SESSION_LOCK_ID,
						user_id: null,
						expires_at: now + SESSION_TTL_MS,
					})
					.run();
			}
			return true;
		});
	}

	/** End a shared editing session's lock (the last person left). */
	export async function releaseSession(fileId: number) {
		await DB.instance()
			.delete(DB.Tables.fileLocks)
			.where(
				and(
					inOrg(DB.Tables.fileLocks),
					eq(DB.Tables.fileLocks.file_id, fileId),
					eq(DB.Tables.fileLocks.kind, "editor"),
				),
			)
			.run();
	}

	/** The lock that keeps anyone from changing the file's contents from outside its session. */
	export async function blocking(fileId: number, now = Date.now()) {
		return await current(fileId, now);
	}

	export interface Editing {
		kind: DB.Models.FileLock["kind"];
		users: { id: number; display_name: string }[];
		expires_at: number;
	}

	/** "Wird bearbeitet von …" for the API (`FileService.Item.editing`), per file id. */
	export function describe(locks: Iterable<DB.Models.FileLock>, now = Date.now()) {
		const orgId = OrgContext.id();
		const result = new Map<number, Editing>();
		for (const lock of locks) {
			const users = new Map<number, { id: number; display_name: string }>();
			if (lock.kind === "editor") {
				for (const participant of CollabSessions.participants(orgId, lock.file_id, now)) {
					users.set(participant.userId, {
						id: participant.userId,
						display_name: participant.displayName,
					});
				}
			}
			result.set(lock.file_id, {
				kind: lock.kind,
				users: [...users.values()],
				expires_at: lock.expires_at,
			});
		}
		return result;
	}
}
