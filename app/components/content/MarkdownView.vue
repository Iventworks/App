<script setup lang="ts">
/** Read-only rendering of stored markdown (notes, announcements, descriptions). */
const props = defineProps<{
	content: string | null | undefined;
}>();

// UEditor is uncontrolled after mount; key it by content so updates re-render.
const value = computed(() => props.content ?? "");
</script>

<template>
	<FormMarkdownEditor :key="value" :model-value="value" readonly />
</template>
