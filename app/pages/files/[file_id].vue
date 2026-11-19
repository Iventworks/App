<script setup lang="ts">
/**
 * One file, using the whole window (layout `viewer`, like Google Docs, Office or Nextcloud): a
 * slim header — back into the folder, name and where it lives, download, versions, "Neue
 * Fassung" — and the file below it, edge to edge:
 * - office documents open right away in the office editor when one is configured (editing for
 *   people who may edit, viewing for everyone else — `FilesOfficeFrame`);
 * - everything else gets a preview (`FilesPreview`: the browser's PDF viewer, images, Markdown,
 *   CSV, text).
 * `?version=…` shows an earlier version instead, with "Wiederherstellen". Opened from the file
 * browsers (`?from=` names the library page it came from, so "back" leads there); works for every
 * file the caller may open — the API checks access.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import type { GetFilesByFileIdVersionsResponses } from "~/api-client";
import { Utils } from "~/utils";
import { filePreviewKind } from "~/utils/filePreview";

type Version = GetFilesByFileIdVersionsResponses["200"]["data"][number];

definePageMeta({ layout: "viewer" });

const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirmDialog();
const fileURL = useFileURL();

const fileId = computed(() => Number(route.params.file_id));
const errorMessage = ref("");

const {
	data: file,
	loading,
	refresh,
} = await useAPIAsyncData(`file-${fileId.value}`, async () => {
	errorMessage.value = "";
	if (!Number.isInteger(fileId.value) || fileId.value <= 0) {
		errorMessage.value = "Diese Datei gibt es nicht.";
		return null;
	}
	const result = await useAPI((api) => api.getFilesByFileId({ path: { fileId: fileId.value } }));
	if (!result.success) {
		errorMessage.value = "Die Datei gibt es nicht (mehr), oder du hast keinen Zugriff darauf.";
		return null;
	}
	return result.data;
});

useSeoMeta({ title: () => file.value?.name ?? "Datei" });

// --- where it lives ------------------------------------------------------------------------------

/** The library page the file was opened from, or the one it belongs to. */
const LIBRARY_PAGE = /^\/(core-team\/)?documents$|^\/events\/\d+\/documents$/;
const libraryPage = computed(() => {
	const from = route.query.from;
	if (typeof from === "string" && LIBRARY_PAGE.test(from)) return from;
	const current = file.value;
	if (current?.scope === "event" && current.event_id) return `/events/${current.event_id}/documents`;
	if (current?.scope === "org") return "/documents";
	return null;
});

function folderLink(folderId: number | null) {
	const base = libraryPage.value;
	if (!base) return undefined;
	return folderId ? `${base}?folder=${folderId}` : base;
}

const backLink = computed(() => folderLink(file.value?.parent_id ?? null) ?? "/");

// Folders open in their library.
watch(
	file,
	(current) => {
		if (current?.kind === "folder") {
			const target = folderLink(current.id);
			if (target) void navigateTo(target, { replace: true });
		}
	},
	{ immediate: true },
);

/** "Sommerlager › Dokumente › Planung" under the name. */
const locationItems = computed(() => {
	const current = file.value;
	if (!current) return [];
	const folders = current.path.map((folder) => ({ label: folder.name, to: folderLink(folder.id) }));
	if (current.scope === "event" && current.event) {
		return [
			{ label: current.event.name, to: `/events/${current.event.id}` },
			{ label: "Dokumente", to: folderLink(null) },
			...folders,
		];
	}
	if (current.scope === "org") {
		const label = libraryPage.value === "/core-team/documents" ? "Ablage" : "Bibliothek";
		return [{ label, to: folderLink(null) }, ...folders];
	}
	return [];
});

const icon = computed(() =>
	file.value ? Utils.getFileIcon(file.value.name, file.value.mime_type) : "i-lucide-file",
);

// --- what it is, what the caller may do ------------------------------------------------------------

const canRead = computed(() => Boolean(file.value?.permissions?.read && file.value.content_url));
const canEdit = computed(() => Boolean(file.value?.permissions?.edit));
const kind = computed(() =>
	file.value ? filePreviewKind(file.value.name, file.value.mime_type) : "none",
);
/** Types the browser shows itself can also open in a new tab. */
const opensInBrowser = computed(() =>
	["pdf", "image", "text", "markdown", "csv"].includes(kind.value),
);
const officeAvailable = computed(
	() =>
		useInstance().value?.office === true && kind.value === "office" && file.value?.kind === "file",
);
/** How the office editor opened (it decides by the caller's rights). */
const officeMode = ref<"edit" | "view" | null>(null);

// --- an earlier version (`?version=`) ------------------------------------------------------------

const versionId = computed(() => {
	const value = Number(route.query.version);
	return Number.isInteger(value) && value > 0 ? value : null;
});
const version = ref<Version | null>(null);

watch(
	[versionId, () => file.value?.id],
	async ([id, current]) => {
		version.value = null;
		if (!id || !current) return;
		const result = await useAPI((api) => api.getFilesByFileIdVersions({ path: { fileId: current } }));
		version.value = result.success ? (result.data.find((entry) => entry.id === id) ?? null) : null;
		if (!version.value) {
			toast.add({ title: "Diese Version gibt es nicht (mehr)", color: "warning" });
			void showCurrent();
		}
	},
	{ immediate: true },
);

async function showCurrent() {
	const { version: _version, ...query } = route.query;
	await router.replace({ query });
}

const restoring = ref(false);
async function restoreVersion() {
	const current = file.value;
	const shown = version.value;
	if (!current || !shown) return;
	const choice = await confirm({
		title: "Version wiederherstellen?",
		description: `Die Fassung vom ${formatDate(shown.modified_at)} wird wieder die aktuelle. Die jetzige bleibt als Version erhalten.`,
		icon: "i-lucide-history",
		confirmLabel: "Wiederherstellen",
		confirmIcon: "i-lucide-history",
	});
	if (choice !== "confirm") return;
	restoring.value = true;
	const result = await useAPI((api) =>
		api.postFilesByFileIdVersionsByVersionIdRestore({
			path: { fileId: current.id, versionId: shown.id },
		}),
	);
	restoring.value = false;
	if (!result.success) {
		toast.add({
			title: "Wiederherstellen fehlgeschlagen",
			description:
				(result as { code?: number }).code === 409
					? "Die Datei wird gerade in Office bearbeitet."
					: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Version wiederhergestellt", color: "success", icon: "i-lucide-check" });
	await showCurrent();
	await refresh();
}

/** What is shown: the current contents or the version. */
const shown = computed(() => {
	const current = file.value;
	if (!current?.content_url) return null;
	if (version.value) {
		return {
			url: version.value.content_url,
			mimeType: version.value.mime_type,
			size: version.value.size,
		};
	}
	return { url: current.content_url, mimeType: current.mime_type, size: current.size };
});
const showOffice = computed(() => officeAvailable.value && !versionId.value);

// --- new contents, versions ----------------------------------------------------------------------

const versionsOpen = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function onUpload(event: Event) {
	const input = event.target as HTMLInputElement;
	const upload = input.files?.[0];
	input.value = "";
	const current = file.value;
	if (!upload || !current) return;
	uploading.value = true;
	const result = await useAPI((api) =>
		api.putFilesByFileIdContent({ path: { fileId: current.id }, body: { file: upload } }),
	);
	uploading.value = false;
	if (!result.success) {
		toast.add({
			title: "Neue Fassung nicht hochgeladen",
			description:
				(result as { code?: number }).code === 409
					? "Die Datei wird gerade in Office bearbeitet."
					: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Neue Fassung hochgeladen", color: "success", icon: "i-lucide-check" });
	await refresh();
}

const moreActions = computed<DropdownMenuItem[][]>(() => {
	const current = shown.value;
	if (!current) return [];
	return [
		[
			...(opensInBrowser.value
				? [
						{
							label: "In neuem Tab öffnen",
							icon: "i-lucide-external-link",
							to: fileURL(current.url),
							target: "_blank",
						},
					]
				: []),
			{ label: "Versionen", icon: "i-lucide-history", onSelect: () => (versionsOpen.value = true) },
		],
		...(canEdit.value
			? [
					[
						{
							label: "Neue Fassung hochladen",
							icon: "i-lucide-file-up",
							disabled: Boolean(file.value?.editing),
							onSelect: () => uploadInput.value?.click(),
						},
					],
				]
			: []),
	];
});
</script>

<template>
	<div class="flex min-h-0 flex-1 flex-col">
		<header class="flex h-14 shrink-0 items-center gap-2 border-b border-slate-800 px-2 sm:px-3">
			<UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Zurück" :to="backLink" />
			<UIcon :name="icon" class="hidden size-5 shrink-0 text-slate-400 sm:block" />
			<div class="min-w-0 flex-1 leading-tight">
				<h1 class="truncate text-sm font-medium text-white">{{ file?.name ?? "Datei" }}</h1>
				<nav v-if="locationItems.length" class="hidden truncate text-xs text-slate-500 sm:block" aria-label="Ablageort">
					<template v-for="(entry, index) in locationItems" :key="index">
						<span v-if="index > 0" class="px-1">›</span>
						<NuxtLink v-if="entry.to" :to="entry.to" class="hover:text-slate-300">{{ entry.label }}</NuxtLink>
						<span v-else>{{ entry.label }}</span>
					</template>
				</nav>
			</div>

			<template v-if="file && canRead && shown">
				<UBadge
					v-if="showOffice && officeMode"
					:label="officeMode === 'edit' ? 'Bearbeiten' : 'Nur ansehen'"
					:icon="officeMode === 'edit' ? 'i-lucide-pencil' : 'i-lucide-eye'"
					color="neutral"
					variant="subtle"
					class="hidden sm:inline-flex"
				/>
				<UButton
					icon="i-lucide-download"
					label="Herunterladen"
					color="neutral"
					variant="subtle"
					:to="fileURL(shown.url, true)"
					target="_blank"
					:ui="{ label: 'hidden md:inline' }"
				/>
				<UDropdownMenu :items="moreActions" :ui="{ viewport: 'main-bg-color' }">
					<UButton
						icon="i-lucide-ellipsis-vertical"
						color="neutral"
						variant="ghost"
						aria-label="Weitere Aktionen"
						:loading="uploading"
					/>
				</UDropdownMenu>
				<input ref="uploadInput" type="file" class="hidden" @change="onUpload" />
			</template>
		</header>

		<div
			v-if="version"
			class="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"
		>
			<UIcon name="i-lucide-history" class="size-4 shrink-0 text-amber-400" />
			<span class="min-w-0 flex-1 text-amber-100">
				Ältere Fassung vom {{ formatDate(version.modified_at) }}
				<template v-if="version.modified_by">· {{ version.modified_by.display_name }}</template>
			</span>
			<UButton
				v-if="canEdit"
				label="Wiederherstellen"
				icon="i-lucide-history"
				color="warning"
				variant="subtle"
				size="sm"
				:loading="restoring"
				:disabled="Boolean(file?.editing)"
				@click="restoreVersion"
			/>
			<UButton label="Aktuelle Fassung" color="neutral" variant="ghost" size="sm" @click="showCurrent" />
		</div>

		<main class="relative min-h-0 flex-1">
			<div v-if="loading && !file" class="flex h-full items-center justify-center">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
			</div>

			<div v-else-if="!file || !canRead || !shown" class="flex h-full items-center justify-center p-4">
				<UEmpty
					icon="i-lucide-file-x"
					title="Datei nicht verfügbar"
					:description="errorMessage || 'Du kannst diese Datei nicht öffnen.'"
					:actions="[{ label: 'Zurück', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle', to: backLink }]"
				/>
			</div>

			<FilesOfficeFrame v-else-if="showOffice" :key="file.id" :file-id="file.id" @mode="officeMode = $event" />

			<div v-else-if="versionId && !version" class="flex h-full items-center justify-center">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
			</div>

			<FilesPreview
				v-else
				:key="`${file.id}-${version?.id ?? file.updated_at}`"
				fill
				:url="fileURL(shown.url) as string"
				:download-url="fileURL(shown.url, true)"
				:name="file.name"
				:mime-type="shown.mimeType"
				:size="shown.size"
				:fallback-hint="kind === 'office' ? 'Lade die Datei herunter, um sie zu öffnen.' : undefined"
			/>
		</main>

		<FilesVersionsModal v-model:open="versionsOpen" :item="file ?? null" @restored="refresh" />
	</div>
</template>
