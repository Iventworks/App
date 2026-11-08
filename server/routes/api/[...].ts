import {
	defineEventHandler,
	getMethod,
	getRequestIP,
	getRequestURL,
	type H3Event,
	readRawBody,
	setResponseStatus,
} from "h3";
import { Hono } from "hono";
import { API } from "../../lib/api";
import type { APIBindings } from "../../lib/api/utils/clientInfo";
import { ConfigHandler } from "../../lib/utils/config";

// Catch-all: forward every /api/** request to the Hono app (mounted at /api).
// Hono then handles /api/v1/**, /api/health, /api/docs/v1. See docs/04-backend-hono.md.
let wrapper: Hono | null = null;

// Only cache the wrapper once `API.getApp()` succeeds. A request that arrives while
// `server/plugins/startup.ts` is still running `API.init()` must not cache an empty router.
function getWrapper(): Hono | null {
	if (wrapper) return wrapper;
	try {
		const app = new Hono();
		app.route("/api", API.getApp());
		wrapper = app;
		return wrapper;
	} catch {
		return null;
	}
}

/**
 * The socket address, or — with `CMP_TRUST_PROXY=true` — the LAST `X-Forwarded-For` entry: the
 * address our (single) reverse proxy saw. Earlier entries are client-controlled and spoofable.
 */
function getClientIP(event: H3Event): string | null {
	if (ConfigHandler.getConfig()?.TRUST_PROXY === true) {
		const forwarded = event.headers.get("x-forwarded-for");
		const last = forwarded?.split(",").at(-1)?.trim();
		if (last) return last;
	}
	return getRequestIP(event) ?? null;
}

export default defineEventHandler(async (event) => {
	const app = getWrapper();
	if (!app) {
		setResponseStatus(event, 503);
		return {
			success: false,
			code: 503,
			message: "API is starting, please retry shortly",
		};
	}

	const url = getRequestURL(event);
	const method = getMethod(event);

	const request = new Request(url, {
		method,
		headers: event.headers,
		// Raw bytes (not a string): multipart uploads must reach Hono unchanged.
		body:
			method !== "GET" && method !== "HEAD"
				? ((await readRawBody(event, false)) as BodyInit | undefined)
				: undefined,
	});

	// Hono never sees the socket behind Nitro; hand it the client IP for rate limiting.
	const bindings: APIBindings = { clientIP: getClientIP(event) };

	return app.fetch(request, bindings);
});
