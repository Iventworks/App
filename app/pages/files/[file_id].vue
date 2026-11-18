<script setup lang="ts">
/**
 * One file in the app: a preview by type (`FilesPreview`: PDF, images, Markdown, CSV, text),
 * where it lives (breadcrumb back into the folder) and the download. Opened from the file
 * browsers (`?from=` names the library page it came from, so the breadcrumb leads back there);
 * works for every file the caller may open — the API checks access.
 */
import type { BreadcrumbItem } from "@nuxt/ui";
import { Utils } from "~/utils";
import { filePreviewKind } from "~/utils/filePreview";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const fileURL = useFileURL();

const fileId = computed(() => Number(route.params.file_id));
const errorMessage = ref("");

const { data: file, loading } = await useAPIAsyncData(`file-${fileId.value}`, async () => {
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

const breadcrumb = computed<BreadcrumbItem[]>(() => {
	const current = file.value;
	if (!current) return [];
	const folders = current.path.map((folder) => ({ label: folder.name, to: folderLink(folder.id) }));
	const leaf = { label: current.name };
	if (current.scope === "event" && current.event) {
		return [
			{ label: current.event.name, to: `/events/${current.event.id}` },
			{ label: "Dokumente", to: folderLink(null) },
			...folders,
			leaf,
		];
	}
	if (current.scope === "org") {
		const label = libraryPage.value === "/core-team/documents" ? "Ablage" : "Bibliothek";
		return [{ label, to: folderLink(null) }, ...folders, leaf];
	}
	return [leaf];
});

const icon = computed(() =>
	file.value ? Utils.getFileIcon(file.value.name, file.value.mime_type) : "i-lucide-file",
);

const canRead = computed(() => Boolean(file.value?.permissions?.read && file.value.content_url));
/** Types the browser shows itself (PDF, images, text) can also open in a new tab. */
const opensInBrowser = computed(() => {
	const current = file.value;
	if (!current) return false;
	return ["pdf", "image", "text"].includes(filePreviewKind(current.name, current.mime_type));
});
</script>

<template>
	<UDashboardPanel id="file">
		<template #header>
			<DashboardPageHeader
				:title="file?.name ?? 'Datei'"
				:icon="icon"
				:breadcrumb-items="breadcrumb"
			>
				<template v-if="file && canRead" #right>
					<UButton
						v-if="file.parent_id !== null || libraryPage"
						icon="i-lucide-arrow-left"
						label="Zum Ordner"
						color="neutral"
						variant="ghost"
						class="hidden sm:inline-flex"
						:to="folderLink(file.parent_id)"
					/>
					<UButton
						v-if="opensInBrowser"
						icon="i-lucide-external-link"
						color="neutral"
						variant="subtle"
						aria-label="In neuem Tab öffnen"
						:to="fileURL(file.content_url)"
						target="_blank"
					/>
					<UButton
						icon="i-lucide-download"
						label="Herunterladen"
						color="neutral"
						variant="subtle"
						:to="fileURL(file.content_url, true)"
						target="_blank"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !file" class="flex justify-center py-16">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!file || !canRead"
					icon="i-lucide-file-x"
					title="Datei nicht verfügbar"
					:description="errorMessage || 'Du kannst diese Datei nicht öffnen.'"
				/>

				<FilesPreview
					v-else-if="file.kind === 'file'"
					:key="file.id"
					:url="fileURL(file.content_url) as string"
					:download-url="fileURL(file.content_url, true)"
					:name="file.name"
					:mime-type="file.mime_type"
					:size="file.size"
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
