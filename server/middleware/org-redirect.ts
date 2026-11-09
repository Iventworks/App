import { defineEventHandler, getRequestURL, sendRedirect } from "h3";
import { OrgRegistry } from "../lib/orgs/registry";

/**
 * Page loads on any host of an org with a verified primary custom domain go to that domain
 * (multi-org mode). API requests are answered on every host of the org, so scripts using the
 * default domain keep working.
 */
export default defineEventHandler((event) => {
	if (!OrgRegistry.isLoaded() || !OrgRegistry.isMultiOrg()) return;
	if (event.method !== "GET" && event.method !== "HEAD") return;

	const url = getRequestURL(event);
	if (url.pathname.startsWith("/api/")) return;

	const host = OrgRegistry.requestHost(event.headers, url.toString());
	const target = OrgRegistry.redirectFor(OrgRegistry.resolveHost(host));
	if (!target) return;

	return sendRedirect(event, `${target}${url.pathname}${url.search}`, 302);
});
