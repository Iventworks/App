import { z } from "zod";
import { ORG_PRIMARY_COLORS } from "../../../db/schema";
import type { DomainView } from "../../../orgs/domains";
import type { OrgInfo } from "../../../orgs/registry";

/** Shapes shared by the instance, org settings and system routes. */
export namespace OrgModel {
	export const PrimaryColor = z.enum(ORG_PRIMARY_COLORS);
	export type PrimaryColor = z.infer<typeof PrimaryColor>;

	export const DisplayName = z.string().trim().min(2).max(80);

	export const Org = z.object({
		id: z.number(),
		slug: z.string(),
		display_name: z.string(),
		primary_color: PrimaryColor,
		/** Share links for externals allowed. */
		file_sharing_enabled: z.boolean(),
		/** Expiry suggested for new share links, in days; null = none. */
		share_default_expiry_days: z.number().nullable(),
		/** Base URL for links: the primary custom domain, else the default domain. */
		url: z.string(),
		/** `<slug>.<base host>` (multi-org) or the app's host (single-org). */
		default_domain: z.string(),
		/** Verified custom domain every other host redirects to, or null. */
		primary_domain: z.string().nullable(),
		/** Uploaded logo, or null for the default Iventworks logo. */
		logo_url: z.string().nullable(),
		/** Uploaded icon, or null for the default Iventworks icon. */
		icon_url: z.string().nullable(),
	});
	export type Org = z.infer<typeof Org>;

	/**
	 * `absolute`: asset URLs on the org's own host (the system dashboard lists other orgs);
	 * otherwise relative to the host the request came in on.
	 */
	export function from(org: OrgInfo, options: { absolute?: boolean } = {}): Org {
		const prefix = options.absolute ? org.url : "";
		const asset = (kind: "logo" | "icon") => {
			const info = org[kind];
			return info ? `${prefix}/api/v1/instance/${kind}?v=${info.updated_at}` : null;
		};
		return {
			id: org.id,
			slug: org.slug,
			display_name: org.display_name,
			primary_color: org.primary_color,
			file_sharing_enabled: org.file_sharing_enabled,
			share_default_expiry_days: org.share_default_expiry_days,
			url: org.url,
			default_domain: org.default_domain,
			primary_domain: org.primary_domain,
			logo_url: asset("logo"),
			icon_url: asset("icon"),
		};
	}

	export const Domain = z.object({
		id: z.number(),
		domain: z.string(),
		verified: z.boolean(),
		verified_at: z.number().nullable(),
		/** Approved by a system admin (automatic with self-service or when they added it). */
		approved: z.boolean(),
		approved_at: z.number().nullable(),
		/** Verified and approved: the domain serves the org. */
		active: z.boolean(),
		is_primary: z.boolean(),
		last_checked_at: z.number().nullable(),
		/** Why the last check failed (German), or null. */
		last_check_error: z.string().nullable(),
		created_at: z.number(),
		dns: z.object({
			txt_name: z.string(),
			txt_value: z.string(),
			cname_name: z.string(),
			cname_target: z.string(),
		}),
	});
	export type Domain = z.infer<typeof Domain>;

	export function domain(view: DomainView): Domain {
		return view;
	}

	/** A domain in the system dashboard's list across all orgs. */
	export const SystemDomain = Domain.extend({
		org: z.object({ id: z.number(), slug: z.string(), display_name: z.string() }),
	});
	export type SystemDomain = z.infer<typeof SystemDomain>;

	export const DomainParams = z.object({
		domainId: z.coerce.number().int().positive(),
	});
	export type DomainParams = z.infer<typeof DomainParams>;

	export const AddDomainBody = z.object({
		domain: z.string().trim().min(3).max(253),
	});
	export type AddDomainBody = z.infer<typeof AddDomainBody>;

	export const SetPrimaryBody = z.object({
		is_primary: z.boolean(),
	});
	export type SetPrimaryBody = z.infer<typeof SetPrimaryBody>;

	export const AssetKind = z.enum(["logo", "icon"]);
	export type AssetKind = z.infer<typeof AssetKind>;

	export const AssetParams = z.object({ kind: AssetKind });
	export type AssetParams = z.infer<typeof AssetParams>;

	export const AssetForm = z.object({
		file: z.file().describe("SVG, PNG, WebP or JPEG (logo) / SVG or PNG, square, ≥ 192 px (icon)"),
	});
	export type AssetForm = z.infer<typeof AssetForm>;
}
