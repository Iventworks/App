import { promises as dns } from "node:dns";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { DB } from "../db";
import { AppConstants } from "../utils/constants";
import { LCrypt } from "../utils/crypto/lcrypt";
import { inOrg, OrgContext } from "./context";
import { normalizeHost, OrgRegistry } from "./registry";

/** The DNS queries the verification needs; swapped for a fake in the tests. */
export interface DnsLookup {
	/** TXT records of `name`, each with its chunks joined. Empty when there are none. */
	txt(name: string): Promise<string[]>;
	/** CNAME targets of `name` (lower-case, no trailing dot). Empty when there is none. */
	cname(name: string): Promise<string[]>;
	/** IPv4 and IPv6 addresses of `name`. Empty when it doesn't resolve. */
	addresses(name: string): Promise<string[]>;
}

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN", "ESERVFAIL"]);

async function orEmpty<T>(query: Promise<T[]>): Promise<T[]> {
	try {
		return await query;
	} catch (error) {
		if (NOT_FOUND_CODES.has((error as { code?: string }).code ?? "")) return [];
		throw error;
	}
}

export const systemDns: DnsLookup = {
	async txt(name) {
		return (await orEmpty(dns.resolveTxt(name))).map((chunks) => chunks.join(""));
	},
	async cname(name) {
		return (await orEmpty(dns.resolveCname(name))).map((target) => normalizeHost(target));
	},
	async addresses(name) {
		const [v4, v6] = await Promise.all([orEmpty(dns.resolve4(name)), orEmpty(dns.resolve6(name))]);
		return [...v4, ...v6];
	},
};

export class DomainError extends Error {
	constructor(
		readonly code: "invalid" | "reserved" | "taken" | "exists" | "not_found" | "not_verified",
		message: string,
	) {
		super(message);
		this.name = "DomainError";
	}
}

// RFC 1123 labels; at least two labels; no bare IPs (an all-numeric last label).
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export interface DomainView {
	readonly id: number;
	readonly domain: string;
	readonly verified: boolean;
	readonly verified_at: number | null;
	readonly is_primary: boolean;
	readonly last_checked_at: number | null;
	readonly last_check_error: string | null;
	readonly created_at: number;
	/** The two records the org has to create at its DNS provider. */
	readonly dns: {
		readonly txt_name: string;
		readonly txt_value: string;
		readonly cname_name: string;
		readonly cname_target: string;
	};
}

/**
 * Custom domains of the current org (multi-org mode). A domain only serves the org after both
 * checks passed: the TXT record `_iventworks-challenge.<domain>` = `iventworks-verification=<token>`
 * proves ownership, and a CNAME to the org's default domain (or, for apex domains with
 * CNAME flattening, the same addresses) proves it points at us. The first verified domain becomes
 * the primary one; while there is a primary domain, every other host of the org redirects to it.
 *
 * Runs in the org's context (`OrgContext.run`), like every other org-scoped code.
 */
export class DomainService {
	private static lookup: DnsLookup = systemDns;

	/** Tests: answer DNS queries from a fake. */
	static useDns(lookup: DnsLookup | null) {
		DomainService.lookup = lookup ?? systemDns;
	}

	/** `https://Example.org:443/path` → `example.org`; throws {@link DomainError} when invalid. */
	static normalize(input: string): string {
		let host = input.trim().toLowerCase();
		host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
		host = host.split(/[/?#]/)[0] ?? "";
		host = normalizeHost(host);

		const labels = host.split(".");
		if (
			host.length > 253 ||
			labels.length < 2 ||
			!labels.every((label) => LABEL.test(label)) ||
			/^\d+$/.test(labels.at(-1) ?? "")
		) {
			throw new DomainError("invalid", "Not a valid domain name");
		}

		const base = OrgRegistry.baseHost();
		if (host === base || host.endsWith(`.${base}`)) {
			throw new DomainError("reserved", `Domains under ${base} are assigned automatically`);
		}
		return host;
	}

	static async list(): Promise<DomainView[]> {
		const rows = await DB.instance()
			.select()
			.from(DB.Tables.orgDomains)
			.where(inOrg(DB.Tables.orgDomains))
			.orderBy(asc(DB.Tables.orgDomains.created_at), asc(DB.Tables.orgDomains.id))
			.all();
		return rows.map((row) => DomainService.view(row));
	}

	static async get(domainId: number): Promise<DB.Models.OrgDomain> {
		const row = await DB.instance()
			.select()
			.from(DB.Tables.orgDomains)
			.where(and(inOrg(DB.Tables.orgDomains), eq(DB.Tables.orgDomains.id, domainId)))
			.get();
		if (!row) throw new DomainError("not_found", "Domain not found");
		return row;
	}

	static async add(input: string): Promise<DomainView> {
		const domain = DomainService.normalize(input);

		// One org per domain, across all orgs: the only cross-org read here.
		const existing = await OrgContext.unscoped(() =>
			DB.instance()
				.select({ org_id: DB.Tables.orgDomains.org_id })
				.from(DB.Tables.orgDomains)
				.where(eq(DB.Tables.orgDomains.domain, domain))
				.get(),
		);
		if (existing) {
			throw existing.org_id === OrgContext.id()
				? new DomainError("exists", "This domain is already added")
				: new DomainError("taken", "This domain belongs to another organisation");
		}

		const row = await DB.instance()
			.insert(DB.Tables.orgDomains)
			.values({
				org_id: OrgContext.id(),
				domain,
				verification_token: LCrypt.randomBytes(16).toString("hex"),
			})
			.returning()
			.get();
		return DomainService.view(row);
	}

	static async remove(domainId: number) {
		const row = await DomainService.get(domainId);
		await DB.instance()
			.delete(DB.Tables.orgDomains)
			.where(and(inOrg(DB.Tables.orgDomains), eq(DB.Tables.orgDomains.id, row.id)))
			.run();

		// The primary domain is gone: the oldest other verified domain takes over, if any.
		if (row.is_primary) {
			const next = await DB.instance()
				.select({ id: DB.Tables.orgDomains.id })
				.from(DB.Tables.orgDomains)
				.where(and(inOrg(DB.Tables.orgDomains), isNotNull(DB.Tables.orgDomains.verified_at)))
				.orderBy(asc(DB.Tables.orgDomains.verified_at))
				.get();
			if (next) await DomainService.markPrimary(next.id);
		}
		await OrgRegistry.reload();
		return row;
	}

	/**
	 * Run both DNS checks. A pending domain becomes verified when they pass (and primary, if the
	 * org has none yet); a verified domain stays verified — the checks only gate activation.
	 */
	static async verify(domainId: number): Promise<DomainView> {
		const row = await DomainService.get(domainId);
		if (row.verified_at !== null) return DomainService.view(row);

		const error = await DomainService.check(row);
		const now = Date.now();
		await DB.instance()
			.update(DB.Tables.orgDomains)
			.set({
				last_checked_at: now,
				last_check_error: error,
				...(error === null ? { verified_at: now } : {}),
			})
			.where(and(inOrg(DB.Tables.orgDomains), eq(DB.Tables.orgDomains.id, row.id)))
			.run();

		if (error === null) {
			const primary = await DB.instance()
				.select({ id: DB.Tables.orgDomains.id })
				.from(DB.Tables.orgDomains)
				.where(and(inOrg(DB.Tables.orgDomains), eq(DB.Tables.orgDomains.is_primary, true)))
				.get();
			if (!primary) await DomainService.markPrimary(row.id);
			await OrgRegistry.reload();
		}

		return DomainService.view(await DomainService.get(row.id));
	}

	/** Make a verified domain the primary one, or (`primary = false`) stop redirecting to it. */
	static async setPrimary(domainId: number, primary: boolean): Promise<DomainView> {
		const row = await DomainService.get(domainId);
		if (primary && row.verified_at === null) {
			throw new DomainError("not_verified", "Only verified domains can be the primary domain");
		}

		if (primary) {
			await DomainService.markPrimary(row.id);
		} else {
			await DB.instance()
				.update(DB.Tables.orgDomains)
				.set({ is_primary: false })
				.where(and(inOrg(DB.Tables.orgDomains), eq(DB.Tables.orgDomains.id, row.id)))
				.run();
		}
		await OrgRegistry.reload();
		return DomainService.view(await DomainService.get(row.id));
	}

	/** Check every pending domain of every org (cron). Returns how many got verified. */
	static async verifyPending(): Promise<number> {
		const pending = await OrgContext.unscoped(() =>
			DB.instance()
				.select({ id: DB.Tables.orgDomains.id, org_id: DB.Tables.orgDomains.org_id })
				.from(DB.Tables.orgDomains)
				.where(isNull(DB.Tables.orgDomains.verified_at))
				.all(),
		);

		let verified = 0;
		for (const domain of pending) {
			const org = OrgRegistry.get(domain.org_id);
			if (!org) continue;
			const view = await OrgContext.run(org, () => DomainService.verify(domain.id));
			if (view.verified) verified++;
		}
		return verified;
	}

	/** Both DNS checks for `row`; null when they pass, else a German explanation. */
	private static async check(row: DB.Models.OrgDomain): Promise<string | null> {
		const org = OrgContext.current();
		const target = org.default_domain;
		const txtName = `${AppConstants.DOMAIN_CHALLENGE_PREFIX}.${row.domain}`;
		const txtValue = `${AppConstants.DOMAIN_CHALLENGE_VALUE_PREFIX}${row.verification_token}`;
		const lookup = DomainService.lookup;

		try {
			const problems: string[] = [];

			const txt = await lookup.txt(txtName);
			if (!txt.some((record) => record.trim() === txtValue)) {
				problems.push(`Der TXT-Eintrag ${txtName} mit dem Wert ${txtValue} wurde nicht gefunden.`);
			}

			const cname = await lookup.cname(row.domain);
			let pointsHere = cname.includes(target);
			if (!pointsHere && cname.length === 0) {
				// Apex domains can't have a CNAME; providers flatten it into A/AAAA records instead.
				const [own, expected] = await Promise.all([
					lookup.addresses(row.domain),
					lookup.addresses(target),
				]);
				pointsHere = own.length > 0 && own.some((address) => expected.includes(address));
			}
			if (!pointsHere) {
				problems.push(`${row.domain} zeigt nicht per CNAME auf ${target}.`);
			}

			return problems.length ? problems.join(" ") : null;
		} catch (error) {
			return `DNS-Abfrage fehlgeschlagen: ${(error as Error).message}`;
		}
	}

	private static async markPrimary(domainId: number) {
		await DB.instance()
			.update(DB.Tables.orgDomains)
			.set({ is_primary: false })
			.where(and(inOrg(DB.Tables.orgDomains), ne(DB.Tables.orgDomains.id, domainId)))
			.run();
		await DB.instance()
			.update(DB.Tables.orgDomains)
			.set({ is_primary: true })
			.where(and(inOrg(DB.Tables.orgDomains), eq(DB.Tables.orgDomains.id, domainId)))
			.run();
	}

	static view(row: DB.Models.OrgDomain): DomainView {
		return {
			id: row.id,
			domain: row.domain,
			verified: row.verified_at !== null,
			verified_at: row.verified_at,
			is_primary: row.is_primary,
			last_checked_at: row.last_checked_at,
			last_check_error: row.last_check_error,
			created_at: row.created_at,
			dns: {
				txt_name: `${AppConstants.DOMAIN_CHALLENGE_PREFIX}.${row.domain}`,
				txt_value: `${AppConstants.DOMAIN_CHALLENGE_VALUE_PREFIX}${row.verification_token}`,
				cname_name: row.domain,
				cname_target: OrgContext.current().default_domain,
			},
		};
	}
}
