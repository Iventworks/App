/**
 * Import user accounts from a pre-merge CMP-API database into a fresh Iventworks database.
 *
 *   bun scripts/import-legacy-db.ts <path/to/old/db.sqlite> [path/to/new/db.sqlite] [org slug]
 *
 * The standalone CMP-API (env prefix `CMP_API_*`) stored only `users`, `sessions`,
 * `password_resets` and `metadata`. Its migrations are unrelated to this app's, so the old file
 * cannot be migrated in place. This script:
 *   1. creates/migrates the target database (default: `IVENTWORKS_DB_PATH` or ./data/db.sqlite),
 *   2. creates the target org (default `default`, the single-org mode's org) if it is missing,
 *   3. refuses to run when that org already has users (import into a fresh org only),
 *   4. copies every user with id, username, display name, email, password hash and role.
 * Sessions and reset tokens are not copied — everybody signs in again with their old password.
 * Run it BEFORE the first start of the new app (otherwise the initial admin is created first).
 */
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "../server/lib/db/schema";

const ROLES = ["admin", "core_team", "volunteer", "unverified"] as const;
type Role = (typeof ROLES)[number];

const [legacyPath, targetArg, orgSlug = "default"] = process.argv.slice(2);
const targetPath =
	targetArg ?? process.env.IVENTWORKS_DB_PATH ?? process.env.CMP_DB_PATH ?? "./data/db.sqlite";
const migrationsFolder =
	process.env.IVENTWORKS_DB_MIGRATION_DIR ??
	process.env.CMP_DB_MIGRATION_DIR ??
	"./drizzle/migrations";

if (!legacyPath) {
	console.error("Usage: bun scripts/import-legacy-db.ts <old-db.sqlite> [new-db.sqlite] [org slug]");
	process.exit(1);
}
if (!existsSync(legacyPath)) {
	console.error(`Legacy database not found: ${legacyPath}`);
	process.exit(1);
}

const legacy = new Database(legacyPath, { readonly: true });
const legacyUsers = legacy
	.query("SELECT id, username, display_name, email, password_hash, role FROM users ORDER BY id")
	.all() as {
	id: number;
	username: string;
	display_name: string;
	email: string;
	password_hash: string;
	role: string;
}[];
legacy.close();

mkdirSync(dirname(targetPath), { recursive: true });
const db = drizzle(targetPath);
db.$client.exec("PRAGMA foreign_keys = ON;");
await migrate(db, { migrationsFolder });

// Plain drizzle without the app's tenant guard: this script is the only writer.
const org =
	db.select().from(schema.orgs).where(eq(schema.orgs.slug, orgSlug)).get() ??
	db
		.insert(schema.orgs)
		.values({ slug: orgSlug, kind: "org", display_name: "Iventworks" })
		.returning()
		.get();

const existing = db
	.select({ id: schema.users.id })
	.from(schema.users)
	.where(eq(schema.users.org_id, org.id))
	.limit(1)
	.all();
if (existing.length > 0) {
	console.error(
		`Org "${orgSlug}" in ${targetPath} already has users. Import into a fresh org (stop the app, move the file away, run this script, then start the app).`,
	);
	process.exit(1);
}

db.transaction((tx) => {
	for (const user of legacyUsers) {
		const role: Role = (ROLES as readonly string[]).includes(user.role)
			? (user.role as Role)
			: "unverified";
		tx
			.insert(schema.users)
			.values({
				id: user.id,
				org_id: org.id,
				username: user.username,
				display_name: user.display_name,
				email: user.email,
				password_hash: user.password_hash,
				role,
			})
			.run();
	}
});

db.$client.close();
console.log(
	`Imported ${legacyUsers.length} user(s) from ${legacyPath} into org "${orgSlug}" of ${targetPath}.`,
);
