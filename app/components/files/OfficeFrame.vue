<script setup lang="ts">
/**
 * An office document (docx, xlsx, pptx, odt …) in the office server's editor (Euro-Office over
 * WOPI). The API hands out an access token and the editor URL; the token is posted to the editor
 * in a frame (`form` → `iframe`, the WOPI way), so the office server's code never runs on our
 * page. Saving, co-editing and cursors happen inside the office server.
 */
const props = defineProps<{ fileId: number }>();
const emit = defineEmits<{ close: [] }>();

const state = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref("");
const editor = ref<{
	url: string;
	access_token: string;
	access_token_ttl: number;
	mode: "edit" | "view";
} | null>(null);
const form = ref<HTMLFormElement | null>(null);
const frameName = `office-${props.fileId}-${Math.random().toString(36).slice(2)}`;

onMounted(async () => {
	const result = await useAPI((api) =>
		api.postFilesByFileIdOffice({ path: { fileId: props.fileId } }),
	);
	if (!result.success) {
		state.value = "error";
		errorMessage.value = result.message;
		return;
	}
	editor.value = result.data;
	state.value = "ready";
	await nextTick();
	form.value?.submit();
});
</script>

<template>
	<div class="flex h-[calc(100dvh-9rem)] min-h-[28rem] flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<UBadge
				v-if="editor"
				:label="editor.mode === 'edit' ? 'Bearbeiten – speichert von selbst' : 'Nur ansehen'"
				:icon="editor.mode === 'edit' ? 'i-lucide-pencil' : 'i-lucide-eye'"
				color="neutral"
				variant="subtle"
			/>
			<span v-else />
			<UButton label="Schließen" icon="i-lucide-x" color="neutral" variant="subtle" size="sm" @click="emit('close')" />
		</div>

		<UAlert
			v-if="state === 'error'"
			icon="i-lucide-circle-alert"
			color="error"
			variant="subtle"
			title="Der Office-Editor konnte nicht geöffnet werden"
			:description="errorMessage"
		/>
		<div v-else-if="state === 'loading'" class="flex flex-1 items-center justify-center text-slate-400">
			<UIcon name="i-lucide-loader-2" class="size-6 animate-spin" />
		</div>

		<template v-if="editor">
			<iframe
				:name="frameName"
				title="Office-Editor"
				class="w-full flex-1 rounded-lg border border-slate-800 bg-white"
				allow="clipboard-read; clipboard-write; fullscreen"
				allowfullscreen
			/>
			<form ref="form" :action="editor.url" method="post" :target="frameName" class="hidden">
				<input type="hidden" name="access_token" :value="editor.access_token" />
				<input type="hidden" name="access_token_ttl" :value="editor.access_token_ttl" />
			</form>
		</template>
	</div>
</template>
