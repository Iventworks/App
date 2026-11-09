import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { OrgContext } from "../../../../orgs/context";
import { AppConstants } from "../../../../utils/constants";
import { APIResponse } from "../../../utils/api-res";
import { AuthHandler } from "../../../utils/authHandler";

// Endpoints that stay reachable with a malformed, invalid or expired token (login, accepting an
// invitation, password reset), so a stale session cookie can never lock a user out of signing in.
const PUBLIC_AUTH_PATHS = ["/v1/auth/login", "/v1/auth/invitations", "/v1/auth/reset-password"];

// `c.req.path` is the full request path. Compare from `/v1/` on, so this also works when the
// API is mounted under a prefix (the full-stack template serves it at `/api/v1/...`).
function isPublicAuthPath(fullPath: string) {
	const path = fullPath.slice(Math.max(fullPath.indexOf("/v1/"), 0));
	return PUBLIC_AUTH_PATHS.some((publicPath) => path.startsWith(publicPath));
}

// The one place the browser's session cookie counts as authentication: reading a file's contents,
// so `<img src>`, links and new tabs work without the `Authorization` header (read-only, and the
// cookie is SameSite=Lax, so other sites can't use it). Everything else needs the header.
const COOKIE_AUTH_PATH = /\/v1\/files\/\d+\/content(?:\/[^/]*)?$/;
const SESSION_COOKIE = `${AppConstants.APP_KEYS_PREFIX}_session_token`;

function cookieAuthHeader(c: Context): string | undefined {
	if (c.req.method !== "GET" && c.req.method !== "HEAD") return undefined;
	if (!COOKIE_AUTH_PATH.test(c.req.path)) return undefined;
	const token = getCookie(c, SESSION_COOKIE);
	return token ? `Bearer ${token}` : undefined;
}

export const authMiddlewareV1 = createMiddleware(async (c, next) => {
	const authHeader = c.req.header("Authorization") ?? cookieAuthHeader(c);

	// Unknown host (only the public instance info is reachable): no org to look a token up in.
	if (!authHeader || !OrgContext.maybeCurrent()) {
		AuthHandler.AuthContext.set(c, {
			type: "unauthenticated",
		} satisfies AuthHandler.UnauthenticatedAuthContext);

		return await next();
	}

	if (!authHeader.startsWith("Bearer ")) {
		if (isPublicAuthPath(c.req.path)) {
			AuthHandler.AuthContext.set(c, {
				type: "unauthenticated",
			} satisfies AuthHandler.UnauthenticatedAuthContext);

			return await next();
		}

		return APIResponse.unauthorized(c, "Invalid Authorization header");
	}

	const token = authHeader.substring("Bearer ".length);

	const authContext = await AuthHandler.getAuthContext(token);

	if (!authContext || !(await AuthHandler.isValidAuthContext(authContext))) {
		if (isPublicAuthPath(c.req.path)) {
			AuthHandler.AuthContext.set(c, {
				type: "unauthenticated",
			} satisfies AuthHandler.UnauthenticatedAuthContext);

			return await next();
		}

		return APIResponse.unauthorized(c, "Invalid or expired token");
	}

	AuthHandler.AuthContext.set(c, authContext);

	return await next();
});
