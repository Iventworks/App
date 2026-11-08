import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { ConfigHandler } from "../../utils/config";
import { LCrypt } from "../../utils/crypto/lcrypt";

/**
 * One-time "set your password" links (`/auth/reset-password?token=…`), backed by the
 * `password_resets` table. Used by the forgot-password flow and by admins (new accounts without a
 * password, "Passwort-Link erstellen"). Only the SHA3-256 hash of a token is stored.
 */
export class PasswordLinks {
	/** Forgot-password requests (OWASP: 15–60 min). */
	static readonly RESET_TTL_MS = 60 * 60 * 1000;
	/** Links an admin hands over personally, e.g. for a new account — as long as an invitation. */
	static readonly ADMIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

	static hashToken(token: string) {
		return LCrypt.sha256(token).toHex();
	}

	/** Replaces any open link of the user with a new one and returns the raw token once. */
	static async issue(userID: number, ttlMs: number, tx: DrizzleDB = DB.instance()) {
		const token = randomBytes(64).toString("hex");
		const expiresAt = Date.now() + ttlMs;

		await tx
			.delete(DB.Tables.passwordResets)
			.where(eq(DB.Tables.passwordResets.user_id, userID))
			.run();
		await tx
			.insert(DB.Tables.passwordResets)
			.values({ user_id: userID, token: PasswordLinks.hashToken(token), expires_at: expiresAt })
			.run();

		return { token, url: PasswordLinks.url(token), expires_at: expiresAt };
	}

	static async revokeAll(userID: number, tx: DrizzleDB = DB.instance()) {
		await tx
			.delete(DB.Tables.passwordResets)
			.where(eq(DB.Tables.passwordResets.user_id, userID))
			.run();
	}

	static url(token: string) {
		const appUrl = ConfigHandler.getConfig()?.APP_URL ?? "";
		return `${appUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;
	}
}
