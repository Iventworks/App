import { Hono } from "hono";
import { OrgContext } from "../../../../../orgs/context";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";

/**
 * The system API (multi-org mode): managing orgs. Only reachable on the base domain (the org
 * middleware returns 404 everywhere else) and only for the system admins — the users of the
 * system org, who sign in there.
 */
export const router = new Hono().basePath("/system");

router.use("*", async (c, next) => {
	const authContext = AuthHandler.AuthContext.get(c);
	if (authContext.type === "unauthenticated") {
		return APIResponse.unauthorized(c, "Authentication required");
	}
	if (OrgContext.current().kind !== "system" || authContext.user_role !== "admin") {
		return APIResponse.forbidden(c, "This endpoint is restricted to system administrators");
	}
	await next();
});

router.route("/", (await import("./orgs")).router);
