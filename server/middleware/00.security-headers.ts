import { defineEventHandler, getRequestURL, setResponseHeader, setResponseHeaders } from "h3";
import { ConfigHandler } from "../lib/utils/config";
import { SecurityHeaders } from "../lib/utils/securityHeaders";

/**
 * Security headers on every response. Pages get their Content-Security-Policy from
 * `server/plugins/csp.ts` (it needs the page's inline scripts); API responses get a policy that
 * allows nothing — endpoints that serve files or images replace it with their own.
 */
export default defineEventHandler((event) => {
	const https = (ConfigHandler.getConfig()?.APP_URL ?? "").startsWith("https://");
	setResponseHeaders(event, SecurityHeaders.base(https));

	const path = getRequestURL(event).pathname;
	// The interactive API docs (Scalar) load their UI from a CDN.
	if (path.startsWith("/api/") && !path.startsWith("/api/docs")) {
		setResponseHeader(event, "Content-Security-Policy", SecurityHeaders.API_CSP);
	}
});
