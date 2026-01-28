// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	compatibilityDate: '2025-07-15',
	devtools: { enabled: true },
	modules: ['@nuxt/ui', '@vite-pwa/nuxt'],

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
			appUrl: process.env.CMP_APP_URL || 'http://localhost:31316',
			isSignupEnabled: process.env.CMP_ENABLE_SIGNUP === 'true' ? true : false,
		},
	},

	vite: {
		server: {
			allowedHosts: [
				"cmp-website-test.tun.is-on.net"
			]

		}
	},

	routeRules: {
		"/**": { ssr: false }
	},

	app: {
		head: {
			// 1. Manually add the manifest link
			link: [
				{ rel: 'manifest', href: '/manifest.webmanifest' }, 
			]
		}
	},

	pwa: {
        registerType: 'autoUpdate',
        manifest: {
            name: 'Crossover Management Portal',
            short_name: 'CMP',
            start_url: '/',
            description: 'Crossover Management Portal',

            display: 'standalone',
            orientation: 'portrait',

            theme_color: '#ffffff',
            background_color: '#18181a',
        }
    }
});