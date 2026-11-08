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
				banner: (function () {
					const mappings = {
						CMP_APP_URL: "APP_URL",
						CMP_ENABLE_SIGNUP: "IS_SIGNUP_ENABLED",
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
			appUrl: process.env.CMP_APP_URL || "http://localhost:31316",
			//@ts-ignore
			isSignupEnabled: process.env.CMP_ENABLE_SIGNUP === "true",
		},
	},

	vite: {
		server: {
			allowedHosts: ["cmp-website-test.tun.is-on.net"],
		},
	},

	// The whole portal is behind login and renders client-side.
	routeRules: {
		"/**": { ssr: false },
	},

	app: {
		head: {
			link: [{ rel: "manifest", href: "/manifest.webmanifest" }],
			script: [
				{
					innerHTML: `
					if ('serviceWorker' in navigator) {
					window.addEventListener('load', () => {
						navigator.serviceWorker.register('/sw.js', { scope: '/' })
						.then(registration => {
							console.log('SW registered: ', registration);
						})
						.catch(registrationError => {
							console.log('SW registration failed: ', registrationError);
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
		manifest: {
			name: "Crossover Management Portal",
			short_name: "CMP",
			start_url: "/",
			description: "Crossover Management Portal",

			id: "info.crossover.cmp.app",

			icons: [
				{
					src: "/static/logo/crossover-favicon-512x512.png",
					sizes: "512x512",
					type: "image/png",
				},
				{
					src: "/static/logo/crossover-favicon.png",
					sizes: "1067x1067",
					type: "image/png",
				},
			],

			display: "standalone",
			orientation: "portrait",

			lang: "de",

			theme_color: "#ffffff",
			background_color: "#000000",
		},
		// The API lives under /api on the same origin: never let the service worker answer those
		// requests from its navigation fallback.
		workbox: {
			navigateFallbackDenylist: [/^\/api\//],
		},
	},

	telemetry: false,
});
