import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import { inOrg } from "../../orgs/context";
import type { FileAccess } from "./fileAccess";
import { FileService } from "./fileService";
import { UserSummary } from "./shared-models/userSummary";

type Failure = { ok: false; status: 403 | 404; message: string };

/**
 * The Papierkorb of org and event documents: deleting moves an item there (a folder with what is
 * inside it), `deleted_at` marks it. Managers (Kernteam / Leitung) see and restore everything and
 * delete for good; everyone else sees and restores what they deleted themselves. Restored items go
 * back to their folder — or to the top level when that folder is gone or in the Papierkorb too.
 * Housekeeping deletes items for good after `RETENTION_DAYS`.
 */
export namespace FileTrash {
	export const RETENTION_DAYS = 30;

	export const ItemSchema = FileService.ItemSchema.extend({
		deleted_at: z.number(),
		deleted_by: z.object({ id: z.number(), display_name: z.string() }).nullable(),
		/** The folders it was in (top first). */
		location: z.array(z.string()),
		/** When it will be deleted for good. */
		purge_at: z.number(),
		can_restore: z.boolean(),
		can_purge: z.boolean(),
	});
	export type Item = z.infer<typeof ItemSchema>;

	/** Move to the Papierkorb (soft delete). `userId` null: through a share link. */
	export async function trash(file: DB.Models.File, userId: number | null) {
		await DB.instance()
			.update(DB.Tables.files)
			.set({ deleted_at: Date.now(), deleted_by: userId })
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, file.id)))
			.run();
	}

	function trashed(location: FileService.Location) {
		return and(
			inOrg(DB.Tables.files),
			eq(DB.Tables.files.scope, location.scope),
			location.eventId === null
				? isNull(DB.Tables.files.event_id)
				: eq(DB.Tables.files.event_id, location.eventId),
			isNotNull(DB.Tables.files.deleted_at),
		);
	}

	/** What the caller sees in the Papierkorb of the viewer's library, newest first. */
	export async function list(viewer: FileAccess.Viewer): Promise<Item[]> {
		if (!viewer.inLibrary) return [];
		const rows = await DB.instance()
			.select()
			.from(DB.Tables.files)
			.where(
				and(
					trashed(viewer.location),
					viewer.manager ? undefined : eq(DB.Tables.files.deleted_by, viewer.userId),
				),
			)
			.orderBy(desc(DB.Tables.files.deleted_at))
			.all();
		const users = await UserSummary.fetchMap(rows.map((row) => row.deleted_by));

		const items: Item[] = [];
		for (const row of rows) {
			const path = row.parent_id === null ? [] : await FileService.getPath(row.parent_id);
			const deletedBy = row.deleted_by !== null ? users.get(row.deleted_by) : undefined;
			items.push({
				...FileService.toResponse(row),
				deleted_at: row.deleted_at as number,
				deleted_by: deletedBy ? { id: deletedBy.id, display_name: deletedBy.display_name } : null,
				location: path.map((folder) => folder.name),
				purge_at: (row.deleted_at as number) + RETENTION_DAYS * 24 * 60 * 60 * 1000,
				can_restore: viewer.manager || row.deleted_by === viewer.userId,
				can_purge: viewer.manager,
			});
		}
		return items;
	}

	async function find(viewer: FileAccess.Viewer, fileId: number) {
		const file = await FileService.get(fileId);
		if (!file || file.deleted_at === null || !FileService.isInLocation(file, viewer.location))
			return null;
		if (!viewer.inLibrary || (!viewer.manager && file.deleted_by !== viewer.userId)) return null;
		return file;
	}

	/** Put an item back. */
	export async function restore(
		viewer: FileAccess.Viewer,
		fileId: number,
	): Promise<{ ok: true; file: DB.Models.File; toRoot: boolean } | Failure> {
		const file = await find(viewer, fileId);
		if (!file) return { ok: false, status: 404, message: "Not in the Papierkorb" };

		// Its folder is gone or in the Papierkorb itself: back to the top level.
		let parentId = file.parent_id;
		if (parentId !== null) {
			const path = await FileService.getPath(parentId);
			if (path.at(-1)?.id !== parentId || FileService.isTrashed(path)) parentId = null;
		}
		const updated = await DB.instance()
			.update(DB.Tables.files)
			.set({ deleted_at: null, deleted_by: null, parent_id: parentId })
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, file.id)))
			.returning()
			.get();
		return { ok: true, file: updated as DB.Models.File, toRoot: parentId !== file.parent_id };
	}

	/** Delete an item for good (managers). */
	export async function purge(
		viewer: FileAccess.Viewer,
		fileId: number,
	): Promise<{ ok: true; file: DB.Models.File } | Failure> {
		if (!viewer.manager)
			return { ok: false, status: 403, message: "Only managers can delete for good" };
		const file = await find(viewer, fileId);
		if (!file) return { ok: false, status: 404, message: "Not in the Papierkorb" };
		await FileService.deleteRecursive(file);
		return { ok: true, file };
	}

	/** Empty the Papierkorb of the viewer's library (managers). */
	export async function empty(
		viewer: FileAccess.Viewer,
	): Promise<{ ok: true; count: number } | Failure> {
		if (!viewer.manager)
			return { ok: false, status: 403, message: "Only managers can delete for good" };
		const rows = await DB.instance()
			.select()
			.from(DB.Tables.files)
			.where(trashed(viewer.location))
			.all();
		for (const row of rows) {
			// Already gone with a folder deleted before it.
			const current = await FileService.get(row.id);
			if (current) await FileService.deleteRecursive(current);
		}
		return { ok: true, count: rows.length };
	}

	/**
	 * Housekeeping (unscoped): delete what has been in the Papierkorb longer than the retention.
	 * Rows below go with them (`ON DELETE CASCADE`); the blobs go with the orphan sweep.
	 */
	export async function purgeExpired(now: number) {
		const before = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
		const removed = await DB.instance()
			.delete(DB.Tables.files)
			.where(and(isNotNull(DB.Tables.files.deleted_at), lt(DB.Tables.files.deleted_at, before)))
			.returning({ id: DB.Tables.files.id })
			.all();
		return removed.length;
	}

	export const ListResponse = z.array(ItemSchema);
	export type ListResponse = z.infer<typeof ListResponse>;
}
