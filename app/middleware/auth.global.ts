/**
 * auth.global.ts — session-aware route guard (docs/10-auth.md). Login-only app: everything
 * outside `/auth/*` needs a valid session.
 *
 * Route map:
 * - `/auth/*`            signed-out pages (login, forgot/reset password, accept invitation);
 *                        a valid session is sent on to `HOME_ROUTE`.
 * - `PENDING_ROUTE`      shown to `unverified` accounts, which may otherwise only open `/settings/*`.
 * - `/core-team/*`       role ≥ core_team, otherwise → `HOME_ROUTE`.
 * - `/admin/*`           role = admin, otherwise → `HOME_ROUTE`.
 * - everything else      any activated account (role ≥ volunteer). Event pages additionally check
 *                        the caller's event access via the API (`useCurrentEvent`).
 *
 * Hosts (multi-org mode, see `useInstance`):
 * - unknown host        nothing to guard: `app.vue` shows "no organisation here".
 * - system host         the base domain: `/` shows the same notice with a link to `/admin`, the
 *                       system admin dashboard (`/admin/*`, `/settings/*`, `/auth/*` only).
 * - org host            everything above; the system pages (`/admin/orgs`) are not there.
 *
 * These gates are UX only; the API enforces every permission itself.
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";

const HOME_ROUTE = "/";
const SYSTEM_HOME_ROUTE = "/admin";
const SYSTEM_PREFIXES = ["/auth", "/settings", "/admin"];
const SYSTEM_ONLY_PREFIXES = ["/admin/orgs", "/admin/domains"];
/** Share links (`/s/<token>`): no account needed, the token decides (org hosts only). */
const PUBLIC_PREFIXES = ["/s"];
const PENDING_ROUTE = "/pending";
const ALWAYS_ALLOWED_FOR_UNVERIFIED = ["/settings", PENDING_ROUTE];
const CORE_TEAM_PREFIXES = ["/core-team"];
const ADMIN_PREFIXES = ["/admin"];

function hasPrefix(path: string, prefixes: string[]) {
	return prefixes.some(
		(prefix) => prefix === "/" || path === prefix || path.startsWith(`${prefix}/`),
	);
}

export default defineNuxtRouteMiddleware(async (to) => {
	const kind = useInstance().value?.kind ?? "unknown";
	if (kind === "unknown") return;
	if (kind === "system") {
		if (to.path === "/") return;
		if (!hasPrefix(to.path, SYSTEM_PREFIXES)) return navigateTo(SYSTEM_HOME_ROUTE);
	} else if (hasPrefix(to.path, SYSTEM_ONLY_PREFIXES)) {
		return navigateTo(HOME_ROUTE);
	} else if (hasPrefix(to.path, PUBLIC_PREFIXES)) {
		return;
	}
	const home = kind === "system" ? SYSTEM_HOME_ROUTE : HOME_ROUTE;

	const sessionToken = useAppCookies().sessionToken;
	const token = sessionToken.get().value;
	const store = useUserInfoStore();

	if (hasPrefix(to.path, ["/auth"])) {
		if (!token) return;
		if (store.isValid(await store.use())) return navigateTo(home);

		// Token exists but is invalid or expired: clear it and stay on the auth page.
		sessionToken.set(null);
		return;
	}

	const loginRoute = `/auth/login?url=${encodeURIComponent(to.fullPath)}`;
	if (!token) return navigateTo(loginRoute);

	// Validates the session against the API (GET /account) — a revoked or expired token lands here.
	const user = await store.use();
	if (!store.isValid(user)) {
		sessionToken.set(null);
		return navigateTo(loginRoute);
	}

	const role = user.value.role;

	if (!hasOrgRole(role, "volunteer")) {
		if (!hasPrefix(to.path, ALWAYS_ALLOWED_FOR_UNVERIFIED)) return navigateTo(PENDING_ROUTE);
		return;
	}

	if (to.path === PENDING_ROUTE) return navigateTo(home);

	if (hasPrefix(to.path, ADMIN_PREFIXES) && !hasOrgRole(role, "admin")) {
		return navigateTo(home);
	}

	if (hasPrefix(to.path, CORE_TEAM_PREFIXES) && !hasOrgRole(role, "core_team")) {
		return navigateTo(home);
	}
});
