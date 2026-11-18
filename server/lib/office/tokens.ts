import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { AuthHandler } from "../api/utils/authHandler";
import { FileAccess } from "../api/utils/fileAccess";
import { FileService } from "../api/utils/fileService";
import { PermissionHelper } from "../api/utils/permissions";
import { DB } from "../db";
import { inOrg, OrgContext } from "../orgs/context";

/**
 * Access tokens for the office server (`wopi_tokens`). Handed to the browser, which posts it to
 * the office server's editor; the office server sends it back with every WOPI call. Each call
 * checks again: the token, the login session it came from, the person (not suspended), the file
 * (not in the Papierkorb) and the person's rights on it right now.
 */
export namespace OfficeTokens {
	/** An editing session in the office server may last a working day. */
	export const TTL_MS = 10 * 60 * 60 * 1000;

	function hash(token: string) {
		return createHash("sha256").update(token).digest("hex");
	}

	export async function create(
		file: DB.Models.File,
		session: AuthHandler.SessionAuthContext,
		canWrite: boolean,
		now = Date.now(),
	) {
		const token = randomBytes(32).toString("base64url");
		const expiresAt = Math.min(now + TTL_MS, session.expires_at);
		await DB.instance()
			.insert(DB.Tables.wopiTokens)
			.values({
				org_id: OrgContext.id(),
				token_hash: hash(token),
				file_id: file.id,
				user_id: session.user_id,
				session_id: session.id,
				can_write: canWrite,
				expires_at: expiresAt,
				created_at: now,
			})
			.run();
		return { token, expiresAt };
	}

	export interface Resolved {
		file: DB.Models.File;
		user: DB.Models.User;
		/** May write right now: opened for editing and still allowed to edit. */
		canWrite: boolean;
		permissions: FileAccess.Permissions;
	}

	/** The token's file and person, if everything still holds; else null. */
	export async function resolve(
		token: string,
		fileId: number,
		now = Date.now(),
	): Promise<Resolved | null> {
		if (!token || token.length > 200) return null;
		const row = await DB.instance()
			.select()
			.from(DB.Tables.wopiTokens)
			.where(
				and(
					inOrg(DB.Tables.wopiTokens),
					eq(DB.Tables.wopiTokens.token_hash, hash(token)),
					gt(DB.Tables.wopiTokens.expires_at, now),
				),
			)
			.get();
		if (!row || row.file_id !== fileId) return null;

		const session = await DB.instance()
			.select()
			.from(DB.Tables.sessions)
			.where(
				and(
					inOrg(DB.Tables.sessions),
					eq(DB.Tables.sessions.id, row.session_id),
					gt(DB.Tables.sessions.expires_at, now),
				),
			)
			.get();
		const user = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, row.user_id)))
			.get();
		if (!session || !user || user.suspended_at !== null) return null;
		if (!PermissionHelper.hasOrgRole(user.role, "volunteer")) return null;

		const file = await FileService.get(fileId);
		if (!file || file.kind !== "file" || (await FileService.isInTrash(file))) return null;

		const authContext: AuthHandler.SessionAuthContext = {
			...session,
			user_role: user.role,
			type: "session",
		};
		const permissions = await FileAccess.permissionsFor(authContext, file);
		if (!permissions.read) return null;
		return { file, user, canWrite: row.can_write && permissions.edit, permissions };
	}

	/** Housekeeping (unscoped). */
	export async function pruneExpired(now: number) {
		await DB.instance()
			.delete(DB.Tables.wopiTokens)
			.where(lt(DB.Tables.wopiTokens.expires_at, now))
			.run();
	}
}
