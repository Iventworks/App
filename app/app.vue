<script setup lang="ts">
import { de } from "@nuxt/ui/locale";

// German for Nuxt UI's built-in texts (close buttons, empty states) and for calendars/date fields
// (month and weekday names, date order).
const locale = de;
</script>

<template>
	<NuxtRouteAnnouncer />
	<UApp :locale="locale" :toaster="{ position: 'bottom-right' }">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>
