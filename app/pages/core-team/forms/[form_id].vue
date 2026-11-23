<script setup lang="ts">
/** One of the Kernteam's forms or a template, with the tabs Fragen / Einstellungen / Antworten. */
definePageMeta({ layout: "dashboard", key: (route) => String(route.params.form_id) });

const route = useRoute();

const detail = await createFormDetail({
	formId: Number(route.params.form_id),
	listPath: "/core-team/forms",
	canManageTemplates: true,
});
if (typeof detail === "number") {
	throw createError({ statusCode: 404, statusMessage: "Formular nicht gefunden", fatal: true });
}
// Events' forms open in their event.
if (detail.form.value.scope === "event") {
	await navigateTo(`/events/${detail.form.value.event_id}/forms/${detail.formId}`, {
		replace: true,
	});
}
provideFormDetail(detail);
</script>

<template>
	<FormsDetailPanel list-label="Formulare" place="Kernteam" />
</template>
