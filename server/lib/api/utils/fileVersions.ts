import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileStorage } from "../../utils/fileStorage";
import { UserSummary } from "./shared-models/userSummary";

/**
 * Earlier contents of files ("Versionen", `file_versions`). Whenever contents are replaced, the
 * old blob is kept as a version — unless the same person keeps saving (autosave): then at most one
 * version per `INTERVAL_MS`. Housekeeping keeps everything of the last `KEEP_DAYS` days, beyond
 * that the newest `KEEP_MIN` per file, never more than `MAX_PER_FILE`.
 */
export namespace FileVersions {
	export const INTERVAL_MS = 10 * 60 * 1000;
	export const KEEP_DAYS = 30;
	export const KEEP_MIN = 10;
	export const MAX_PER_FILE = 50;

	/**
	 * Whether the current contents of `file` become a version when `userId` replaces them.
	 * `session`: saved by a shared editing session, where several people save in turns — at most
	 * one version per interval, whoever saves.
	 */
	export function shouldKeep(
		tx: DrizzleDB.Sync,
		file: DB.Models.File,
		userId: number | null,
		now: number,
		session = false,
	) {
		if (!file.storage_key) return false;
		// Someone else's (or a share link's) contents are always kept — outside sessions.
		if (!session && (file.modified_by === null || file.modified_by !== userId)) return true;
		const latest = tx
			.select({ created_at: DB.Tables.fileVersions.created_at })
			.from(DB.Tables.fileVersions)
			.where(and(inOrg(DB.Tables.fileVersions), eq(DB.Tables.fileVersions.file_id, file.id)))
			.orderBy(desc(DB.Tables.fileVersions.id))
			.limit(1)
			.get();
		return !latest || now - latest.created_at >= INTERVAL_MS;
	}

	/** Store the current contents of `file` as a version (inside the caller's transaction). */
	export function archive(tx: DrizzleDB.Sync, file: DB.Models.File, now: number) {
		if (!file.storage_key) return;
		tx
			.insert(DB.Tables.fileVersions)
			.values({
				org_id: OrgContext.id(),
				file_id: file.id,
				storage_key: file.storage_key,
				size: file.size,
				mime_type: file.mime_type,
				modified_by: file.modified_by,
				modified_at: file.updated_at,
				created_at: now,
			})
			.run();
	}

	/**
	 * Replace the contents of `file` with a stored blob: the old contents become a version (or are
	 * removed, see `shouldKeep`). Returns the updated row.
	 */
	export async function replace(
		file: DB.Models.File,
		blob: { storageKey: string; size: number; mimeType: string },
		userId: number | null,
		options: { session?: boolean } = {},
	) {
		const now = Date.now();
		const { row, dropKey } = DB.instance().transaction((tx) => {
			// The row as it is now: another replace may have finished since the caller loaded it.
			const current = currentRow(tx, file.id);
			const keep = shouldKeep(tx, current, userId, now, options.session);
			if (keep) archive(tx, current, now);
			const updated = tx
				.update(DB.Tables.files)
				.set({
					storage_key: blob.storageKey,
					size: blob.size,
					mime_type: blob.mimeType,
					modified_by: userId,
					updated_at: now,
				})
				.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, file.id)))
				.returning()
				.get();
			return { row: updated, dropKey: keep ? null : current.storage_key };
		});
		if (dropKey) await FileStorage.remove([dropKey]);
		return row as DB.Models.File;
	}

	function currentRow(tx: DrizzleDB.Sync, fileId: number) {
		const row = tx
			.select()
			.from(DB.Tables.files)
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, fileId)))
			.get();
		if (!row) throw new Error(`File ${fileId} no longer exists`);
		return row;
	}

	export async function list(fileId: number) {
		return await DB.instance()
			.select()
			.from(DB.Tables.fileVersions)
			.where(and(inOrg(DB.Tables.fileVersions), eq(DB.Tables.fileVersions.file_id, fileId)))
			.orderBy(desc(DB.Tables.fileVersions.id))
			.all();
	}

	export async function get(fileId: number, versionId: number) {
		return (
			(await DB.instance()
				.select()
				.from(DB.Tables.fileVersions)
				.where(
					and(
						inOrg(DB.Tables.fileVersions),
						eq(DB.Tables.fileVersions.file_id, fileId),
						eq(DB.Tables.fileVersions.id, versionId),
					),
				)
				.get()) ?? null
		);
	}

	/**
	 * Make `version` the current contents again; the current contents become a version (always
	 * kept, so a restore can be undone). Null when the version is gone meanwhile.
	 */
	export function restore(file: DB.Models.File, version: DB.Models.FileVersion, userId: number) {
		const now = Date.now();
		return DB.instance().transaction((tx) => {
			const stillThere = tx
				.select({ id: DB.Tables.fileVersions.id })
				.from(DB.Tables.fileVersions)
				.where(and(inOrg(DB.Tables.fileVersions), eq(DB.Tables.fileVersions.id, version.id)))
				.get();
			if (!stillThere) return null;
			archive(tx, currentRow(tx, file.id), now);
			const updated = tx
				.update(DB.Tables.files)
				.set({
					storage_key: version.storage_key,
					size: version.size,
					mime_type: version.mime_type,
					modified_by: userId,
					updated_at: now,
				})
				.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, file.id)))
				.returning()
				.get();
			tx
				.delete(DB.Tables.fileVersions)
				.where(and(inOrg(DB.Tables.fileVersions), eq(DB.Tables.fileVersions.id, version.id)))
				.run();
			return updated as DB.Models.File;
		});
	}

	/** Storage keys of the versions of `fileIds` (to remove them with their files). */
	export async function storageKeys(fileIds: number[], tx: DrizzleDB = DB.instance()) {
		if (fileIds.length === 0) return [];
		const rows = await tx
			.select({ storage_key: DB.Tables.fileVersions.storage_key })
			.from(DB.Tables.fileVersions)
			.where(and(inOrg(DB.Tables.fileVersions), inArray(DB.Tables.fileVersions.file_id, fileIds)))
			.all();
		return rows.map((row) => row.storage_key);
	}

	/**
	 * Thin out versions of every org (housekeeping, unscoped). Their blobs go with the next
	 * orphan sweep.
	 */
	export async function prune(now: number) {
		const before = now - KEEP_DAYS * 24 * 60 * 60 * 1000;
		const result = await DB.instance().run(sql`
			delete from ${DB.Tables.fileVersions} where ${DB.Tables.fileVersions.id} in (
				select id from (
					select id, created_at,
						row_number() over (partition by file_id order by created_at desc, id desc) as position
					from ${DB.Tables.fileVersions}
				)
				where position > ${MAX_PER_FILE} or (position > ${KEEP_MIN} and created_at < ${before})
			)
		`);
		return (result as unknown as { changes?: number } | undefined)?.changes ?? 0;
	}

	export function contentPath(file: Pick<DB.Models.File, "id" | "name">, versionId: number) {
		return `/api/v1/files/${file.id}/versions/${versionId}/content/${encodeURIComponent(file.name)}`;
	}

	export const ItemSchema = z.object({
		id: z.number(),
		size: z.number(),
		mime_type: z.string().nullable(),
		/** Who wrote these contents. */
		modified_by: UserSummary.Schema.nullable(),
		/** When they were written. */
		modified_at: z.number(),
		/** When they were replaced. */
		created_at: z.number(),
		content_url: z.string(),
	});
	export type Item = z.infer<typeof ItemSchema>;

	export async function toResponses(
		file: DB.Models.File,
		versions: DB.Models.FileVersion[],
	): Promise<Item[]> {
		const users = await UserSummary.fetchMap(versions.map((version) => version.modified_by));
		return versions.map((version) => ({
			id: version.id,
			size: version.size,
			mime_type: version.mime_type,
			modified_by: version.modified_by !== null ? (users.get(version.modified_by) ?? null) : null,
			modified_at: version.modified_at,
			created_at: version.created_at,
			content_url: contentPath(file, version.id),
		}));
	}
}
