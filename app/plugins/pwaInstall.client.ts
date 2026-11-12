/**
 * Catch the browser's one-time `beforeinstallprompt` event at startup so the
 * "App installieren" page can offer a one-click install later. See `usePwaInstall`.
 *
 * Chrome fires the event once per page load, and nothing replays it for a late listener. So this
 * runs first: before Nuxt's own plugins (payload -30, router -20, which waits for the page chunk)
 * and the `instance` plugin (waits for `/api/v1/instance`). Registered any later, Chrome could fire
 * the event during one of those requests and the install button would never appear.
 */
export default defineNuxtPlugin({
	name: "pwa-install",
	order: -40,
	setup() {
		registerPwaInstallListeners();
	},
});
