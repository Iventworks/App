import { createMiddleware } from "hono/factory";
import { OrgContext } from "../../../../orgs/context";
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

export const authMiddlewareV1 = createMiddleware(async (c, next) => {
	const authHeader = c.req.header("Authorization");

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
