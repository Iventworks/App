<script setup lang="ts">
/**
 * A file on its own, using the whole window — like Google Docs, Office or Nextcloud: no sidebar,
 * no portal chrome. The page brings its own slim header (`pages/files/[file_id].vue`).
 */
</script>

<template>
	<NuxtLoadingIndicator color="var(--ui-primary)" position="top" />
	<div class="main-bg-color flex h-dvh flex-col overflow-hidden text-slate-100">
		<slot />
	</div>
</template>
