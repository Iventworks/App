import { and, eq, lt } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { inOrg } from "../../orgs/context";

/**
 * The stored part of shared Markdown editing (`file_collab`, `file_collab_updates`) that the rest
 * of the file code needs: throwing it away when a file's contents change some other way (a new
 * upload, a restore, a share link), and housekeeping. The session logic lives in `Collab`.
 */
export namespace CollabState {
	/** Forget the shared editing state of a file (its contents were replaced from outside). */
	export async function discard(fileId: number, tx: DrizzleDB = DB.instance()) {
		await tx
			.delete(DB.Tables.fileCollabUpdates)
			.where(and(inOrg(DB.Tables.fileCollabUpdates), eq(DB.Tables.fileCollabUpdates.file_id, fileId)))
			.run();
		await tx
			.delete(DB.Tables.fileCollab)
			.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, fileId)))
			.run();
	}

	/** Sessions nobody touched for this long are dropped by housekeeping (unscoped). */
	export const IDLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

	export async function pruneIdle(now: number) {
		const stale = await DB.instance()
			.select({ file_id: DB.Tables.fileCollab.file_id })
			.from(DB.Tables.fileCollab)
			.where(lt(DB.Tables.fileCollab.updated_at, now - IDLE_RETENTION_MS))
			.all();
		for (const { file_id } of stale) {
			await DB.instance()
				.delete(DB.Tables.fileCollabUpdates)
				.where(eq(DB.Tables.fileCollabUpdates.file_id, file_id))
				.run();
			await DB.instance()
				.delete(DB.Tables.fileCollab)
				.where(eq(DB.Tables.fileCollab.file_id, file_id))
				.run();
		}
		return stale.length;
	}
}
