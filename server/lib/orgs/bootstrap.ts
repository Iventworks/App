import { eq } from "drizzle-orm";
import { DB } from "../db";
import { AppConstants } from "../utils/constants";
import { LCrypt } from "../utils/crypto/lcrypt";
import { Logger } from "../utils/logger";
import { inOrg, OrgContext } from "./context";
import { type OrgInfo, OrgRegistry } from "./registry";

/** Slug of the system admins' org (multi-org mode). Reserved, so no tenant can take it. */
export const SYSTEM_ORG_SLUG = "system";

/** Slug of the org created in single-org mode. */
export const DEFAULT_ORG_SLUG = "default";

/**
 * Startup: make sure the orgs this mode needs exist, load the registry, and create the first
 * admin account with a one-time password link if the org has no users yet.
 *
 * - Single-org mode: one regular org (`default`, named after the app until an admin renames it).
 * - Multi-org mode: the system org, whose users are the system admins. Tenants are created
 *   through the system API.
 */
export class OrgBootstrap {
	static async run(configBaseDir: string) {
		const db = DB.instance();
		const multiOrg = OrgRegistry.isMultiOrg();

		await OrgContext.unscoped(async () => {
			const kind = multiOrg ? "system" : "org";
			const existing = await db
				.select({ id: DB.Tables.orgs.id })
				.from(DB.Tables.orgs)
				.where(eq(DB.Tables.orgs.kind, kind))
				.get();
			if (existing) return;

			await db
				.insert(DB.Tables.orgs)
				.values(
					multiOrg
						? { slug: SYSTEM_ORG_SLUG, kind: "system", display_name: `${AppConstants.APP_NAME} System` }
						: { slug: DEFAULT_ORG_SLUG, kind: "org", display_name: AppConstants.APP_NAME },
				);
			Logger.info(multiOrg ? "Created the system org." : "Created the default org.");
		});

		await OrgRegistry.reload();

		const org = multiOrg ? OrgRegistry.systemOrg() : OrgRegistry.singleOrg();
		if (!org) throw new Error("The org for this mode is missing after bootstrap.");

		await OrgContext.run(org, () => OrgBootstrap.createInitialAdminIfNeeded(org, configBaseDir));
	}

	/** First admin of `org` (run inside its context): random password plus a 7-day reset link. */
	static async createInitialAdminIfNeeded(org: OrgInfo, configBaseDir: string) {
		const db = DB.instance();
		const anyUser = await db
			.select({ id: DB.Tables.users.id })
			.from(DB.Tables.users)
			.where(inOrg(DB.Tables.users))
			.limit(1)
			.get();
		if (anyUser) return;

		const username = "admin";
		const passwordResetToken = LCrypt.randomBytes(64).toString("hex");

		try {
			await db.transaction(async (tx) => {
				const admin = await tx
					.insert(DB.Tables.users)
					.values({
						org_id: org.id,
						username,
						// Reserved TLD (RFC 2606): no real mailbox receives mail for the seed admin.
						// The admin sets their own address in the profile after the first login.
						email: `${username}@${org.slug}.invalid`,
						password_hash: await Bun.password.hash(LCrypt.randomBytes(32).toString("hex")),
						display_name: org.kind === "system" ? "System Administrator" : "Default Administrator",
						role: "admin",
					})
					.returning({ id: DB.Tables.users.id })
					.get();

				await tx.insert(DB.Tables.passwordResets).values({
					org_id: org.id,
					token: LCrypt.sha256(passwordResetToken).toHex(),
					user_id: admin.id,
					expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
				});
			});
		} catch (error) {
			Logger.critical("Failed to create initial admin user:", error);
			throw error;
		}

		const link = `${org.url}/auth/reset-password?token=${passwordResetToken}`;
		await Bun.write(`${configBaseDir}/initial_admin_password_reset_token.txt`, link, {
			mode: 0o600,
			createPath: true,
		});

		Logger.info(
			`Initial ${org.kind === "system" ? "system " : ""}admin user created with username: ${username}.\n` +
				`You can set the password under ${link}\n` +
				`The url is also saved at ${configBaseDir}/initial_admin_password_reset_token.txt\n`,
		);
	}
}
