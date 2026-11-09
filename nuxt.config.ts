// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: "2026-09-01",
	devtools: { enabled: true },
	modules: ["@nuxt/ui", "@vite-pwa/nuxt"],

	colorMode: {
		preference: "dark",
		fallback: "dark",
		classSuffix: "",
	},

	ssr: true,

	css: ["~/assets/css/main.css"],

	nitro: {
		rollupConfig: {
			external: ["bun:sqlite"],

			output: {
				banner: (() => {
					// The first one set wins (CMP_* is the name before the rename to Iventworks).
					const mappings = {
						IVENTWORKS_APP_URL: "APP_URL",
						CMP_APP_URL: "APP_URL",
					};

					const bannerCode = `
						(function () {
							const mappings = ${JSON.stringify(mappings)};
							const env = globalThis.process?.env ?? {};
							for (const [envName, runtimeName] of Object.entries(mappings)) {
								if (!env['NUXT_PUBLIC_' + runtimeName] && env[envName]) {
									env['NUXT_PUBLIC_' + runtimeName] = env[envName];
								}
							}
						})();
					`;

					return bannerCode.replace(/^\s+|\s+$/g, "").replace(/\n\s*/g, " ");
				})(),
			},
		},

		esbuild: {
			options: {
				target: "esnext",
			},
		},
	},

	runtimeConfig: {
		public: {
			//@ts-ignore
			appUrl: process.env.IVENTWORKS_APP_URL || process.env.CMP_APP_URL || "http://localhost:31316",
		},
	},

	// The whole portal is behind login and renders client-side.
	routeRules: {
		"/**": { ssr: false },
	},

	app: {
		head: {
			htmlAttrs: { lang: "de" },
			title: "Iventworks",
			meta: [{ name: "theme-color", content: "#020617" }],
			// Per host: every org has its own name, icons and installable app (served by the API
			// from the org of the request's host, see routes/instance). The instance plugin swaps the
			// favicon for the org's icon once it knows it.
			link: [
				{ rel: "manifest", href: "/api/v1/instance/manifest.webmanifest" },
				{ rel: "icon", href: "/api/v1/instance/favicon" },
				// iOS home-screen icon (Safari ignores the manifest icons).
				{ rel: "apple-touch-icon", href: "/api/v1/instance/apple-touch-icon" },
			],
			script: [
				{
					innerHTML: `
					if ('serviceWorker' in navigator) {
					window.addEventListener('load', () => {
						navigator.serviceWorker.register('/sw.js', { scope: '/' })
						.catch(registrationError => {
							console.error('Service worker registration failed:', registrationError);
						});
					});
					}
				`,
					type: "text/javascript",
				},
			],
		},
	},

	pwa: {
		registerType: "autoUpdate",
		injectRegister: false,
		// The manifest depends on the host's org: `/api/v1/instance/manifest.webmanifest`.
		manifest: false,
		// The API lives under /api on the same origin: never let the service worker answer those
		// requests from its navigation fallback.
		workbox: {
			navigateFallbackDenylist: [/^\/api\//],
		},
	},

	telemetry: false,
});
