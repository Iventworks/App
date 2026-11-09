import { isNotNull } from "drizzle-orm";
import { DB } from "../db";
import type { ORG_PRIMARY_COLORS } from "../db/schema";
import { ConfigHandler } from "../utils/config";
import { AppConstants } from "../utils/constants";
import { OrgContext } from "./context";

export type OrgPrimaryColor = (typeof ORG_PRIMARY_COLORS)[number];

/** What the registry keeps in memory per org — enough to answer a request without a query. */
export interface OrgInfo {
	readonly id: number;
	readonly slug: string;
	readonly kind: "org" | "system";
	readonly display_name: string;
	readonly primary_color: OrgPrimaryColor;
	/** `<slug>.<base host>` in multi-org mode, the APP_URL host otherwise (and for the system org). */
	readonly default_domain: string;
	/** The verified custom domain every other host of the org redirects to, or null. */
	readonly primary_domain: string | null;
	/** Base URL for links in emails and invitations: the primary domain, else the default one. */
	readonly url: string;
	readonly logo: OrgAssetInfo | null;
	readonly icon: OrgAssetInfo | null;
}

export interface OrgAssetInfo {
	readonly mime_type: string;
	readonly size_px: number | null;
	readonly updated_at: number;
}

export type HostResolution =
	| { readonly kind: "org"; readonly host: string; readonly org: OrgInfo }
	| { readonly kind: "system"; readonly host: string; readonly org: OrgInfo }
	| { readonly kind: "unknown"; readonly host: string };

interface HeaderSource {
	get(name: string): string | null | undefined;
}

/**
 * In-memory lookup host → org, rebuilt from the database at startup and after every change to
 * orgs, domains or branding ({@link OrgRegistry.reload}). Resolving a request is a few `Map`
 * lookups, no query.
 *
 * Multi-org mode: the APP_URL host is the system admin dashboard, `<slug>.<APP_URL host>` and the
 * verified custom domains are orgs, everything else is unknown. Single-org mode: the one org
 * answers on every host.
 */
export class OrgRegistry {
	private static byId = new Map<number, OrgInfo>();
	private static bySlug = new Map<string, number>();
	private static byDomain = new Map<string, number>();
	private static systemOrgId: number | null = null;
	private static singleOrgId: number | null = null;
	private static loaded = false;

	static isLoaded() {
		return OrgRegistry.loaded;
	}

	static isMultiOrg() {
		return ConfigHandler.getConfig()?.MULTI_ORG === true;
	}

	/** Load (or reload) every org and verified domain. Cheap: orgs change rarely. */
	static async reload() {
		const db = DB.instance();
		const { orgs, domains, assets } = await OrgContext.unscoped(async () => ({
			orgs: await db.select().from(DB.Tables.orgs).all(),
			domains: await db
				.select({
					org_id: DB.Tables.orgDomains.org_id,
					domain: DB.Tables.orgDomains.domain,
					is_primary: DB.Tables.orgDomains.is_primary,
				})
				.from(DB.Tables.orgDomains)
				.where(isNotNull(DB.Tables.orgDomains.verified_at))
				.all(),
			assets: await db
				.select({
					org_id: DB.Tables.orgAssets.org_id,
					kind: DB.Tables.orgAssets.kind,
					mime_type: DB.Tables.orgAssets.mime_type,
					size_px: DB.Tables.orgAssets.size_px,
					updated_at: DB.Tables.orgAssets.updated_at,
				})
				.from(DB.Tables.orgAssets)
				.all(),
		}));

		const multiOrg = OrgRegistry.isMultiOrg();
		const baseHost = OrgRegistry.baseHost();

		const byId = new Map<number, OrgInfo>();
		const bySlug = new Map<string, number>();
		const byDomain = new Map<string, number>();
		let systemOrgId: number | null = null;
		let singleOrgId: number | null = null;

		for (const org of orgs) {
			const orgDomains = domains.filter((d) => d.org_id === org.id);
			const primary = orgDomains.find((d) => d.is_primary)?.domain ?? null;
			const asset = (kind: "logo" | "icon") => {
				const row = assets.find((a) => a.org_id === org.id && a.kind === kind);
				return row
					? { mime_type: row.mime_type, size_px: row.size_px, updated_at: row.updated_at }
					: null;
			};

			const isSystem = org.kind === "system";
			const defaultDomain = !multiOrg || isSystem ? baseHost : `${org.slug}.${baseHost}`;
			const usesCustomDomain = multiOrg && !isSystem && primary !== null;

			byId.set(org.id, {
				id: org.id,
				slug: org.slug,
				kind: org.kind,
				display_name: org.display_name,
				primary_color: org.primary_color,
				default_domain: defaultDomain,
				primary_domain: usesCustomDomain ? primary : null,
				url:
					!multiOrg || isSystem
						? OrgRegistry.appUrl()
						: OrgRegistry.urlForHost(usesCustomDomain ? primary : defaultDomain),
				logo: asset("logo"),
				icon: asset("icon"),
			});

			if (isSystem) {
				systemOrgId ??= org.id;
				continue;
			}
			bySlug.set(org.slug, org.id);
			if (singleOrgId === null || org.id < singleOrgId) singleOrgId = org.id;
			if (multiOrg) {
				for (const domain of orgDomains) byDomain.set(domain.domain, org.id);
			}
		}

		OrgRegistry.byId = byId;
		OrgRegistry.bySlug = bySlug;
		OrgRegistry.byDomain = byDomain;
		OrgRegistry.systemOrgId = systemOrgId;
		OrgRegistry.singleOrgId = singleOrgId;
		OrgRegistry.loaded = true;
	}

	static get(orgId: number): OrgInfo | null {
		return OrgRegistry.byId.get(orgId) ?? null;
	}

	static getBySlug(slug: string): OrgInfo | null {
		const id = OrgRegistry.bySlug.get(slug);
		return id === undefined ? null : OrgRegistry.get(id);
	}

	/** The system admins' org (multi-org mode only). */
	static systemOrg(): OrgInfo | null {
		return OrgRegistry.systemOrgId === null ? null : OrgRegistry.get(OrgRegistry.systemOrgId);
	}

	/** The org that answers every host in single-org mode. */
	static singleOrg(): OrgInfo | null {
		return OrgRegistry.singleOrgId === null ? null : OrgRegistry.get(OrgRegistry.singleOrgId);
	}

	static resolveHost(rawHost: string | null | undefined): HostResolution {
		const host = normalizeHost(rawHost);

		if (!OrgRegistry.isMultiOrg()) {
			const org = OrgRegistry.singleOrg();
			return org ? { kind: "org", host, org } : { kind: "unknown", host };
		}

		const baseHost = OrgRegistry.baseHost();
		if (host === baseHost) {
			const org = OrgRegistry.systemOrg();
			return org ? { kind: "system", host, org } : { kind: "unknown", host };
		}

		let orgId: number | undefined;
		if (host.endsWith(`.${baseHost}`)) {
			const label = host.slice(0, -(baseHost.length + 1));
			if (!label.includes(".")) orgId = OrgRegistry.bySlug.get(label);
		} else {
			orgId = OrgRegistry.byDomain.get(host);
		}

		const org = orgId === undefined ? null : OrgRegistry.get(orgId);
		return org ? { kind: "org", host, org } : { kind: "unknown", host };
	}

	/** The host a request was made for: `X-Iventworks-Host` > `X-Forwarded-Host` > `Host`. */
	static requestHost(headers: HeaderSource, fallbackUrl?: string): string {
		const header =
			headers.get(AppConstants.HOST_HEADER) ||
			headers.get("x-forwarded-host") ||
			headers.get("host") ||
			(fallbackUrl ? new URL(fallbackUrl).host : "");
		return normalizeHost(header);
	}

	/**
	 * Where a page load on `host` has to go instead, or null: every host of an org with a verified
	 * primary custom domain redirects to that domain.
	 */
	static redirectFor(resolution: HostResolution): string | null {
		if (resolution.kind !== "org") return null;
		const primary = resolution.org.primary_domain;
		if (!primary || primary === resolution.host) return null;
		return OrgRegistry.urlForHost(primary);
	}

	/** Lower-case host name of APP_URL. */
	static baseHost(): string {
		return normalizeHost(new URL(OrgRegistry.appUrl()).host);
	}

	static appUrl(): string {
		return (ConfigHandler.getConfig()?.APP_URL ?? "http://localhost:31316").replace(/\/+$/, "");
	}

	/** `https://<host>` with APP_URL's protocol and port. */
	static urlForHost(host: string): string {
		const base = new URL(OrgRegistry.appUrl());
		return `${base.protocol}//${host}${base.port ? `:${base.port}` : ""}`;
	}
}

/** Lower-case, first entry of a list, without port and trailing dot. */
export function normalizeHost(raw: string | null | undefined): string {
	let host = (raw ?? "").split(",")[0]!.trim().toLowerCase();
	if (host.startsWith("[")) {
		host = host.slice(0, host.indexOf("]") + 1);
	} else {
		host = host.replace(/:\d+$/, "");
	}
	return host.replace(/\.$/, "");
}
