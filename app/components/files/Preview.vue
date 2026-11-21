<script setup lang="ts">
/**
 * In-app preview of one file, by type (`filePreviewKind`): images, PDFs, Markdown (rendered,
 * read-only), CSV as a table, plain text. Everything else gets a card with a download button.
 * Text is fetched and shown as text (never as HTML).
 *
 * PDFs open in the browser's own viewer (search, print, thumbnails, forms …) where it has one
 * (`navigator.pdfViewerEnabled`); in browsers without a built-in viewer (e.g. on Android) in
 * `FilesPdfViewer` (pdf.js), which is only loaded then (lazy component + dynamic import). The
 * server checks that a "PDF" really is one and sends anything else as a download, so the
 * browser's viewer only gets the file after a `HEAD` request confirmed that.
 *
 * `fill`: the preview takes its container's whole height (the full-page file view) and scrolls
 * inside it.
 */
import { Utils } from "~/utils";
import type { FilePreviewKind } from "~/utils/filePreview";

const props = defineProps<{
	/** Contents, same origin (the session or share cookie authenticates it). */
	url: string;
	/** Forces a download; shown on the fallback card. */
	downloadUrl?: string;
	name: string;
	mimeType: string | null;
	size: number;
	/** Replaces the text of the fallback card (e.g. for office files without an office editor). */
	fallbackHint?: string;
	fill?: boolean;
}>();

const kind = computed<FilePreviewKind>(() => filePreviewKind(props.name, props.mimeType));
const isText = computed(() => ["markdown", "csv", "text"].includes(kind.value));

const text = ref<string | null>(null);
const textState = ref<"idle" | "loading" | "error" | "too_large">("idle");
/** Counts text loads: only the latest one may fill the preview. */
let textLoads = 0;

async function loadText() {
	const current = ++textLoads;
	text.value = null;
	textState.value = "idle";
	if (!isText.value) return;
	if (props.size > TEXT_PREVIEW_MAX_BYTES) {
		textState.value = "too_large";
		return;
	}
	textState.value = "loading";
	try {
		const response = await fetch(props.url, { credentials: "same-origin" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = await response.text();
		if (current !== textLoads) return;
		text.value = body;
		textState.value = "idle";
	} catch {
		if (current === textLoads) textState.value = "error";
	}
}

watch(() => [props.url, kind.value], loadText, { immediate: true });

/** The browser shows PDFs itself (decided in the browser: null until mounted). */
const nativePdf = ref<boolean | null>(null);
onMounted(() => {
	nativePdf.value = navigator.pdfViewerEnabled === true;
});

/**
 * Whether the server sends the PDF to be shown (`ok`) — a file that only claims to be one comes as
 * a download (`invalid`), which the browser's viewer would start instead of showing it.
 */
const pdfState = ref<"checking" | "ok" | "invalid" | "error">("checking");
let pdfChecks = 0;

async function checkPdf() {
	const current = ++pdfChecks;
	pdfState.value = "checking";
	if (kind.value !== "pdf" || !nativePdf.value) return;
	try {
		const response = await fetch(props.url, { method: "HEAD", credentials: "same-origin" });
		if (current !== pdfChecks) return;
		const type = response.headers.get("content-type") ?? "";
		pdfState.value = !response.ok ? "error" : type.startsWith("application/pdf") ? "ok" : "invalid";
	} catch {
		if (current === pdfChecks) pdfState.value = "error";
	}
}

watch(() => [props.url, kind.value, nativePdf.value], checkPdf);

const csv = computed(() =>
	kind.value === "csv" && text.value ? parseCsvPreview(text.value) : { rows: [], truncated: false },
);
const csvRows = computed(() => csv.value.rows);

const imageFull = ref(false);
const icon = computed(() => Utils.getFileIcon(props.name, props.mimeType));

const fallbackText = computed(() => {
	if (textState.value === "too_large") return "Die Datei ist zu groß für die Vorschau.";
	if (textState.value === "error") return "Die Vorschau konnte nicht geladen werden.";
	if (kind.value === "pdf" && pdfState.value === "invalid") {
		return "Die Datei ist kein gültiges PDF. Lade sie herunter, um sie zu öffnen.";
	}
	if (kind.value === "pdf" && pdfState.value === "error") {
		return "Die Vorschau konnte nicht geladen werden.";
	}
	if (props.fallbackHint) return props.fallbackHint;
	return "Für diesen Dateityp gibt es keine Vorschau.";
});

const loader = "flex justify-center py-16";
</script>

<template>
	<!-- PDF: the browser's own viewer, edge to edge. -->
	<template v-if="kind === 'pdf' && nativePdf && pdfState === 'ok'">
		<iframe
			:src="url"
			:title="name"
			:class="fill ? 'block h-full w-full border-0 bg-white' : 'h-[80vh] w-full rounded-lg border border-slate-800 bg-white'"
		/>
	</template>

	<div v-else :class="fill ? 'h-full overflow-auto p-3 sm:p-6' : undefined">
		<div v-if="kind === 'pdf' && (nativePdf === null || (nativePdf && pdfState === 'checking'))" :class="loader">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
		</div>
		<LazyFilesPdfViewer v-else-if="kind === 'pdf' && !nativePdf" :url="url" />

		<div
			v-else-if="kind === 'image'"
			:class="[imageFull ? 'overflow-auto' : 'flex justify-center', fill && !imageFull ? 'h-full items-center' : '']"
		>
			<button
				type="button"
				:class="imageFull ? 'cursor-zoom-out' : 'cursor-zoom-in'"
				:aria-label="imageFull ? 'Bild einpassen' : 'Bild in Originalgröße'"
				@click="imageFull = !imageFull"
			>
				<img
					:src="url"
					:alt="name"
					:class="[
						'rounded-lg',
						imageFull ? 'max-w-none' : fill ? 'max-h-[calc(100dvh-7rem)] max-w-full object-contain' : 'max-h-[75vh] max-w-full object-contain',
					]"
				/>
			</button>
		</div>

		<div v-else-if="isText && textState === 'loading'" :class="loader">
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
			<p v-if="csv.truncated" class="text-xs text-slate-500">
				Die Vorschau zeigt die ersten {{ CSV_PREVIEW_MAX_ROWS }} Zeilen. Lade die Datei herunter, um alles zu sehen.
			</p>
		</div>

		<pre
			v-else-if="kind === 'text' && text !== null"
			class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-slate-200"
		>{{ text }}</pre>

		<div v-else :class="fill ? 'flex h-full items-center' : undefined" class="w-full">
			<UCard class="mx-auto w-full max-w-md border-slate-800 bg-slate-900/60">
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
		</div>
	</div>
</template>
