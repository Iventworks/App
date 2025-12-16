// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: '2025-07-15',
	devtools: { enabled: true },
	modules: ['@nuxt/ui'],

	colorMode: {
		preference: 'dark',
		fallback: 'dark',
		classSuffix: ''
	},

	ssr: false,

	css: [
		'~/assets/css/main.css',
	],

	nitro: {
		preset: 'bun',

		devProxy: process.env.USE_DEV_PROXY === "true" ? {
			"/api/proxy": {
				target: process.env.DEV_PROXY_TARGET || "https://api.crossover.is-on.net",
				changeOrigin: true
			}
		} : {}
	},

	runtimeConfig: {
		public: {
			apiUrl: process.env.CMP_API_URL || 'http://localhost:31317',
			isSignupEnabled: process.env.CMP_ENABLE_SIGNUP === 'true' ? true : false,
		},
	},

	vite: {
		server: {
			allowedHosts: [
				"cmp-website-test.tun.is-on.net"
			]

		}
	}
});