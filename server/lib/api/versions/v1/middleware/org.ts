import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { OrgContext } from "../../../../orgs/context";
import { type HostResolution, OrgRegistry } from "../../../../orgs/registry";
import { APIResponse } from "../../../utils/api-res";

// What each kind of host may reach (paths from `/v1/` on).
// - unknown host: only the public instance info (so the frontend can show "not found").
// - system host (multi-org base domain): the system API plus what the system admins' own org
//   needs — sign-in, their account, managing system admins and the system audit log.
// - org host: everything except the system API.
const INSTANCE_PATHS = ["/v1/instance"];
const SYSTEM_HOST_PATHS = [
	...INSTANCE_PATHS,
	"/v1/system",
	"/v1/auth",
	"/v1/account",
	"/v1/admin/users",
	"/v1/admin/invitations",
	"/v1/admin/audit-log",
];

function v1Path(fullPath: string) {
	return fullPath.slice(Math.max(fullPath.indexOf("/v1/"), 0));
}

function matches(path: string, prefixes: string[]) {
	return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isAllowed(resolution: HostResolution, path: string) {
	switch (resolution.kind) {
		case "unknown":
			return matches(path, INSTANCE_PATHS);
		case "system":
			return matches(path, SYSTEM_HOST_PATHS);
		case "org":
			return !matches(path, ["/v1/system"]);
	}
}

/**
 * Resolves the org from the request host (`X-Iventworks-Host` > `X-Forwarded-Host` > `Host`) and
 * runs the rest of the request inside {@link OrgContext.run}. Runs before the auth middleware:
 * tokens are only looked up within the resolved org, so a token never works on another org's host.
 */
export const orgMiddlewareV1 = createMiddleware(async (c, next) => {
	const resolution = OrgRegistry.resolveHost(OrgRegistry.requestHost(c.req.raw.headers, c.req.url));
	HostContext.set(c, resolution);

	if (!isAllowed(resolution, v1Path(c.req.path))) {
		return APIResponse.notFound(
			c,
			resolution.kind === "unknown"
				? "No organisation is registered for this host"
				: "This endpoint is not available on this host",
		);
	}

	return OrgContext.run(resolution.kind === "unknown" ? null : resolution.org, () => next());
});

export namespace HostContext {
	export function get(c: Context): HostResolution {
		// @ts-ignore
		const resolution = c.get("hostResolution") as HostResolution | undefined;
		if (!resolution) throw new Error("Host resolution not set in context");
		return resolution;
	}

	export function set(c: Context, resolution: HostResolution) {
		// @ts-ignore
		c.set("hostResolution", resolution);
	}
}
