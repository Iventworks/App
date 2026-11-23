<script setup lang="ts">
/**
 * One of the event's forms, with the tabs Fragen / Einstellungen / Antworten — for the team, or
 * only the Leitung when it keeps the form for itself (`leaders_only`).
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({ layout: "dashboard", key: (route) => String(route.params.form_id) });

const route = useRoute();
const { event, eventId, can } = await useCurrentEvent();
const user = await useUserInfoStore().use();

if (!can("forms:view")) {
	throw createError({
		statusCode: 403,
		statusMessage: "Du siehst die Formulare dieses Events nicht.",
		fatal: true,
	});
}

const detail = await createFormDetail({
	formId: Number(route.params.form_id),
	listPath: `/events/${eventId.value}/forms`,
	canManageTemplates: hasOrgRole(user.value?.role, "core_team"),
});
if (detail === 403) {
	throw createError({
		statusCode: 403,
		statusMessage: "Dieses Formular ist nur für die Leitung.",
		fatal: true,
	});
}
if (typeof detail === "number" || detail.form.value.event_id !== eventId.value) {
	throw createError({ statusCode: 404, statusMessage: "Formular nicht gefunden", fatal: true });
}
provideFormDetail(detail);
</script>

<template>
	<FormsDetailPanel list-label="Formulare" :place="event.name" />
</template>
