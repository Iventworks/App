import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { DB } from "../db";
import { OrgContext } from "../orgs/context";
import { FileStorage } from "./fileStorage";
import { Logger } from "./logger";

/**
 * Nightly cleanup of rows that are only kept until they expire. Runs from `CronJobHandler`.
 * Expired sessions are also deleted lazily when presented; this catches the ones nobody presents.
 */
export class Housekeeping {
	static readonly READ_NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

	/** Expired share links stay visible (as expired) for this long, then go. */
	static readonly EXPIRED_SHARE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

	/**
	 * Stored files no `files` row points at (an upload interrupted between writing the blob and the
	 * row, a crash during a delete) are removed once they are this old — the grace period keeps
	 * uploads that are still being written.
	 */
	static readonly ORPHAN_BLOB_GRACE_MS = 24 * 60 * 60 * 1000;

	/** Expired rows of every org at once: system code, so the tenant guard is off. */
	static async run(now = Date.now()) {
		return OrgContext.unscoped(() => Housekeeping.cleanUp(now));
	}

	private static async cleanUp(now: number) {
		const db = DB.instance();

		const sessions = await db
			.delete(DB.Tables.sessions)
			.where(lt(DB.Tables.sessions.expires_at, now))
			.returning({ id: DB.Tables.sessions.id })
			.all();
		const resets = await db
			.delete(DB.Tables.passwordResets)
			.where(lt(DB.Tables.passwordResets.expires_at, now))
			.returning({ token: DB.Tables.passwordResets.token })
			.all();
		// Expired, never-accepted invitations; accepted ones stay as a record of who invited whom.
		const invitations = await db
			.delete(DB.Tables.invitations)
			.where(and(lt(DB.Tables.invitations.expires_at, now), isNull(DB.Tables.invitations.accepted_at)))
			.returning({ id: DB.Tables.invitations.id })
			.all();
		const notifications = await db
			.delete(DB.Tables.notifications)
			.where(
				and(
					isNotNull(DB.Tables.notifications.read_at),
					lt(DB.Tables.notifications.read_at, now - Housekeeping.READ_NOTIFICATION_RETENTION_MS),
				),
			)
			.returning({ id: DB.Tables.notifications.id })
			.all();

		const shares = await db
			.delete(DB.Tables.fileShares)
			.where(lt(DB.Tables.fileShares.expires_at, now - Housekeeping.EXPIRED_SHARE_RETENTION_MS))
			.returning({ id: DB.Tables.fileShares.id })
			.all();

		// Chat attachments that were uploaded but never sent with a message.
		const unsentAttachments = await db
			.delete(DB.Tables.files)
			.where(
				and(
					eq(DB.Tables.files.scope, "message"),
					isNull(DB.Tables.files.message_id),
					lt(DB.Tables.files.created_at, now - Housekeeping.ORPHAN_BLOB_GRACE_MS),
				),
			)
			.returning({ id: DB.Tables.files.id })
			.all();

		const referenced = await db
			.select({ storage_key: DB.Tables.files.storage_key })
			.from(DB.Tables.files)
			.where(isNotNull(DB.Tables.files.storage_key))
			.all();
		const orphanBlobs = await FileStorage.removeUnreferenced(
			new Set(referenced.map((row) => row.storage_key!)),
			now - Housekeeping.ORPHAN_BLOB_GRACE_MS,
		);

		Logger.info(
			`Housekeeping: removed ${sessions.length} expired session(s), ${resets.length} password reset(s), ${invitations.length} invitation(s), ${notifications.length} old notification(s), ${shares.length} expired share link(s), ${unsentAttachments.length} unsent attachment(s), ${orphanBlobs} orphaned file(s).`,
		);
		return {
			sessions: sessions.length,
			passwordResets: resets.length,
			invitations: invitations.length,
			notifications: notifications.length,
			shares: shares.length,
			unsentAttachments: unsentAttachments.length,
			orphanBlobs,
		};
	}
}
