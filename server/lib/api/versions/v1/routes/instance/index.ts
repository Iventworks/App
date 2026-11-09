import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { OrgBranding } from "../../../../../orgs/branding";
import { OrgRegistry } from "../../../../../orgs/registry";
import { AppConstants } from "../../../../../utils/constants";
import { APIResponse } from "../../../../utils/api-res";
import { OrgModel } from "../../../../utils/shared-models/orgData";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { HostContext } from "../../middleware/org";
import { InstanceModel } from "./model";

/**
 * Public, host-dependent information the app needs before anyone signs in: which org this host
 * belongs to, its branding, its icons and web app manifest. Reachable on every host, also on
 * unknown ones (so the app can say "no organisation here").
 */
export const router = new Hono().basePath("/instance");

/** Org assets: the bytes from the DB, or a redirect to the default Iventworks file. */
async function serveAsset(c: Context, kind: "logo" | "icon", fallback: string, pngOnly = false) {
	const resolution = HostContext.get(c);
	const info = resolution.kind === "unknown" ? null : resolution.org[kind];
	if (!info || (pngOnly && info.mime_type !== "image/png")) {
		return c.redirect(fallback, 302);
	}

	const etag = `"${kind}-${info.updated_at}"`;
	const headers: Record<string, string> = {
		"Content-Type": info.mime_type,
		"Cache-Control": c.req.query("v") ? "public, max-age=31536000, immutable" : "public, max-age=300",
		ETag: etag,
		"X-Content-Type-Options": "nosniff",
		// An SVG opened directly must never run script on the app's origin.
		"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
	};
	if (c.req.header("if-none-match") === etag) {
		return new Response(null, { status: 304, headers });
	}

	const asset = await OrgBranding.get(kind);
	if (!asset) return c.redirect(fallback, 302);
	return new Response(new Uint8Array(asset.data), { status: 200, headers });
}

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Get instance info",
		description:
			"Which org this host belongs to (`X-Iventworks-Host` > `X-Forwarded-Host` > `Host`) and its branding. Public.",
		tags: [DOCS_TAGS.INSTANCE],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Instance info retrieved successfully", InstanceModel.Get.Response),
		),
	}),

	async (c) => {
		const resolution = HostContext.get(c);
		const redirect = OrgRegistry.redirectFor(resolution);

		return APIResponse.success(c, "Instance info retrieved successfully", {
			app_name: AppConstants.APP_NAME,
			multi_org: OrgRegistry.isMultiOrg(),
			kind: resolution.kind,
			base_url: OrgRegistry.appUrl(),
			org: resolution.kind === "org" ? OrgModel.from(resolution.org) : null,
			redirect_to: redirect,
		} satisfies InstanceModel.Get.Response);
	},
);

router.get(
	"/logo",
	APIRouteSpec.unauthenticated({
		summary: "Get org logo",
		description: "The org's logo, or a redirect to the default Iventworks logo.",
		tags: [DOCS_TAGS.INSTANCE],
		responses: { 200: { description: "The image" }, 302: { description: "Default logo" } },
	}),
	(c) => serveAsset(c, "logo", InstanceModel.DEFAULT_ASSETS.logo),
);

router.get(
	"/icon",
	APIRouteSpec.unauthenticated({
		summary: "Get org icon",
		description: "The org's square icon, or a redirect to the default Iventworks icon.",
		tags: [DOCS_TAGS.INSTANCE],
		responses: { 200: { description: "The image" }, 302: { description: "Default icon" } },
	}),
	(c) => serveAsset(c, "icon", InstanceModel.DEFAULT_ASSETS.icon),
);

router.get(
	"/favicon",
	APIRouteSpec.unauthenticated({
		summary: "Get favicon",
		description: "The org's icon, or a redirect to the default Iventworks favicon.",
		tags: [DOCS_TAGS.INSTANCE],
		responses: { 200: { description: "The image" }, 302: { description: "Default favicon" } },
	}),
	(c) => serveAsset(c, "icon", InstanceModel.DEFAULT_ASSETS.favicon),
);

router.get(
	"/apple-touch-icon",
	APIRouteSpec.unauthenticated({
		summary: "Get home-screen icon (iOS)",
		description: "The org's icon when it is a PNG (iOS needs one), else the default.",
		tags: [DOCS_TAGS.INSTANCE],
		responses: { 200: { description: "The image" }, 302: { description: "Default icon" } },
	}),
	(c) => serveAsset(c, "icon", InstanceModel.DEFAULT_ASSETS.appleTouchIcon, true),
);

router.get(
	"/manifest.webmanifest",
	APIRouteSpec.unauthenticated({
		summary: "Get web app manifest",
		description: "The installable app of this host's org: its name and icons.",
		tags: [DOCS_TAGS.INSTANCE],
		responses: { 200: { description: "The manifest (application/manifest+json)" } },
	}),
	(c) => {
		const resolution = HostContext.get(c);
		const org = resolution.kind === "org" ? resolution.org : null;
		const name =
			resolution.kind === "system"
				? `${AppConstants.APP_NAME} System`
				: (org?.display_name ?? AppConstants.APP_NAME);

		const icon = org?.icon;
		const icons = icon
			? [
					{
						src: `/api/v1/instance/icon?v=${icon.updated_at}`,
						sizes: icon.size_px ? `${icon.size_px}x${icon.size_px}` : "any",
						type: icon.mime_type,
						purpose: "any",
					},
				]
			: InstanceModel.DEFAULT_ASSETS.manifestIcons;

		const manifest = {
			// Each org host is its own origin, so each org installs as its own app.
			id: "/",
			name,
			short_name: name.length > 30 ? `${name.slice(0, 29)}…` : name,
			description: org ? `${org.display_name} auf ${AppConstants.APP_NAME}` : AppConstants.APP_NAME,
			start_url: "/",
			scope: "/",
			display: "standalone",
			// Not locked: the week schedule and tables need landscape on tablets and desktops.
			orientation: "any",
			lang: "de",
			theme_color: "#020617",
			background_color: "#020617",
			icons,
		};

		return c.body(JSON.stringify(manifest), 200, {
			"Content-Type": "application/manifest+json",
			"Cache-Control": "public, max-age=300",
		});
	},
);

router.get(
	"/tls-check",
	APIRouteSpec.unauthenticated({
		summary: "Check a host for TLS",
		description:
			"200 when a certificate may be issued for `domain` (the base host, an org's default domain or a verified custom domain), 404 otherwise. Meant for on-demand TLS in the reverse proxy (Caddy `ask`).",
		tags: [DOCS_TAGS.INSTANCE],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Host is served"),
			APIResponseSpec.notFound("Host is not served"),
		),
	}),
	zValidator("query", InstanceModel.TlsCheck.Query),
	(c) => {
		const { domain } = c.req.valid("query") as InstanceModel.TlsCheck.Query;
		const resolution = OrgRegistry.resolveHost(domain);
		if (resolution.kind === "unknown") return APIResponse.notFound(c, "Host is not served");
		return APIResponse.successNoData(c, "Host is served");
	},
);
