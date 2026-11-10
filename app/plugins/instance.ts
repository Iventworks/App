/**
 * Load this host's instance info before the first navigation: the route middleware needs to
 * know whether this is an org, the system dashboard or an unknown host, and the org's colour and
 * icons should be there before anything renders.
 */
import { useInstanceStore } from "~/composables/stores/useInstanceStore";

export default defineNuxtPlugin({
	name: "instance",
	async setup() {
		const store = useInstanceStore();
		await store.refresh();
		const instance = await store.use();

		// Not the org's primary domain: continue there (the server redirects page loads too, but an
		// installed app may start from its service worker cache).
		if (import.meta.client && instance.value?.redirect_to) {
			window.location.replace(
				`${instance.value.redirect_to}${window.location.pathname}${window.location.search}`,
			);
			// Keep the app from rendering while the browser leaves.
			await new Promise(() => {});
		}

		const appConfig = useAppConfig();
		watch(
			() => instance.value?.org?.primary_color,
			(color) => {
				appConfig.ui.colors.primary = color ?? "fuchsia";
			},
			{ immediate: true },
		);

		// Page titles name the org ("Aufgaben | Crossover"); the favicon and manifest links in
		// nuxt.config.ts already point at this host's org.
		const brandName = useBrandName();
		// iOS home-screen label, like the manifest's `short_name`: the product on org hosts.
		const homeScreenName = computed(() =>
			instance.value?.kind === "org" ? instance.value.app_name : brandName.value,
		);
		useHead({
			titleTemplate: (title) =>
				title && title !== brandName.value ? `${title} | ${brandName.value}` : brandName.value,
			meta: [{ key: "apple-title", name: "apple-mobile-web-app-title", content: homeScreenName }],
		});
	},
});
