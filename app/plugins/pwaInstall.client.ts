/**
 * Catch the browser's one-time `beforeinstallprompt` event at startup so the
 * "App installieren" page can offer a one-click install later. See `usePwaInstall`.
 */
export default defineNuxtPlugin(() => {
	registerPwaInstallListeners();
});
