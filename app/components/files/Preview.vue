<script setup lang="ts">
/**
 * In-app preview of one file, by type (`filePreviewKind`): images, PDFs (pdf.js), Markdown,
 * CSV as a table, plain text. Everything else — office files included, for now — gets a card
 * with a download button. Text is fetched and shown as text (never as HTML); Markdown goes
 * through the same editor component as notes.
 */
import { Utils } from "~/utils";
import {
	type FilePreviewKind,
	filePreviewKind,
	parseCsv,
	TEXT_PREVIEW_MAX_BYTES,
} from "~/utils/filePreview";

const props = defineProps<{
	/** Contents, same origin (the session or share cookie authenticates it). */
	url: string;
	/** Forces a download; shown on the fallback card. */
	downloadUrl?: string;
	name: string;
	mimeType: string | null;
	size: number;
	/** Replaces the text of the fallback card (e.g. "open it in Office"). */
	fallbackHint?: string;
}>();

const kind = computed<FilePreviewKind>(() => filePreviewKind(props.name, props.mimeType));
const isText = computed(() => ["markdown", "csv", "text"].includes(kind.value));

const text = ref<string | null>(null);
const textState = ref<"idle" | "loading" | "error" | "too_large">("idle");

async function loadText() {
	text.value = null;
	if (!isText.value) return;
	if (props.size > TEXT_PREVIEW_MAX_BYTES) {
		textState.value = "too_large";
		return;
	}
	textState.value = "loading";
	try {
		const response = await fetch(props.url, { credentials: "same-origin" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		text.value = await response.text();
		textState.value = "idle";
	} catch {
		textState.value = "error";
	}
}

watch(() => [props.url, kind.value], loadText, { immediate: true });

const csvRows = computed(() => (kind.value === "csv" && text.value ? parseCsv(text.value) : []));
const csvTruncated = computed(() => csvRows.value.length >= 1000);

const imageFull = ref(false);
const icon = computed(() => Utils.getFileIcon(props.name, props.mimeType));

const fallbackText = computed(() => {
	if (textState.value === "too_large") return "Die Datei ist zu groß für die Vorschau.";
	if (textState.value === "error") return "Die Vorschau konnte nicht geladen werden.";
	if (props.fallbackHint) return props.fallbackHint;
	if (kind.value === "office") return "Für Office-Dateien gibt es hier noch keine Vorschau.";
	return "Für diesen Dateityp gibt es keine Vorschau.";
});
</script>

<template>
	<FilesPdfViewer v-if="kind === 'pdf'" :url="url" />

	<div v-else-if="kind === 'image'" :class="imageFull ? 'overflow-auto' : 'flex justify-center'">
		<button
			type="button"
			:class="imageFull ? 'cursor-zoom-out' : 'cursor-zoom-in'"
			:aria-label="imageFull ? 'Bild einpassen' : 'Bild in Originalgröße'"
			@click="imageFull = !imageFull"
		>
			<img
				:src="url"
				:alt="name"
				:class="['rounded-lg', imageFull ? 'max-w-none' : 'max-h-[75vh] max-w-full object-contain']"
			/>
		</button>
	</div>

	<div v-else-if="isText && textState === 'loading'" class="flex justify-center py-16">
		<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
	</div>

	<UCard
		v-else-if="kind === 'markdown' && text !== null"
		class="mx-auto w-full max-w-3xl border-slate-800 bg-slate-900/60"
	>
		<ContentMarkdownView :content="text" />
	</UCard>

	<div v-else-if="kind === 'csv' && text !== null" class="space-y-2">
		<div class="overflow-x-auto rounded-lg border border-slate-800">
			<table class="min-w-full divide-y divide-slate-800 text-sm">
				<thead v-if="csvRows.length" class="bg-slate-900">
					<tr>
						<th
							v-for="(cell, index) in csvRows[0]"
							:key="index"
							class="whitespace-nowrap px-3 py-2 text-left font-medium text-white"
						>
							{{ cell }}
						</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-800">
					<tr v-for="(row, rowIndex) in csvRows.slice(1)" :key="rowIndex">
						<td v-for="(cell, index) in row" :key="index" class="whitespace-nowrap px-3 py-1.5 text-slate-300">
							{{ cell }}
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<p v-if="csvTruncated" class="text-xs text-slate-500">
			Die Vorschau zeigt die ersten 1000 Zeilen. Lade die Datei herunter, um alles zu sehen.
		</p>
	</div>

	<pre
		v-else-if="kind === 'text' && text !== null"
		class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-slate-200"
	>{{ text }}</pre>

	<UCard v-else class="mx-auto w-full max-w-md border-slate-800 bg-slate-900/60">
		<div class="flex flex-col items-center gap-3 py-6 text-center">
			<UIcon :name="icon" class="size-12 text-slate-500" />
			<div>
				<p class="font-medium text-white">{{ name }}</p>
				<p class="text-sm text-slate-500">{{ formatFileSize(size) }}</p>
			</div>
			<p class="text-sm text-slate-400">{{ fallbackText }}</p>
			<UButton
				v-if="downloadUrl"
				label="Herunterladen"
				icon="i-lucide-download"
				:to="downloadUrl"
				target="_blank"
			/>
		</div>
	</UCard>
</template>
