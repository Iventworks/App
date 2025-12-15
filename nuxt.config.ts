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

	ssr: true,

	css: [
		'~/assets/css/main.css',
	],

	nitro: {
		preset: 'bun'
	},

	runtimeConfig: {
		public: {
			apiUrl: process.env.CMP_API_URL || 'https://localhost:12151',
		}
	},

	vite: {
		server: {
			allowedHosts: [
				"cmp-website-test.tun.is-on.net"
			]

		}
	}
});