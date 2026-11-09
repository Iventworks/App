import { and, isNotNull, isNull, lt } from "drizzle-orm";
import { DB } from "../db";
import { OrgContext } from "../orgs/context";
import { Logger } from "./logger";

/**
 * Nightly cleanup of rows that are only kept until they expire. Runs from `CronJobHandler`.
 * Expired sessions are also deleted lazily when presented; this catches the ones nobody presents.
 */
export class Housekeeping {
	static readonly READ_NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

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

		Logger.info(
			`Housekeeping: removed ${sessions.length} expired session(s), ${resets.length} password reset(s), ${invitations.length} invitation(s), ${notifications.length} old notification(s).`,
		);
		return {
			sessions: sessions.length,
			passwordResets: resets.length,
			invitations: invitations.length,
			notifications: notifications.length,
		};
	}
}
