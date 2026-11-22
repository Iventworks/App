<script setup lang="ts">
/** "Antworten": statistics, single answers, filters and the CSV export (not for templates). */
definePageMeta({ layout: "dashboard" });

const { isTemplate, basePath } = useFormDetail();
if (isTemplate.value) await navigateTo(basePath, { replace: true });
</script>

<template>
	<FormsResponsesView v-if="!isTemplate" />
</template>
