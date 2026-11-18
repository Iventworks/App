<script setup lang="ts">
/**
 * Editing a Markdown document (`.md`) with the notes editor. Holds the editor lock while open
 * (renewed every minute and with every save), saves on its own shortly after typing stops
 * (at most every ten seconds while typing), and saves once more on "Fertig". If the lock is
 * lost — expired, or the document was opened for editing in another tab — editing stops and
 * the text stays on screen so nothing is lost.
 *
 * The parent passes the lock it took (`lockId`) and the text the editor starts with.
 */
import { useDebounceFn, useEventListener, useIntervalFn } from "@vueuse/core";

const props = defineProps<{
	fileId: number;
	lockId: string;
	initialContent: string;
}>();

const emit = defineEmits<{
	/** Editing ended (saved, lock released). */
	close: [];
	/** Saved: the file row changed (size, time). */
	saved: [];
}>();

const toast = useToast();

const content = ref(props.initialContent);
let savedContent = props.initialContent;
const status = ref<"saved" | "pending" | "saving" | "error" | "lost">("saved");
const savedAt = ref<number | null>(null);
let closing = false;

const dirty = computed(() => content.value !== savedContent);

async function save(): Promise<boolean> {
	if (status.value === "lost") return false;
	if (!dirty.value) {
		status.value = "saved";
		return true;
	}
	const text = content.value;
	status.value = "saving";
	const result = await useAPI((api) =>
		api.putFilesByFileIdText({
			path: { fileId: props.fileId },
			body: { content: text, lock_id: props.lockId },
		}),
	);
	if (result.success) {
		savedContent = text;
		savedAt.value = Date.now();
		status.value = dirty.value ? "pending" : "saved";
		emit("saved");
		if (dirty.value) void saveSoon();
		return true;
	}
	if ((result as { code?: number }).code === 409) {
		status.value = "lost";
		toast.add({
			title: "Bearbeitung beendet",
			description:
				"Das Dokument wird inzwischen woanders bearbeitet. Dein Text bleibt hier stehen – kopiere ihn, bevor du die Seite verlässt.",
			color: "warning",
			duration: 0,
		});
	} else {
		status.value = "error";
	}
	return false;
}

const saveSoon = useDebounceFn(save, 1500, { maxWait: 10_000 });

watch(content, () => {
	if (status.value === "lost") return;
	status.value = "pending";
	void saveSoon();
});

// Keep the lock while the editor is open.
useIntervalFn(async () => {
	if (status.value === "lost" || closing) return;
	const result = await useAPI((api) =>
		api.putFilesByFileIdLock({ path: { fileId: props.fileId }, body: { lock_id: props.lockId } }),
	);
	if (!result.success && (result as { code?: number }).code === 409) status.value = "lost";
}, 60_000);

async function release() {
	await useAPI((api) =>
		api.deleteFilesByFileIdLock({ path: { fileId: props.fileId }, query: { lock_id: props.lockId } }),
	);
}

/** Save, give the document free and leave the editor. */
async function finish() {
	if (status.value !== "lost" && !(await save())) {
		toast.add({
			title: "Speichern fehlgeschlagen",
			description: "Versuche es noch einmal.",
			color: "error",
		});
		return;
	}
	closing = true;
	await release();
	emit("close");
}

/** For the page's leave guard: save what is left; false when it couldn't be saved. */
async function flush() {
	if (status.value === "lost") return !dirty.value;
	return await save();
}

defineExpose({ flush, dirty });

// Leaving the page: the browser asks when something isn't saved yet.
useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
	if (dirty.value) event.preventDefault();
});

onBeforeUnmount(() => {
	if (closing) return;
	closing = true;
	// Best effort when the page is left without "Fertig" (the guard saved already).
	void release();
});

const statusText = computed(() => {
	switch (status.value) {
		case "saving":
			return "Speichert …";
		case "pending":
			return "Ungespeicherte Änderungen";
		case "error":
			return "Nicht gespeichert";
		case "lost":
			return "Bearbeitung beendet";
		default:
			return savedAt.value
				? `Gespeichert um ${new Date(savedAt.value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
				: "Alles gespeichert";
	}
});

const statusIcon = computed(() => {
	switch (status.value) {
		case "saving":
			return "i-lucide-loader-2";
		case "pending":
			return "i-lucide-pencil";
		case "error":
		case "lost":
			return "i-lucide-circle-alert";
		default:
			return "i-lucide-check";
	}
});
</script>

<template>
	<div class="space-y-3">
		<div
			class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 backdrop-blur"
		>
			<span
				:class="[
					'flex items-center gap-1.5 text-sm',
					status === 'error' || status === 'lost' ? 'text-red-400' : 'text-slate-400',
				]"
			>
				<UIcon :name="statusIcon" :class="['size-4', status === 'saving' ? 'animate-spin' : '']" />
				{{ statusText }}
			</span>
			<div class="flex items-center gap-2">
				<UButton
					v-if="status === 'error'"
					label="Erneut speichern"
					icon="i-lucide-refresh-cw"
					color="neutral"
					variant="subtle"
					size="sm"
					@click="save"
				/>
				<UButton
					:label="status === 'lost' ? 'Schließen' : 'Fertig'"
					icon="i-lucide-check"
					size="sm"
					:loading="status === 'saving'"
					@click="finish"
				/>
			</div>
		</div>

		<UCard class="mx-auto w-full max-w-3xl border-slate-800 bg-slate-900/60">
			<FormMarkdownEditor
				v-model="content"
				:readonly="status === 'lost'"
				min-height="min-h-[60vh]"
				placeholder="Schreib los …"
			/>
		</UCard>
	</div>
</template>
