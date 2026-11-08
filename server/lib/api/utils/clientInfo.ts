import type { Context } from "hono";

/**
 * Values the Nitro bridge (`server/routes/api/[...].ts`) passes to `app.fetch(request, env)`.
 * Tests call `API.getApp().request()` without bindings, so every field is optional.
 */
export interface APIBindings {
	clientIP?: string | null;
}

/** Best-effort client IP for rate limiting; `"unknown"` when the bridge did not provide one. */
export function getClientIP(c: Context): string {
	const env = c.env as APIBindings | undefined;
	if (env?.clientIP) return env.clientIP;

	// Direct Bun.serve (API.start) exposes the socket address on the request.
	const remote = (c.req.raw as any)?.remoteAddr?.hostname;
	return typeof remote === "string" && remote ? remote : "unknown";
}
