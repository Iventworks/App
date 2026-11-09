import { and, count, eq, isNotNull } from "drizzle-orm";
import { DB } from "../db";
import { FileStorage } from "../utils/fileStorage";
import { Logger } from "../utils/logger";
import { OrgContext } from "./context";
import { type OrgInfo, type OrgPrimaryColor, OrgRegistry } from "./registry";

/** One DNS label: lower-case letters, digits and inner hyphens, 2–40 characters. */
export const ORG_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

/** Labels that must never become an org's default domain (`<slug>.<base host>`). */
export const RESERVED_ORG_SLUGS = new Set([
	"system",
	"admin",
	"api",
	"app",
	"www",
	"mail",
	"smtp",
	"static",
	"assets",
	"cdn",
	"auth",
	"login",
	"docs",
	"help",
	"support",
	"status",
	"dashboard",
	"default",
]);

export class OrgServiceError extends Error {
	constructor(
		readonly code: "slug_invalid" | "slug_reserved" | "slug_taken" | "not_found" | "system_org",
		message: string,
	) {
		super(message);
		this.name = "OrgServiceError";
	}
}

export interface OrgListEntry {
	readonly org: OrgInfo;
	readonly user_count: number;
	readonly event_count: number;
	readonly domain_count: number;
	readonly created_at: number;
}

/**
 * Creating, changing and deleting orgs. Everything here works across orgs, so it runs unscoped;
 * the registry is reloaded after every change so the next request sees it.
 */
export class OrgService {
	static validateSlug(slug: string) {
		if (!ORG_SLUG_PATTERN.test(slug)) {
			throw new OrgServiceError(
				"slug_invalid",
				"The slug must be 2–40 lower-case letters, digits or hyphens (no hyphen at either end)",
			);
		}
		if (RESERVED_ORG_SLUGS.has(slug)) {
			throw new OrgServiceError("slug_reserved", `The slug "${slug}" is reserved`);
		}
	}

	static async create(input: {
		slug: string;
		display_name: string;
		primary_color?: OrgPrimaryColor;
	}): Promise<OrgInfo> {
		const slug = input.slug.trim().toLowerCase();
		OrgService.validateSlug(slug);

		const db = DB.instance();
		const id = await OrgContext.unscoped(async () => {
			const taken = await db
				.select({ id: DB.Tables.orgs.id })
				.from(DB.Tables.orgs)
				.where(eq(DB.Tables.orgs.slug, slug))
				.get();
			if (taken) throw new OrgServiceError("slug_taken", `The slug "${slug}" is already taken`);

			const row = await db
				.insert(DB.Tables.orgs)
				.values({
					slug,
					kind: "org",
					display_name: input.display_name.trim(),
					primary_color: input.primary_color ?? "fuchsia",
				})
				.returning({ id: DB.Tables.orgs.id })
				.get();
			return row.id;
		});

		await OrgRegistry.reload();
		const org = OrgRegistry.get(id);
		if (!org) throw new Error(`Org ${id} missing from the registry after creation`);
		return org;
	}

	/** Name and colour (the slug never changes). */
	static async update(
		orgId: number,
		changes: {
			display_name?: string;
			primary_color?: OrgPrimaryColor;
			file_sharing_enabled?: boolean;
			share_default_expiry_days?: number | null;
		},
	): Promise<OrgInfo> {
		const set: Partial<typeof DB.Tables.orgs.$inferInsert> = { updated_at: Date.now() };
		if (changes.display_name !== undefined) set.display_name = changes.display_name.trim();
		if (changes.primary_color !== undefined) set.primary_color = changes.primary_color;
		if (changes.file_sharing_enabled !== undefined) {
			set.file_sharing_enabled = changes.file_sharing_enabled;
		}
		if (changes.share_default_expiry_days !== undefined) {
			set.share_default_expiry_days = changes.share_default_expiry_days;
		}

		await OrgContext.unscoped(() =>
			DB.instance().update(DB.Tables.orgs).set(set).where(eq(DB.Tables.orgs.id, orgId)).run(),
		);
		await OrgRegistry.reload();

		const org = OrgRegistry.get(orgId);
		if (!org) throw new OrgServiceError("not_found", "Organisation not found");
		return org;
	}

	/**
	 * Delete an org with all its data (every org table cascades on `org_id`) and its uploaded
	 * files on disk. The system org can't be deleted.
	 */
	static async delete(orgId: number) {
		const org = OrgRegistry.get(orgId);
		if (!org) throw new OrgServiceError("not_found", "Organisation not found");
		if (org.kind === "system") {
			throw new OrgServiceError("system_org", "The system organisation can't be deleted");
		}

		const db = DB.instance();
		const storageKeys = await OrgContext.unscoped(async () => {
			const files = await db
				.select({ storage_key: DB.Tables.files.storage_key })
				.from(DB.Tables.files)
				.where(and(eq(DB.Tables.files.org_id, orgId), isNotNull(DB.Tables.files.storage_key)))
				.all();
			await db.delete(DB.Tables.orgs).where(eq(DB.Tables.orgs.id, orgId)).run();
			return files.map((f) => f.storage_key!);
		});
		await OrgRegistry.reload();

		await FileStorage.remove(storageKeys).catch((error) =>
			Logger.warn(`Could not remove all files of deleted org ${org.slug}:`, error),
		);
		Logger.info(`Deleted org ${org.slug} (${orgId}) and ${storageKeys.length} file(s).`);
	}

	/** All tenants (not the system org) with a few numbers for the system dashboard. */
	static async list(): Promise<OrgListEntry[]> {
		const db = DB.instance();
		return OrgContext.unscoped(async () => {
			const rows = await db.select().from(DB.Tables.orgs).where(eq(DB.Tables.orgs.kind, "org")).all();
			const countBy = async (
				table: typeof DB.Tables.users | typeof DB.Tables.events | typeof DB.Tables.orgDomains,
			) => {
				const counts = await db
					.select({ org_id: table.org_id, value: count() })
					.from(table)
					.groupBy(table.org_id)
					.all();
				return new Map(counts.map((c) => [c.org_id, c.value]));
			};
			const [users, events, domains] = await Promise.all([
				countBy(DB.Tables.users),
				countBy(DB.Tables.events),
				countBy(DB.Tables.orgDomains),
			]);

			return rows.flatMap((row) => {
				const org = OrgRegistry.get(row.id);
				if (!org) return [];
				return [
					{
						org,
						user_count: users.get(row.id) ?? 0,
						event_count: events.get(row.id) ?? 0,
						domain_count: domains.get(row.id) ?? 0,
						created_at: row.created_at,
					},
				];
			});
		});
	}

	static async createdAt(orgId: number): Promise<number | null> {
		const row = await OrgContext.unscoped(() =>
			DB.instance()
				.select({ created_at: DB.Tables.orgs.created_at })
				.from(DB.Tables.orgs)
				.where(eq(DB.Tables.orgs.id, orgId))
				.get(),
		);
		return row?.created_at ?? null;
	}
}
