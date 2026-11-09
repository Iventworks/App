<script setup lang="ts">
import { de } from "@nuxt/ui/locale";

// German for Nuxt UI's built-in texts (close buttons, empty states) and for calendars/date fields
// (month and weekday names, date order).
const locale = de;

// No org on this host (unknown host, or `/` of the multi-org base domain): a notice instead of
// the app. The system admin dashboard on the base domain lives under `/admin`.
// `currentRoute`, not `useRoute()`: the latter only follows navigations while <NuxtPage> renders.
const currentRoute = useRouter().currentRoute;
const instance = useInstance();
const showNotice = computed(
	() =>
		!instance.value ||
		instance.value.kind === "unknown" ||
		(instance.value.kind === "system" && currentRoute.value.path === "/"),
);
</script>

<template>
	<NuxtRouteAnnouncer />
	<UApp :locale="locale" :toaster="{ position: 'bottom-right' }">
		<InstanceNotice v-if="showNotice" />
		<NuxtLayout v-else>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>
