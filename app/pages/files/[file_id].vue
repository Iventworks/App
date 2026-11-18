<script setup lang="ts">
/**
 * One file in the app: a preview by type (`FilesPreview`: PDF, images, Markdown, CSV, text),
 * where it lives (breadcrumb back into the folder), download, versions and "Neue Fassung".
 * Markdown documents are edited here together, live (`FilesCollabEditor`; `?edit=1` opens the
 * editor right away). Opened from the file browsers (`?from=` names the library page it
 * came from, so the breadcrumb leads back there); works for every file the caller may open — the
 * API checks access.
 */
import type { BreadcrumbItem, DropdownMenuItem } from "@nuxt/ui";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import { Utils } from "~/utils";
import { filePreviewKind } from "~/utils/filePreview";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const router = useRouter();
const toast = useToast();
const fileURL = useFileURL();
const user = await useUserInfoStore().use();

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
const canEdit = computed(() => Boolean(file.value?.permissions?.edit));
const kind = computed(() =>
	file.value ? filePreviewKind(file.value.name, file.value.mime_type) : "none",
);
/** Types the browser shows itself (PDF, images, text) can also open in a new tab. */
const opensInBrowser = computed(() => ["pdf", "image", "text"].includes(kind.value));
const isMarkdown = computed(() => kind.value === "markdown" && file.value?.kind === "file");
/** Office documents open in the office server's editor (when one is configured). */
const officeAvailable = computed(
	() =>
		useInstance().value?.office === true && kind.value === "office" && file.value?.kind === "file",
);
const officeOpen = ref(false);

async function closeOffice() {
	officeOpen.value = false;
	await refresh();
	if (route.query.office) {
		const { office: _office, ...query } = route.query;
		await router.replace({ query });
	}
}

/** A session is running (shared editing: join it) or the office server has the file (blocked). */
const editingNow = computed(() => (editing.value ? null : (file.value?.editing ?? null)));
const blockedByOffice = computed(() => editingNow.value?.kind === "office");

// --- editing (Markdown, together) ------------------------------------------------------------

const editing = ref(false);
const editorRef = ref<{ flush: () => Promise<boolean> } | null>(null);

function startEditing() {
	if (!isMarkdown.value || !canEdit.value || blockedByOffice.value) return;
	editing.value = true;
}

async function stopEditing() {
	editing.value = false;
	await refresh();
	if (route.query.edit) {
		const { edit: _edit, ...query } = route.query;
		await router.replace({ query });
	}
}

// `?edit=1` / `?office=1`: straight into the editor (new documents).
watch(
	file,
	(current) => {
		if (!current) return;
		if (route.query.edit === "1" && !editing.value) startEditing();
		if (route.query.office === "1" && officeAvailable.value && !officeOpen.value)
			officeOpen.value = true;
	},
	{ immediate: true },
);

const askUnsaved = useUnsavedChangesDialog();
onBeforeRouteLeave(async () => {
	if (!editing.value || !editorRef.value) return true;
	if (await editorRef.value.flush()) return true;
	const choice = await askUnsaved("Deine letzten Änderungen konnten nicht gespeichert werden.", {
		canSave: false,
	});
	return choice === "discard";
});

const editingNames = computed(() =>
	(editingNow.value?.users ?? []).map((person) => person.display_name.split(" ")[0]).join(", "),
);

// --- new contents, versions ---------------------------------------------------------------------

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
					? "Die Datei wird gerade bearbeitet."
					: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Neue Fassung hochgeladen", color: "success", icon: "i-lucide-check" });
	await refresh();
}

const moreActions = computed<DropdownMenuItem[][]>(() => {
	const current = file.value;
	if (!current) return [];
	return [
		[
			...(opensInBrowser.value
				? [
						{
							label: "In neuem Tab öffnen",
							icon: "i-lucide-external-link",
							to: fileURL(current.content_url),
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
							disabled: Boolean(editingNow.value) || editing.value,
							onSelect: () => uploadInput.value?.click(),
						},
					],
				]
			: []),
	];
});
</script>

<template>
	<UDashboardPanel id="file">
		<template #header>
			<DashboardPageHeader :title="file?.name ?? 'Datei'" :icon="icon" :breadcrumb-items="breadcrumb">
				<template v-if="file && canRead && !editing && !officeOpen" #right>
					<UButton
						v-if="file.parent_id !== null || libraryPage"
						icon="i-lucide-arrow-left"
						label="Zum Ordner"
						color="neutral"
						variant="ghost"
						class="hidden lg:inline-flex"
						:to="folderLink(file.parent_id)"
					/>
					<UButton
						v-if="isMarkdown && canEdit"
						icon="i-lucide-pencil"
						:label="editingNow?.kind === 'editor' ? 'Mitbearbeiten' : 'Bearbeiten'"
						:disabled="blockedByOffice"
						@click="startEditing"
					/>
					<UButton
						v-if="officeAvailable"
						icon="i-lucide-file-pen-line"
						:label="canEdit ? 'In Office öffnen' : 'In Office ansehen'"
						@click="officeOpen = true"
					/>
					<UButton
						icon="i-lucide-download"
						:label="(isMarkdown && canEdit) || officeAvailable ? undefined : 'Herunterladen'"
						aria-label="Herunterladen"
						color="neutral"
						variant="subtle"
						:to="fileURL(file.content_url, true)"
						target="_blank"
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

				<template v-else-if="file.kind === 'file'">
					<UAlert
						v-if="editingNow && !officeOpen"
						icon="i-lucide-pencil"
						:color="blockedByOffice ? 'warning' : 'info'"
						variant="subtle"
						:title="
							blockedByOffice
								? 'Wird gerade in Office bearbeitet'
								: `${editingNames || 'Jemand'} ${editingNow.users.length > 1 ? 'bearbeiten' : 'bearbeitet'} dieses Dokument gerade`
						"
						:description="
							blockedByOffice && officeAvailable
								? 'Öffne die Datei in Office, um mitzuarbeiten. Neue Fassungen hochladen geht erst wieder, wenn sie frei ist.'
								: blockedByOffice || !(isMarkdown && canEdit)
									? 'Du siehst die zuletzt gespeicherte Fassung. Neue Fassungen sind erst wieder möglich, wenn das Dokument frei ist.'
									: 'Du siehst die zuletzt gespeicherte Fassung – mit „Mitbearbeiten“ schreibst du live mit.'
						"
						:actions="[
							{ label: 'Neu laden', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'subtle', onClick: () => refresh() },
						]"
					/>

					<FilesOfficeFrame v-if="officeOpen" :file-id="file.id" @close="closeOffice" />
					<FilesCollabEditor
						v-else-if="editing && file.content_url"
						ref="editorRef"
						:file-id="file.id"
						:content-url="fileURL(file.content_url) as string"
						:user-name="user?.display_name ?? 'Ich'"
						@close="stopEditing"
					/>
					<FilesPreview
						v-else
						:key="`${file.id}-${file.updated_at}`"
						:url="fileURL(file.content_url) as string"
						:download-url="fileURL(file.content_url, true)"
						:name="file.name"
						:mime-type="file.mime_type"
						:size="file.size"
						:fallback-hint="officeAvailable ? 'Öffne die Datei oben mit „In Office öffnen“.' : undefined"
					/>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<FilesVersionsModal v-model:open="versionsOpen" :item="file ?? null" @restored="refresh" />
</template>
