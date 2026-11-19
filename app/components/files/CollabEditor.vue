<script setup lang="ts">
/**
 * Editing a Markdown document (`.md`) together, live — like Nextcloud Text. The notes editor with
 * TipTap's Yjs collaboration: everyone's changes and cursors show up while they type; the text is
 * written back into the file on its own (`CollabProvider`). The first person in a fresh session
 * fills the document from the file; the others wait for it.
 *
 * The page saves through `flush()` before leaving.
 */
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { useEventListener } from "@vueuse/core";
import { CollabProvider } from "~/utils/collabProvider";
import { MARKDOWN_TOOLBAR_ITEMS } from "~/utils/editorToolbar";

const props = defineProps<{
	fileId: number;
	/** Where the stored text comes from (to fill a fresh document). */
	contentUrl: string;
	/** The own name on the cursor (the server sets it for everyone else anyway). */
	userName: string;
}>();

const emit = defineEmits<{
	/** Editing ended: everything saved, the session left. */
	close: [];
	/** The session ended while this tab was away: open the editor again (a new component). */
	restart: [];
}>();

const toast = useToast();

const provider = new CollabProvider(props.fileId);
const status = provider.status;
const saveState = provider.saveState;
const toolbarItems = MARKDOWN_TOOLBAR_ITEMS;

// The editor works on the shared Yjs document; history comes from Yjs too (`undoRedo: false`).
const extensions = [
	Collaboration.configure({ document: provider.doc }),
	CollaborationCaret.configure({ provider, user: { name: props.userName, color: "#94a3b8" } }),
];

type EditorInstance = {
	getMarkdown: () => string;
	setEditable: (editable: boolean) => void;
	commands: { setContent: (content: string, options: { contentType: "markdown" }) => boolean };
};
const editorRef = ref<{ editor?: EditorInstance } | null>(null);
const editor = computed(() => editorRef.value?.editor ?? null);

watch([status, editor], ([current, instance]) => {
	instance?.setEditable(current === "ready");
});

watch(
	editor,
	(instance) => {
		if (instance) provider.serialize = () => instance.getMarkdown();
	},
	{ immediate: true },
);

onMounted(() => provider.start());

// A fresh session: this tab fills the document from the stored text — when it joins first, or
// later when the tab that was to do it left.
const initializeRequested = provider.initializeRequested;
watch([initializeRequested, editor], async ([requested, instance]) => {
	if (!requested || !instance) return;
	const filled = await provider.initializeWith(
		async () => {
			const response = await fetch(props.contentUrl, { credentials: "same-origin" });
			if (response.ok) return await response.text();
			status.value = "error";
			return null;
		},
		(markdown) => instance.commands.setContent(markdown, { contentType: "markdown" }),
	);
	if (!filled && status.value === "error") {
		toast.add({
			title: "Dokument konnte nicht geöffnet werden",
			description: "Lade die Seite neu und versuche es noch einmal.",
			color: "error",
		});
	}
});

const closing = ref(false);

/** Save everything and leave the session. */
async function finish() {
	closing.value = true;
	if (!(await provider.flush())) {
		closing.value = false;
		toast.add({
			title: "Speichern fehlgeschlagen",
			description: "Versuche es noch einmal.",
			color: "error",
		});
		return;
	}
	await provider.stop();
	emit("close");
}

defineExpose({ flush: () => provider.flush() });

useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
	if (provider.dirty) event.preventDefault();
});

onBeforeUnmount(() => provider.destroy());

// --- status bar ---------------------------------------------------------------------------------

/** The others in the session, once per person. */
const others = computed(() => {
	const seen = new Set<number>();
	return provider.participants.value.filter((participant) => {
		if (participant.client_id === provider.doc.clientID) return false;
		if (seen.has(participant.user.id)) return false;
		seen.add(participant.user.id);
		return true;
	});
});

const othersText = computed(() => {
	const names = others.value.map((participant) => participant.user.display_name.split(" ")[0]);
	if (names.length === 0) return "Nur du bearbeitest gerade";
	if (names.length === 1) return `Du und ${names[0]} bearbeiten gerade`;
	if (names.length === 2) return `Du, ${names[0]} und ${names[1]} bearbeiten gerade`;
	return `Du, ${names[0]} und ${names.length - 1} weitere bearbeiten gerade`;
});

const saveText = computed(() => {
	switch (saveState.value) {
		case "saving":
			return "Speichert …";
		case "pending":
			return "Ungespeicherte Änderungen";
		case "error":
			return "Nicht gespeichert";
		default: {
			const at = provider.savedAt.value;
			return at
				? `Gespeichert um ${new Date(at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
				: "Alles gespeichert";
		}
	}
});
</script>

<template>
	<div class="space-y-3">
		<div
			class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 backdrop-blur"
		>
			<div class="flex min-w-0 items-center gap-2 text-sm text-slate-400">
				<div v-if="others.length" class="flex -space-x-1.5">
					<UTooltip v-for="participant in others" :key="participant.user.id" :text="participant.user.display_name">
						<UAvatar
							:text="initials(participant.user.display_name)"
							size="2xs"
							class="ring-2"
							:style="{ '--tw-ring-color': participant.color }"
						/>
					</UTooltip>
				</div>
				<UIcon v-else name="i-lucide-user-pen" class="size-4" />
				<span class="truncate">{{ othersText }}</span>
			</div>
			<div class="flex items-center gap-2">
				<span
					:class="[
						'flex items-center gap-1.5 text-sm',
						saveState === 'error' ? 'text-red-400' : 'text-slate-400',
					]"
				>
					<UIcon
						:name="
							saveState === 'saving'
								? 'i-lucide-loader-2'
								: saveState === 'error'
									? 'i-lucide-circle-alert'
									: saveState === 'pending'
										? 'i-lucide-pencil'
										: 'i-lucide-check'
						"
						:class="['size-4', saveState === 'saving' ? 'animate-spin' : '']"
					/>
					<span class="hidden sm:inline">{{ saveText }}</span>
				</span>
				<UButton
					v-if="saveState === 'error'"
					label="Erneut speichern"
					icon="i-lucide-refresh-cw"
					color="neutral"
					variant="subtle"
					size="sm"
					@click="provider.save()"
				/>
				<UButton label="Fertig" icon="i-lucide-check" size="sm" :loading="closing" @click="finish" />
			</div>
		</div>

		<UAlert
			v-if="status === 'reset'"
			icon="i-lucide-rotate-ccw"
			color="warning"
			variant="subtle"
			title="Die Bearbeitung wurde zwischendurch neu gestartet"
			description="Während du offline warst, haben alle anderen das Dokument geschlossen. Was du seitdem geschrieben hast, konnte nicht übernommen werden – kopiere es bei Bedarf und öffne das Dokument neu."
			:actions="[{ label: 'Neu öffnen', icon: 'i-lucide-refresh-cw', color: 'warning', variant: 'subtle', onClick: () => emit('restart') }]"
		/>

		<UAlert
			v-if="status === 'error'"
			icon="i-lucide-circle-alert"
			color="error"
			variant="subtle"
			title="Verbindung zum Dokument unterbrochen"
			description="Deine Änderungen werden weiter versucht zu senden. Bleibt das so, kopiere deinen Text und lade die Seite neu."
		/>

		<div v-if="status === 'connecting' || status === 'waiting'" class="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
			<UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
			{{ status === "waiting" ? "Das Dokument wird gerade geöffnet …" : "Verbinde …" }}
		</div>

		<UCard class="mx-auto w-full max-w-3xl border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
			<UEditor
				ref="editorRef"
				v-slot="{ editor: instance }"
				content-type="markdown"
				:starter-kit="{ undoRedo: false }"
				:extensions="extensions"
				:image="false"
				:mention="false"
				placeholder="Schreib los …"
				:ui="{ base: 'min-h-[60vh] px-4 py-3 sm:px-4' }"
			>
				<UEditorToolbar
					:editor="instance"
					:items="toolbarItems"
					class="overflow-x-auto border-b border-slate-800 px-2 py-1"
				/>
			</UEditor>
		</UCard>
	</div>
</template>
