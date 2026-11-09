import { z } from "zod";
import { OrgModel } from "../../../../utils/shared-models/orgData";

export namespace InstanceModel {
	/** Default Iventworks assets in `public/static/brand/`, used while an org has none uploaded. */
	export const DEFAULT_ASSETS = {
		logo: "/static/brand/logo-on-dark.svg",
		icon: "/static/brand/icon.svg",
		favicon: "/static/brand/favicon.svg",
		appleTouchIcon: "/static/brand/apple-touch-icon.png",
		manifestIcons: [
			{
				src: "/static/brand/android-chrome-192x192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/static/brand/android-chrome-512x512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/static/brand/maskable-icon-512x512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	} as const;

	export namespace Get {
		export const Response = z.object({
			/** The product name ("Iventworks"). */
			app_name: z.string(),
			multi_org: z.boolean(),
			/**
			 * `org`: an org's dashboard. `system`: the multi-org base domain (system admin dashboard
			 * under `/admin`). `unknown`: no org is registered for this host.
			 */
			kind: z.enum(["org", "system", "unknown"]),
			/** The base URL (APP_URL); the system admin dashboard is `<base_url>/admin`. */
			base_url: z.string(),
			/** The org of this host; null on the system and unknown hosts. */
			org: OrgModel.Org.nullable(),
			/** Set when this host isn't the org's primary domain: the app should reload there. */
			redirect_to: z.string().nullable(),
		});
		export type Response = z.infer<typeof Response>;
	}

	export namespace TlsCheck {
		export const Query = z.object({
			domain: z.string().min(1).max(253),
		});
		export type Query = z.infer<typeof Query>;
	}
}
