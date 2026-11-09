/**
 * Register the PWA service worker (`@vite-pwa/nuxt` builds `/sw.js`; `injectRegister: false`).
 * A plugin instead of an inline script, so the Content-Security-Policy needs no extra hash.
 */
export default defineNuxtPlugin(() => {
	if (import.meta.dev || !("serviceWorker" in navigator)) return;
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
			console.error("Service worker registration failed:", error);
		});
	});
});
