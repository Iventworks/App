/**
 * Load icons from our own server (`/api/_nuxt_icon`, the installed Lucide collection), never from
 * api.iconify.design. @nuxt/icon 2.6 only replaces Iconify's default API when that default lists
 * one server, but @iconify/vue 5 lists two — so the browser fetched every icon from Iconify (and
 * the Content-Security-Policy, rightly, refuses that).
 */
import { addAPIProvider } from "@iconify/vue";

export default defineNuxtPlugin({
	name: "icon-provider",
	enforce: "pre",
	setup() {
		addAPIProvider("", { resources: ["/api/_nuxt_icon"] });
	},
});
