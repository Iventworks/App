<script setup lang="ts">
/** Deep link `/messages/<conversationId>` → the messaging page with that chat open. */
definePageMeta({
	layout: "dashboard",
	middleware: (to) => {
		const raw = Array.isArray(to.params.conversation_id)
			? to.params.conversation_id[0]
			: to.params.conversation_id;
		const id = Number(raw);
		return navigateTo(
			{ path: "/messages", query: Number.isInteger(id) && id > 0 ? { c: String(id) } : {} },
			{ replace: true },
		);
	},
});
</script>

<template>
	<div />
</template>
