<script setup lang="ts">
/** Year filter for org-wide reports; `null` = all years. */
const year = defineModel<number | null>({ default: null });

const currentYear = new Date().getFullYear();
const options = [
	{ label: "Alle Jahre", value: null },
	...Array.from({ length: 7 }, (_, index) => currentYear + 1 - index).map((value) => ({
		label: String(value),
		value,
	})),
];
</script>

<template>
	<USelect v-model="year" :items="options" value-key="value" icon="i-lucide-calendar" class="w-36" />
</template>
