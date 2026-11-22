<script setup lang="ts">
/**
 * An office document (docx, xlsx, pptx, odt …) in the office server's editor (Nextcloud Office over
 * WOPI), filling its container. The API hands out an access token and the editor
 * URL — editing when the caller may edit, viewing otherwise (`mode`); the token is posted to the
 * editor in a frame (`form` → `iframe`, the WOPI way), so the office server's code never runs on
 * our page. Saving, co-editing and cursors happen inside the office server.
 *
 * Editor and page talk WOPI PostMessage: the editor says when the document is loaded and asks for
 * the page's "Versionen" / "Teilen" (`versions`, `sharing` — its own version history and share
 * buttons); the page hands it the keyboard (`focus()`, after loading, full screen and dialogs).
 * Ctrl+S saves into Iventworks right away (`forcesave`); pressed while the focus is on our page,
 * Ctrl+S and Ctrl+A go to the editor instead of saving or selecting the page.
 */
import { useEventListener } from "@vueuse/core";

const props = defineProps<{
	fileId: number;
	/** The file's library, for the error texts. */
	scope: "org" | "event";
}>();
const emit = defineEmits<{ mode: ["edit" | "view"]; versions: []; sharing: [] }>();

const state = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref("");
const editor = ref<{
	url: string;
	access_token: string;
	access_token_ttl: number;
	mode: "edit" | "view";
} | null>(null);
const form = ref<HTMLFormElement | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const frameName = `office-${props.fileId}-${Math.random().toString(36).slice(2)}`;
const officeOrigin = computed(() => (editor.value ? new URL(editor.value.url).origin : null));

/** Merged into the editor's settings by the office server: Ctrl+S / "Speichern" saves into Iventworks. */
const DOCS_API_CONFIG = JSON.stringify({ editorConfig: { customization: { forcesave: true } } });

async function open() {
	state.value = "loading";
	const result = await useAPI((api) =>
		api.postFilesByFileIdOffice({ path: { fileId: props.fileId } }),
	);
	if (!result.success) {
		state.value = "error";
		errorMessage.value = fileErrorText(result.message, props.scope);
		return;
	}
	editor.value = result.data;
	emit("mode", result.data.mode);
	state.value = "ready";
	await nextTick();
	form.value?.submit();
}

onMounted(open);

/** A WOPI PostMessage to the editor page. */
function post(messageId: string, values: Record<string, unknown> = {}) {
	const target = frame.value?.contentWindow;
	if (!target || !officeOrigin.value) return;
	target.postMessage(
		JSON.stringify({ MessageId: messageId, SendTime: Date.now(), Values: values }),
		officeOrigin.value,
	);
}

/** The keyboard to the document — unless a dialog of ours is open. */
function focus() {
	if (state.value !== "ready") return;
	if (document.querySelector("[role='dialog'][data-state='open']")) return;
	frame.value?.focus();
	post("Grab_Focus");
}

useEventListener(window, "message", (event: MessageEvent) => {
	if (event.source !== frame.value?.contentWindow || event.origin !== officeOrigin.value) return;
	if (typeof event.data !== "string") return;
	let message: { MessageId?: string; Values?: { Status?: string } };
	try {
		message = JSON.parse(event.data);
	} catch {
		return;
	}
	switch (message.MessageId) {
		case "App_LoadingStatus":
			if (message.Values?.Status === "Document_Loaded") {
				post("Host_PostmessageReady");
				focus();
			}
			break;
		case "UI_FileVersions":
			emit("versions");
			break;
		case "UI_Sharing":
			emit("sharing");
			break;
	}
});

// Shortcuts that land on our page (focus on the toolbar or nowhere) instead of the editor.
useEventListener(window, "keydown", (event: KeyboardEvent) => {
	if (state.value !== "ready" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
	const key = event.key.toLowerCase();
	if (key !== "s" && key !== "a") return;
	const target = event.target instanceof Element ? event.target : null;
	const inDialog = Boolean(target?.closest("[role='dialog']"));
	if (key === "s") {
		// Never the browser's "save page"; the editor saves on its own Ctrl+S.
		event.preventDefault();
		if (!inDialog) focus();
		return;
	}
	const editable = target?.closest(
		"input, textarea, select, [contenteditable]:not([contenteditable='false'])",
	);
	if (inDialog || editable) return;
	event.preventDefault();
	focus();
});

defineExpose({ focus });
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
				ref="frame"
				:name="frameName"
				title="Office-Editor"
				class="block h-full w-full border-0 bg-white"
				allow="clipboard-read; clipboard-write; fullscreen"
				allowfullscreen
			/>
			<form ref="form" :action="editor.url" method="post" :target="frameName" class="hidden">
				<input type="hidden" name="access_token" :value="editor.access_token" />
				<input type="hidden" name="access_token_ttl" :value="editor.access_token_ttl" />
				<input type="hidden" name="docs_api_config" :value="DOCS_API_CONFIG" />
			</form>
		</template>
	</div>
</template>
