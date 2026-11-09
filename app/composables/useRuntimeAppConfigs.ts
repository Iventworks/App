/**
 * useRuntimeAppConfigs — typed access to publicRuntimeConfig.
 *
 * The template exposes `apiUrl` and `appUrl` from `nuxt.config.ts` under `publicRuntimeConfig`.
 * This composable wraps them with safe fallbacks for SSR and client.
 * See docs/05-api-contract.md and docs/07-state-and-data.md.
 */
/**
 * Origin of the API for this browser tab: the page's own origin. Every org host serves the API
 * under `/api` (multi-org mode: the org comes from the host), so `appUrl` — the base URL — is
 * only the fallback outside the browser.
 */
export function useAPIOrigin() {
	if (import.meta.client) return window.location.origin;
	return useRuntimeAppConfigs().appUrl.replace(/\/$/, "");
}

export function useRuntimeAppConfigs() {
	const config = useRuntimeConfig();
	return {
		apiUrl: (config.public.apiUrl as string | undefined) ?? "",
		appUrl: (config.public.appUrl as string | undefined) ?? "",
	} as const;
}
