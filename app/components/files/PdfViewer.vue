<script setup lang="ts">
/**
 * PDF preview with pdf.js — the browser's own viewer is missing in the installed iOS app and on
 * Android. pdf.js is loaded only when a PDF is opened (dynamic `import()`, like jsPDF for the
 * program PDF). Pages are rendered to canvases while they are near the screen (and released when
 * they leave it), fitted to the width, with zoom on top.
 *
 * CSP: pdf.js 6 evaluates no strings, the worker comes from our own bundle (`worker-src 'self'`),
 * and WebAssembly is off (`useWasm: false`; the CSP has no `wasm-unsafe-eval`) — its image
 * decoders fall back to JavaScript.
 */
import { useDebounceFn, useResizeObserver } from "@vueuse/core";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type LoadingTask = ReturnType<PdfJs["getDocument"]>;
type PdfDocument = Awaited<LoadingTask["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type RenderTask = ReturnType<PdfPage["render"]>;

const props = defineProps<{
	/** Where the bytes come from (same origin; the session or share cookie authenticates it). */
	url: string;
}>();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** Widest a page gets at 100 % — wider screens keep some margin. */
const MAX_FIT_WIDTH = 960;
/** iOS refuses canvases above ~16 megapixels. */
const MAX_CANVAS_PIXELS = 16_000_000;

const state = ref<"loading" | "ready" | "error">("loading");
const errorMessage = ref("");
const pageCount = ref(0);
const currentPage = ref(1);
const zoom = ref(1);
/** Page sizes in PDF points (scale 1); unknown pages use the first page's size. */
const pageSizes = ref<{ width: number; height: number }[]>([]);

const scroller = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
useResizeObserver(scroller, (entries) => {
	const width = entries[0]?.contentRect.width ?? 0;
	if (Math.abs(width - containerWidth.value) > 1) containerWidth.value = width;
});

let loadingTask: LoadingTask | null = null;
let pdf: PdfDocument | null = null;
let unmounted = false;
const canvases = new Map<number, HTMLCanvasElement>();
const wrappers = new Map<number, HTMLElement>();
/** Pages near the screen: rendered and kept. */
const near = new Set<number>();
/** Scale each page was last rendered at. */
const renderedAt = new Map<number, number>();
const tasks = new Map<number, RenderTask>();
/** Pages pdf.js has loaded: it keeps their drawing commands and images until `cleanup()`. */
const pages = new Map<number, PdfPage>();

const fitWidth = computed(() => Math.max(200, Math.min(containerWidth.value, MAX_FIT_WIDTH)));

function sizeOf(page: number) {
	return pageSizes.value[page - 1] ?? pageSizes.value[0] ?? { width: 595, height: 842 };
}

function scaleOf(page: number) {
	return (fitWidth.value / sizeOf(page).width) * zoom.value;
}

function boxStyle(page: number) {
	const size = sizeOf(page);
	const scale = scaleOf(page);
	return {
		width: `${Math.floor(size.width * scale)}px`,
		height: `${Math.floor(size.height * scale)}px`,
	};
}

// --- loading --------------------------------------------------------------------------------

async function load() {
	state.value = "loading";
	try {
		const [pdfjs, worker] = await Promise.all([
			import("pdfjs-dist/legacy/build/pdf.mjs"),
			import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
		]);
		pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

		const response = await fetch(props.url, { credentials: "same-origin" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = new Uint8Array(await response.arrayBuffer());

		if (unmounted) return;
		loadingTask = pdfjs.getDocument({ data, useWasm: false });
		pdf = await loadingTask.promise;
		const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
		pageSizes.value = [{ width: first.width, height: first.height }];
		pageCount.value = pdf.numPages;
		state.value = "ready";
		await nextTick();
		observeAll();
	} catch (error: any) {
		if (unmounted) return;
		state.value = "error";
		errorMessage.value =
			error?.name === "PasswordException"
				? "Diese PDF ist mit einem Passwort geschützt. Lade sie herunter, um sie zu öffnen."
				: error?.name === "InvalidPDFException"
					? "Die Datei ist keine gültige PDF."
					: "Die Vorschau konnte nicht geladen werden. Lade die Datei herunter, um sie zu öffnen.";
	}
}

onMounted(load);

// --- rendering ------------------------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();

/** Render one page at the current scale (queued: one page at a time keeps memory low). */
function requestRender(page: number) {
	queue = queue.then(() => render(page)).catch(() => {});
}

async function render(page: number) {
	const canvas = canvases.get(page);
	if (!pdf || !canvas || !near.has(page)) return;
	const scale = scaleOf(page);
	if (renderedAt.get(page) === scale) return;

	tasks.get(page)?.cancel();
	const proxy = await pdf.getPage(page);
	// Scrolled away meanwhile.
	if (!near.has(page)) return;
	pages.set(page, proxy);
	const base = proxy.getViewport({ scale: 1 });
	if (!pageSizes.value[page - 1])
		pageSizes.value[page - 1] = { width: base.width, height: base.height };

	const viewport = proxy.getViewport({ scale: scaleOf(page) });
	const ratio = Math.min(
		window.devicePixelRatio || 1,
		2,
		Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
	);
	const renderViewport = proxy.getViewport({ scale: scaleOf(page) * ratio });
	canvas.width = Math.floor(renderViewport.width);
	canvas.height = Math.floor(renderViewport.height);
	canvas.style.width = `${Math.floor(viewport.width)}px`;
	canvas.style.height = `${Math.floor(viewport.height)}px`;

	const task = proxy.render({ canvas, viewport: renderViewport });
	tasks.set(page, task);
	try {
		await task.promise;
		renderedAt.set(page, scaleOf(page));
	} catch {
		// Cancelled (zoomed again, scrolled away) or a broken page: left blank.
	} finally {
		if (tasks.get(page) === task) tasks.delete(page);
	}
}

/** Free a page's canvas and what pdf.js keeps of it once it is far from the screen. */
function release(page: number) {
	tasks.get(page)?.cancel();
	// After a cancelled render, pdf.js cleans up once that has stopped.
	pages.get(page)?.cleanup();
	pages.delete(page);
	renderedAt.delete(page);
	const canvas = canvases.get(page);
	if (canvas) {
		canvas.width = 0;
		canvas.height = 0;
	}
}

function rerenderNear() {
	renderedAt.clear();
	for (const page of [...near].sort(
		(a, b) => Math.abs(a - currentPage.value) - Math.abs(b - currentPage.value),
	)) {
		requestRender(page);
	}
}

const rerenderSoon = useDebounceFn(rerenderNear, 150);
watch([zoom, fitWidth], () => {
	if (state.value === "ready") rerenderSoon();
});

// --- which pages are near / on screen -------------------------------------------------------

let nearObserver: IntersectionObserver | null = null;
let viewObserver: IntersectionObserver | null = null;
const visibleRatios = new Map<number, number>();

function pageOf(element: Element) {
	return Number((element as HTMLElement).dataset.page);
}

function observeAll() {
	nearObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const page = pageOf(entry.target);
				if (entry.isIntersecting) {
					near.add(page);
					requestRender(page);
				} else if (near.delete(page)) {
					release(page);
				}
			}
		},
		{ rootMargin: "1200px 0px" },
	);
	viewObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) visibleRatios.set(pageOf(entry.target), entry.intersectionRatio);
			let best = currentPage.value;
			let bestRatio = -1;
			for (const [page, ratio] of visibleRatios) {
				if (ratio > bestRatio) {
					best = page;
					bestRatio = ratio;
				}
			}
			if (bestRatio > 0) currentPage.value = best;
		},
		{ threshold: [0, 0.25, 0.5, 0.75, 1] },
	);
	for (const element of wrappers.values()) {
		nearObserver.observe(element);
		viewObserver.observe(element);
	}
}

function setWrapper(page: number, element: unknown) {
	if (element instanceof HTMLElement) wrappers.set(page, element);
	else wrappers.delete(page);
}

function setCanvas(page: number, element: unknown) {
	if (element instanceof HTMLCanvasElement) canvases.set(page, element);
	else canvases.delete(page);
}

function setZoom(value: number) {
	zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

onBeforeUnmount(() => {
	nearObserver?.disconnect();
	viewObserver?.disconnect();
	for (const task of tasks.values()) task.cancel();
	unmounted = true;
	// Also cancels a document that is still loading, and ends its worker.
	void loadingTask?.destroy();
	loadingTask = null;
	pdf = null;
});
</script>

<template>
	<div class="space-y-3">
		<div
			v-if="state === 'ready'"
			class="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 backdrop-blur"
		>
			<span class="text-sm text-slate-400">Seite {{ currentPage }} von {{ pageCount }}</span>
			<div class="flex items-center gap-1">
				<UButton
					icon="i-lucide-zoom-out"
					color="neutral"
					variant="ghost"
					size="sm"
					aria-label="Verkleinern"
					:disabled="zoom <= MIN_ZOOM"
					@click="setZoom(zoom / 1.25)"
				/>
				<UTooltip text="An die Breite anpassen">
					<UButton
						:label="`${Math.round(zoom * 100)} %`"
						color="neutral"
						variant="ghost"
						size="sm"
						class="min-w-16 justify-center tabular-nums"
						@click="setZoom(1)"
					/>
				</UTooltip>
				<UButton
					icon="i-lucide-zoom-in"
					color="neutral"
					variant="ghost"
					size="sm"
					aria-label="Vergrößern"
					:disabled="zoom >= MAX_ZOOM"
					@click="setZoom(zoom * 1.25)"
				/>
			</div>
		</div>

		<div ref="scroller" class="overflow-x-auto">
			<div v-if="state === 'loading'" class="flex justify-center py-16">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
			</div>

			<UEmpty
				v-else-if="state === 'error'"
				icon="i-lucide-file-x"
				title="Keine Vorschau"
				:description="errorMessage"
				variant="naked"
				class="py-12"
			/>

			<div v-else class="mx-auto flex w-max min-w-full flex-col items-center gap-4 pb-6">
				<div
					v-for="page in pageCount"
					:key="page"
					:ref="(element) => setWrapper(page, element)"
					:data-page="page"
					class="relative overflow-hidden bg-white shadow-lg shadow-black/40"
					:style="boxStyle(page)"
				>
					<canvas :ref="(element) => setCanvas(page, element)" class="block" />
				</div>
			</div>
		</div>
	</div>
</template>
