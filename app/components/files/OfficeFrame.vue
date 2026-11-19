<script setup lang="ts">
/**
 * An office document (docx, xlsx, pptx, odt …) in the office server's editor (Nextcloud Office /
 * Euro-Office over WOPI), filling its container. The API hands out an access token and the editor
 * URL — editing when the caller may edit, viewing otherwise (`mode`); the token is posted to the
 * editor in a frame (`form` → `iframe`, the WOPI way), so the office server's code never runs on
 * our page. Saving, co-editing and cursors happen inside the office server.
 */
const props = defineProps<{ fileId: number }>();
const emit = defineEmits<{ mode: ["edit" | "view"] }>();

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

async function open() {
	state.value = "loading";
	const result = await useAPI((api) =>
		api.postFilesByFileIdOffice({ path: { fileId: props.fileId } }),
	);
	if (!result.success) {
		state.value = "error";
		errorMessage.value = result.message;
		return;
	}
	editor.value = result.data;
	emit("mode", result.data.mode);
	state.value = "ready";
	await nextTick();
	form.value?.submit();
}

onMounted(open);
</script>

<template>
	<div class="relative h-full w-full">
		<div v-if="state === 'error'" class="flex h-full items-center justify-center p-4">
			<UAlert
				icon="i-lucide-circle-alert"
				color="error"
				variant="subtle"
				title="Der Office-Editor konnte nicht geöffnet werden"
				:description="errorMessage"
				:actions="[{ label: 'Erneut versuchen', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'subtle', onClick: open }]"
				class="max-w-lg"
			/>
		</div>
		<div v-else-if="state === 'loading'" class="flex h-full items-center justify-center text-slate-400">
			<UIcon name="i-lucide-loader-2" class="size-6 animate-spin" />
		</div>

		<template v-if="editor && state === 'ready'">
			<iframe
				:name="frameName"
				title="Office-Editor"
				class="block h-full w-full border-0 bg-white"
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
