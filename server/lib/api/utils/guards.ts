import { createMiddleware } from "hono/factory";
import { APIResponse } from "./api-res";
import { AuthHandler } from "./authHandler";
import { PermissionHelper } from "./permissions";
import type { UserAccountSettings } from "./shared-models/accountData";

/**
 * Coarse router guard: rejects unauthenticated callers (401) and callers below `minimum` (403).
 * Fine-grained checks stay in the handlers (`PermissionHelper.can` / `canInEvent`).
 */
export function requireOrgRole(minimum: UserAccountSettings.Role) {
	return createMiddleware(async (c, next) => {
		const authContext = AuthHandler.AuthContext.get(c);

		if (authContext.type === "unauthenticated") {
			return APIResponse.unauthorized(c, "Authentication required");
		}

		if (!PermissionHelper.hasOrgRole(authContext.user_role, minimum)) {
			return APIResponse.forbidden(
				c,
				minimum === "volunteer"
					? "Your account has not been activated yet"
					: "You do not have permission to access this resource",
			);
		}

		await next();
	});
}

/** The authenticated caller's user id. Only call behind `requireOrgRole` (or another auth guard). */
export function getAuthUserId(c: Parameters<typeof AuthHandler.AuthContext.get>[0]) {
	const authContext = AuthHandler.AuthContext.get(c);
	if (authContext.type === "unauthenticated") {
		throw new Error("getAuthUserId called without an authenticated context");
	}
	return authContext.user_id;
}
