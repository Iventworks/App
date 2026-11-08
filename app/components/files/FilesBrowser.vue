<script setup lang="ts">
/**
 * Folder/file browser for the organisation library and event documents.
 *
 * The page passes the location-specific calls (list, upload, create folder); rename, move and
 * delete go through the shared `/files/{fileId}` API. The open folder lives in `?folder=` so the
 * browser's back button works. Items can be moved by dragging them onto a folder or a
 * breadcrumb entry; files can be dropped from the desktop to upload.
 */
import type { BreadcrumbItem, DropdownMenuItem } from "@nuxt/ui";
import { Utils } from "~/utils";
import type { FileItem, FolderListing } from "~/utils/types";

const props = withDefaults(
	defineProps<{
		/** Root label in the breadcrumb, e.g. "Dokumente". */
		rootLabel?: string;
		load: (parentId: number | null) => Promise<FolderListing | null>;
		upload?: (file: File, parentId: number | null) => Promise<boolean>;
		createFolder?: (name: string, parentId: number | null) => Promise<boolean>;
		/** Show upload / new folder controls. */
		canWrite?: boolean;
		/** Whether the caller may rename/move/delete this item. */
		canManage?: (item: FileItem) => boolean;
		emptyDescription?: string;
	}>(),
	{
		rootLabel: "Dokumente",
		upload: undefined,
		createFolder: undefined,
		canWrite: false,
		canManage: () => false,
		emptyDescription: "Hier wurden noch keine Dateien abgelegt.",
	},
);

const route = useRoute();
const router = useRouter();
const toast = useToast();
const fileURL = useFileURL();

const folderId = computed(() => {
	const raw = Number(route.query.folder);
	return Number.isInteger(raw) && raw > 0 ? raw : null;
});

const listing = ref<FolderListing | null>(null);
const loading = ref(false);
const search = ref("");

async function refresh() {
	loading.value = true;
	listing.value = await props.load(folderId.value);
	loading.value = false;
}

watch(folderId, refresh, { immediate: true });

function openFolder(id: number | null) {
	search.value = "";
	const query = { ...route.query };
	if (id) query.folder = String(id);
	else delete query.folder;
	return router.push({ query });
}

const breadcrumb = computed<BreadcrumbItem[]>(() => [
	{
		label: props.rootLabel,
		icon: "i-lucide-folder-root",
		onClick: () => openFolder(null),
	},
	...(listing.value?.path ?? []).map((folder) => ({
		label: folder.name,
		onClick: () => openFolder(folder.id),
	})),
]);

const items = computed(() => {
	const all = listing.value?.items ?? [];
	const term = search.value.trim().toLowerCase();
	return term ? all.filter((item) => item.name.toLowerCase().includes(term)) : all;
});

// --- upload -----------------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(0);

async function uploadFiles(files: File[] | FileList | null) {
	if (!files || !props.upload || !props.canWrite) return;
	const list = Array.from(files);
	uploading.value += list.length;
	let failed = 0;
	for (const file of list) {
		const ok = await props.upload(file, folderId.value);
		if (!ok) failed++;
		uploading.value--;
	}
	if (failed === 0) {
		toast.add({
			title: list.length === 1 ? "Datei hochgeladen" : `${list.length} Dateien hochgeladen`,
			color: "success",
			icon: "i-lucide-check",
		});
	}
	await refresh();
}

function onFileInput(event: Event) {
	const input = event.target as HTMLInputElement;
	void uploadFiles(input.files);
	input.value = "";
}

// Upload by dropping files from the desktop anywhere on the browser. Hand-written instead of
// VueUse's `useDropZone`: that one rejects internal item drags with `dropEffect = "none"` on
// `dragenter`, which also cancels moving items into folders.
const isOverDropZone = ref(false);
let dropZoneDepth = 0;

function isDesktopFileDrag(event: DragEvent) {
	return (
		!draggedItem.value &&
		Boolean(props.canWrite && props.upload) &&
		Boolean(event.dataTransfer?.types.includes("Files"))
	);
}

function onZoneDragEnter(event: DragEvent) {
	if (!isDesktopFileDrag(event)) return;
	event.preventDefault();
	dropZoneDepth++;
	isOverDropZone.value = true;
}

function onZoneDragOver(event: DragEvent) {
	if (!isDesktopFileDrag(event)) return;
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function onZoneDragLeave(event: DragEvent) {
	if (!isDesktopFileDrag(event)) return;
	dropZoneDepth = Math.max(0, dropZoneDepth - 1);
	if (dropZoneDepth === 0) isOverDropZone.value = false;
}

function onZoneDrop(event: DragEvent) {
	if (!isDesktopFileDrag(event)) return;
	event.preventDefault();
	dropZoneDepth = 0;
	isOverDropZone.value = false;
	void uploadFiles(event.dataTransfer?.files ?? null);
}

// --- new folder / rename ------------------------------------------------------------------

const folderModalOpen = ref(false);
const folderName = ref("");
const renameTarget = ref<FileItem | null>(null);
const saving = ref(false);

function openNewFolder() {
	renameTarget.value = null;
	folderName.value = "";
	folderModalOpen.value = true;
}

function openRename(item: FileItem) {
	renameTarget.value = item;
	folderName.value = item.name;
	folderModalOpen.value = true;
}

async function submitFolderModal() {
	const name = folderName.value.trim();
	if (!name) return;
	saving.value = true;

	if (renameTarget.value) {
		const target = renameTarget.value;
		const result = await useAPI((api) =>
			api.putFilesByFileId({ path: { fileId: target.id }, body: { name } }),
		);
		if (!result.success) {
			toast.add({ title: "Umbenennen fehlgeschlagen", description: result.message, color: "error" });
		}
	} else if (props.createFolder) {
		await props.createFolder(name, folderId.value);
	}

	saving.value = false;
	folderModalOpen.value = false;
	await refresh();
}

// --- move (drag & drop) -------------------------------------------------------------------

const draggedItem = ref<FileItem | null>(null);
const dropTargetId = ref<number | "root" | null>(null);

function onItemDragStart(event: DragEvent, item: FileItem) {
	if (!props.canManage(item)) return;
	draggedItem.value = item;
	event.dataTransfer?.setData("application/x-cmp-file", String(item.id));
	if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragEnd() {
	draggedItem.value = null;
	dropTargetId.value = null;
}

function canDropOn(targetId: number | null) {
	const item = draggedItem.value;
	return Boolean(item && item.id !== targetId && item.parent_id !== targetId);
}

/** `dragenter` and `dragover` on a folder row or breadcrumb: both must be cancelled to allow a drop. */
function onDragOver(event: DragEvent, targetId: number | null) {
	if (!canDropOn(targetId)) return;
	event.preventDefault();
	dropTargetId.value = targetId ?? "root";
}

function onItemDrop(event: DragEvent, item: FileItem) {
	// Desktop files dropped on a row bubble up to the upload handler on the container.
	if (!draggedItem.value) return;
	event.preventDefault();
	if (item.kind === "folder") void onDropOnFolder(item.id);
	else onDragEnd();
}

async function onDropOnFolder(targetId: number | null) {
	const item = draggedItem.value;
	// Check before `onDragEnd()`: `canDropOn` reads the dragged item.
	const allowed = canDropOn(targetId);
	onDragEnd();
	if (!item || !allowed) return;

	const result = await useAPI((api) =>
		api.putFilesByFileId({ path: { fileId: item.id }, body: { parent_id: targetId } }),
	);
	if (result.success) {
		toast.add({
			title: `„${item.name}“ verschoben`,
			color: "success",
			icon: "i-lucide-folder-input",
		});
		await refresh();
	} else {
		toast.add({ title: "Verschieben fehlgeschlagen", description: result.message, color: "error" });
	}
}

// --- delete ---------------------------------------------------------------------------------

const deleteTarget = ref<FileItem | null>(null);
const deleteOpen = ref(false);

function openDelete(item: FileItem) {
	deleteTarget.value = item;
	deleteOpen.value = true;
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) => api.deleteFilesByFileId({ path: { fileId: target.id } }));
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `„${target.name}“ gelöscht`, color: "success" });
	await refresh();
}

// --- row actions ----------------------------------------------------------------------------

function itemActions(item: FileItem): DropdownMenuItem[][] {
	const open: DropdownMenuItem[] =
		item.kind === "folder"
			? [{ label: "Öffnen", icon: "i-lucide-folder-open", onSelect: () => openFolder(item.id) }]
			: [
					{
						label: "Öffnen",
						icon: "i-lucide-external-link",
						to: fileURL(item.download_token),
						target: "_blank",
					},
					{
						label: "Herunterladen",
						icon: "i-lucide-download",
						to: fileURL(item.download_token, true),
						target: "_blank",
					},
				];

	if (!props.canManage(item)) return [open];

	return [
		open,
		[
			{ label: "Umbenennen", icon: "i-lucide-pencil", onSelect: () => openRename(item) },
			...(listing.value?.folder
				? [
						{
							label: "Eine Ebene nach oben",
							icon: "i-lucide-arrow-up-left",
							onSelect: () => onMoveUp(item),
						},
					]
				: []),
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => openDelete(item),
			},
		],
	];
}

async function onMoveUp(item: FileItem) {
	draggedItem.value = item;
	await onDropOnFolder(listing.value?.folder?.parent_id ?? null);
}

function onRowClick(item: FileItem) {
	if (item.kind === "folder") {
		void openFolder(item.id);
	} else if (item.download_token) {
		window.open(fileURL(item.download_token), "_blank", "noopener");
	}
}

defineExpose({ refresh });
</script>

<template>
	<div
		class="relative space-y-4"
		@dragenter="onZoneDragEnter"
		@dragover="onZoneDragOver"
		@dragleave="onZoneDragLeave"
		@drop="onZoneDrop"
	>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 flex-wrap items-center gap-1">
				<template v-for="(crumb, index) in breadcrumb" :key="index">
					<UIcon v-if="index > 0" name="i-lucide-chevron-right" class="size-4 text-slate-600" />
					<button
						type="button"
						:class="[
							'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition',
							index === breadcrumb.length - 1 ? 'font-medium text-white' : 'text-slate-400 hover:text-white',
							dropTargetId === (index === 0 ? 'root' : listing?.path[index - 1]?.id)
								? 'bg-primary/15 ring-1 ring-primary'
								: '',
						]"
						@click="crumb.onClick?.($event as any)"
						@dragenter="onDragOver($event, index === 0 ? null : (listing?.path[index - 1]?.id ?? null))"
						@dragover="onDragOver($event, index === 0 ? null : (listing?.path[index - 1]?.id ?? null))"
						@dragleave="dropTargetId = null"
						@drop="draggedItem && ($event.preventDefault(), onDropOnFolder(index === 0 ? null : (listing?.path[index - 1]?.id ?? null)))"
					>
						<UIcon v-if="crumb.icon" :name="crumb.icon" class="size-4" />
						{{ crumb.label }}
					</button>
				</template>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<UInput v-model="search" icon="i-lucide-search" placeholder="In diesem Ordner suchen" class="w-full sm:w-56" />
				<template v-if="canWrite">
					<UButton
						v-if="createFolder"
						label="Ordner"
						icon="i-lucide-folder-plus"
						color="neutral"
						variant="subtle"
						@click="openNewFolder"
					/>
					<UButton
						v-if="upload"
						label="Hochladen"
						icon="i-lucide-upload"
						:loading="uploading > 0"
						@click="fileInput?.click()"
					/>
					<input ref="fileInput" type="file" multiple class="hidden" @change="onFileInput" />
				</template>
			</div>
		</div>

		<UCard class="border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
			<div v-if="loading && !listing" class="flex justify-center py-12">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
			</div>

			<UEmpty
				v-else-if="!items.length"
				icon="i-lucide-folder-open"
				:title="search ? 'Nichts gefunden' : 'Leerer Ordner'"
				:description="search ? 'Keine Datei passt zu deiner Suche.' : emptyDescription"
				variant="naked"
				class="py-10"
			/>

			<ul v-else class="divide-y divide-slate-800">
				<li
					v-for="item in items"
					:key="item.id"
					:draggable="canManage(item)"
					:class="[
						'group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-800/40',
						dropTargetId === item.id ? 'bg-primary/10 ring-1 ring-inset ring-primary' : '',
						draggedItem?.id === item.id ? 'opacity-50' : '',
					]"
					@click="onRowClick(item)"
					@dragstart="onItemDragStart($event, item)"
					@dragend="onDragEnd"
					@dragenter="item.kind === 'folder' && onDragOver($event, item.id)"
					@dragover="item.kind === 'folder' && onDragOver($event, item.id)"
					@dragleave="dropTargetId = null"
					@drop="onItemDrop($event, item)"
				>
					<UIcon
						:name="item.kind === 'folder' ? 'i-lucide-folder' : Utils.getFileIcon(item.name, item.mime_type)"
						:class="['size-5 shrink-0', item.kind === 'folder' ? 'text-amber-400' : 'text-slate-400']"
					/>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium text-white">{{ item.name }}</p>
						<p class="text-xs text-slate-500">
							<template v-if="item.kind === 'file'">{{ formatFileSize(item.size) }} · </template>
							{{ formatDate(item.updated_at) }}
						</p>
					</div>
					<UDropdownMenu :items="itemActions(item)" :ui="{ viewport: 'main-bg-color' }">
						<UButton
							icon="i-lucide-ellipsis-vertical"
							color="neutral"
							variant="ghost"
							size="sm"
							aria-label="Aktionen"
							@click.stop
						/>
					</UDropdownMenu>
				</li>
			</ul>
		</UCard>

		<p v-if="canWrite" class="text-xs text-slate-500">
			Tipp: Dateien vom Computer hierher ziehen, um sie hochzuladen. Einträge auf einen Ordner oder
			den Pfad oben ziehen, um sie zu verschieben.
		</p>

		<div
			v-if="canWrite && upload && isOverDropZone"
			class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10"
		>
			<p class="flex items-center gap-2 font-medium text-primary-300">
				<UIcon name="i-lucide-upload" class="size-5" /> Zum Hochladen loslassen
			</p>
		</div>

		<DashboardModal
			v-model:open="folderModalOpen"
			:title="renameTarget ? 'Umbenennen' : 'Neuer Ordner'"
			:icon="renameTarget ? 'i-lucide-pencil' : 'i-lucide-folder-plus'"
		>
			<form class="space-y-4" @submit.prevent="submitFolderModal">
				<UFormField label="Name" required>
					<UInput v-model="folderName" autofocus class="w-full" />
				</UFormField>
				<div class="flex justify-end gap-2">
					<UButton label="Abbrechen" color="neutral" variant="ghost" @click="folderModalOpen = false" />
					<UButton type="submit" :label="renameTarget ? 'Speichern' : 'Anlegen'" :loading="saving" />
				</div>
			</form>
		</DashboardModal>

		<DashboardDeleteModal
			v-model:open="deleteOpen"
			:title="deleteTarget?.kind === 'folder' ? 'Ordner löschen' : 'Datei löschen'"
			:warning-text="
				deleteTarget?.kind === 'folder'
					? `Der Ordner „${deleteTarget?.name}“ und alles darin wird gelöscht.`
					: `„${deleteTarget?.name}“ wird gelöscht.`
			"
			:require-confirm-text="deleteTarget?.kind === 'folder'"
			:on-delete="confirmDelete"
		/>
	</div>
</template>
