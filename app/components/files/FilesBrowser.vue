<script setup lang="ts">
/**
 * Folder/file browser for the organisation library and event documents.
 *
 * The page passes the location-specific calls (list, upload, create folder); rename, move,
 * delete, access and share links go through the shared `/files/{fileId}` API. What the caller may
 * do comes with the listing (`permissions` of the folder and of every item). Managers of the
 * library (`permissions.manage`: Kernteam / Leitung, not in the member view of `/documents`) see
 * who has access to each item and the folder, and get "Zugriff" to change it and — while the org
 * allows share links — "Teilen".
 *
 * Files open on the in-app file page (`/files/{id}`, previews). The open folder lives in
 * `?folder=` so the browser's back button works. Items can be moved by
 * dragging them onto a folder or a breadcrumb entry; files can be dropped from the desktop to
 * upload.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import { Utils } from "~/utils";
import type {
	FileAccessEntry,
	FileItem,
	FolderListing,
	OfficeType,
	TrashAdapter,
} from "~/utils/types";

const props = withDefaults(
	defineProps<{
		/** Root label in the breadcrumb, e.g. "Dokumente". */
		rootLabel?: string;
		/** Whose library it is: labels like "Nur Kernteam" / "Nur Leitung". */
		scope: "org" | "event";
		load: (parentId: number | null) => Promise<FolderListing | null>;
		upload?: (file: File, parentId: number | null) => Promise<boolean>;
		createFolder?: (name: string, parentId: number | null) => Promise<boolean>;
		/** Create an empty office document; it then opens in the office editor. */
		createOffice?: (
			name: string,
			type: OfficeType,
			parentId: number | null,
		) => Promise<FileItem | null>;
		/** The library's Papierkorb (deleting moves items there). */
		trash?: TrashAdapter;
		emptyDescription?: string;
	}>(),
	{
		rootLabel: "Dokumente",
		upload: undefined,
		createFolder: undefined,
		createOffice: undefined,
		trash: undefined,
		emptyDescription: "Hier wurden noch keine Dateien abgelegt.",
	},
);

const route = useRoute();
const router = useRouter();
const toast = useToast();
const fileURL = useFileURL();
const shareLinksAllowed = useShareLinksAllowed();
const managers = computed(() => managersOf(props.scope));

const folderId = computed(() => {
	const raw = Number(route.query.folder);
	return Number.isInteger(raw) && raw > 0 ? raw : null;
});

const listing = ref<FolderListing | null>(null);
const loading = ref(false);
const search = ref("");

/** Counts loads: only the latest one may fill the list (folders can be opened faster than they load). */
let loads = 0;

async function refresh() {
	const current = ++loads;
	loading.value = true;
	const result = await props.load(folderId.value);
	if (current !== loads) return;
	listing.value = result;
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

const folderPermissions = computed(() => listing.value?.permissions ?? null);
/** May add files and folders here. */
const canAdd = computed(() => Boolean(folderPermissions.value?.upload));
/** An upload-only folder ("Nur hochladen"): the caller doesn't see what is inside. */
const uploadOnly = computed(() =>
	Boolean(folderPermissions.value?.upload && !folderPermissions.value.read),
);
/** Managers of the library (not in the member view): access lists, "Zugriff", "Teilen". */
const showAccess = computed(() => Boolean(folderPermissions.value?.manage));
const onlyManagersLabel = computed(() => `Nur ${managers.value.name}`);

/** The path to the open folder; `id` null is the top level. Entries are drop targets too. */
const breadcrumb = computed<{ id: number | null; label: string; icon?: string }[]>(() => [
	{ id: null, label: props.rootLabel, icon: "i-lucide-folder-root" },
	...(listing.value?.path ?? []).map((folder) => ({ id: folder.id, label: folder.name })),
]);

const items = computed(() => {
	const all = listing.value?.items ?? [];
	const term = search.value.trim().toLowerCase();
	return term ? all.filter((item) => item.name.toLowerCase().includes(term)) : all;
});

const can = (item: FileItem, permission: keyof NonNullable<FileItem["permissions"]>) =>
	Boolean(item.permissions?.[permission]);

// --- access indicators --------------------------------------------------------------------------

function itemIcon(item: FileItem) {
	if (item.kind === "file") return Utils.getFileIcon(item.name, item.mime_type);
	if (item.permissions && !item.permissions.read) return "i-lucide-folder-input";
	return item.custom_access ? "i-lucide-folder-lock" : "i-lucide-folder";
}

function entryText(entry: FileAccessEntry, kind: FileItem["kind"]) {
	return `${entry.label}: ${rightsLabel(kind, entry.permissions)}`;
}

/** Who has access to the open folder, and where that comes from. */
const folderAccess = computed(() => {
	const access = listing.value?.access;
	if (!access) return null;
	const source = access.custom
		? "eigener Zugriff"
		: access.inherited_from
			? `übernommen von „${access.inherited_from.name}“`
			: listing.value?.folder
				? "wie die oberste Ebene"
				: "oberste Ebene";
	return { entries: access.entries, source };
});

// --- upload -----------------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(0);

async function uploadFiles(files: File[] | FileList | null) {
	if (!files || !props.upload || !canAdd.value) return;
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
		Boolean(canAdd.value && props.upload) &&
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

// --- new folder / new document / rename -----------------------------------------------------

const folderModalOpen = ref(false);
const folderName = ref("");
const renameTarget = ref<FileItem | null>(null);
/** What the name dialog creates when it doesn't rename. */
const createKind = ref<"folder" | OfficeType>("folder");
const saving = ref(false);

function openNewFolder() {
	renameTarget.value = null;
	createKind.value = "folder";
	folderName.value = "";
	folderModalOpen.value = true;
}

function openNewDocument(kind: OfficeType) {
	renameTarget.value = null;
	createKind.value = kind;
	folderName.value = "";
	folderModalOpen.value = true;
}

const OFFICE_KINDS: Record<OfficeType, { label: string; title: string; icon: string }> = {
	docx: { label: "Textdokument", title: "Neues Textdokument", icon: "i-lucide-file-text" },
	xlsx: { label: "Tabelle", title: "Neue Tabelle", icon: "i-lucide-file-spreadsheet" },
	pptx: { label: "Präsentation", title: "Neue Präsentation", icon: "i-lucide-presentation" },
};

function openRename(item: FileItem) {
	renameTarget.value = item;
	folderName.value = item.name;
	folderModalOpen.value = true;
}

const nameModal = computed(() => {
	if (renameTarget.value)
		return { title: "Umbenennen", icon: "i-lucide-pencil", submit: "Speichern" };
	if (createKind.value !== "folder") {
		const office = OFFICE_KINDS[createKind.value];
		return { title: office.title, icon: office.icon, submit: "Anlegen & öffnen" };
	}
	return { title: "Neuer Ordner", icon: "i-lucide-folder-plus", submit: "Anlegen" };
});

async function rename(item: FileItem, name: string) {
	const result = await useAPI((api) =>
		api.putFilesByFileId({ path: { fileId: item.id }, body: { name } }),
	);
	if (!result.success) {
		toast.add({
			title: "Umbenennen fehlgeschlagen",
			description: fileErrorText(result.message, props.scope),
			color: "error",
		});
	}
	return result.success;
}

async function submitFolderModal() {
	const name = folderName.value.trim();
	if (!name || saving.value) return;
	saving.value = true;

	const kind = createKind.value;
	let done = false;
	/** A new office document: it opens in the office editor. */
	let created: FileItem | null = null;
	if (renameTarget.value) {
		done = await rename(renameTarget.value, name);
	} else if (kind !== "folder") {
		created = (await props.createOffice?.(name, kind, folderId.value)) ?? null;
		done = created !== null;
	} else {
		done = (await props.createFolder?.(name, folderId.value)) ?? false;
	}
	saving.value = false;

	// Failed: the dialog stays open with the name (the toast says why).
	if (!done) return;
	folderModalOpen.value = false;
	if (created) await router.push(fileLink(created));
	else await refresh();
}

/** The "Neu" menu: folder, office documents (with an office server). */
const officeAvailable = computed(() => useInstance().value?.office === true);
const newItems = computed<DropdownMenuItem[][]>(() => [
	[
		...(props.createFolder
			? [{ label: "Ordner", icon: "i-lucide-folder-plus", onSelect: openNewFolder }]
			: []),
	],
	...(props.createOffice && officeAvailable.value && !uploadOnly.value
		? [
				(Object.keys(OFFICE_KINDS) as OfficeType[]).map((type) => ({
					label: OFFICE_KINDS[type].label,
					icon: OFFICE_KINDS[type].icon,
					onSelect: () => openNewDocument(type),
				})),
			]
		: []),
]);

// --- new contents, versions -----------------------------------------------------------------

const replaceInput = ref<HTMLInputElement | null>(null);
const replaceTarget = ref<FileItem | null>(null);
const { uploadNewVersion } = useFileVersions();

function pickReplacement(item: FileItem) {
	replaceTarget.value = item;
	replaceInput.value?.click();
}

async function onReplace(event: Event) {
	const input = event.target as HTMLInputElement;
	const upload = input.files?.[0];
	input.value = "";
	const target = replaceTarget.value;
	if (!upload || !target) return;
	if (await uploadNewVersion(target, upload)) await refresh();
}

const versionsTarget = ref<FileItem | null>(null);
const versionsOpen = ref(false);

function openVersions(item: FileItem) {
	versionsTarget.value = item;
	versionsOpen.value = true;
}

// --- move (drag & drop) -------------------------------------------------------------------

const draggedItem = ref<FileItem | null>(null);
const dropTargetId = ref<number | "root" | null>(null);

function onItemDragStart(event: DragEvent, item: FileItem) {
	if (!can(item, "delete")) return;
	draggedItem.value = item;
	event.dataTransfer?.setData("application/x-iventworks-file", String(item.id));
	if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragEnd() {
	draggedItem.value = null;
	dropTargetId.value = null;
}

/** Folders in the list must allow uploads; breadcrumb targets are checked by the server. */
function canDropOn(targetId: number | null, target?: FileItem) {
	const item = draggedItem.value;
	if (!item || item.id === targetId || item.parent_id === targetId) return false;
	return target ? can(target, "upload") : true;
}

/** `dragenter` and `dragover` on a folder row or breadcrumb: both must be cancelled to allow a drop. */
function onDragOver(event: DragEvent, targetId: number | null, target?: FileItem) {
	if (!canDropOn(targetId, target)) return;
	event.preventDefault();
	dropTargetId.value = targetId ?? "root";
}

function onItemDrop(event: DragEvent, item: FileItem) {
	// Desktop files dropped on a row bubble up to the upload handler on the container.
	if (!draggedItem.value) return;
	event.preventDefault();
	if (item.kind === "folder" && canDropOn(item.id, item)) void onDropOnFolder(item.id);
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
		toast.add({
			title: "Verschieben fehlgeschlagen",
			description: fileErrorText(result.message, props.scope),
			color: "error",
		});
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
		toast.add({
			title: "Löschen fehlgeschlagen",
			description: fileErrorText(result.message, props.scope),
			color: "error",
		});
		throw new Error(result.message);
	}
	const trash = props.trash;
	toast.add({
		title: `„${target.name}“ in den Papierkorb verschoben`,
		color: "success",
		icon: "i-lucide-trash-2",
		actions: trash
			? [
					{
						label: "Rückgängig",
						icon: "i-lucide-undo-2",
						color: "neutral",
						variant: "subtle",
						onClick: async () => {
							if (await trash.restore(target.id)) await refresh();
						},
					},
				]
			: undefined,
	});
	await refresh();
}

const trashOpen = ref(false);

// --- share links / access -------------------------------------------------------------------

const shareTarget = ref<FileItem | null>(null);
const shareOpen = ref(false);

function openShare(item: FileItem) {
	shareTarget.value = item;
	shareOpen.value = true;
}

const accessTarget = ref<FileItem | null>(null);
const accessOpen = ref(false);

function openAccess(item: FileItem) {
	accessTarget.value = item;
	accessOpen.value = true;
}

// --- row actions ----------------------------------------------------------------------------

function itemActions(item: FileItem): DropdownMenuItem[][] {
	const groups: DropdownMenuItem[][] = [];

	if (item.kind === "folder") {
		groups.push([
			{ label: "Öffnen", icon: "i-lucide-folder-open", onSelect: () => openFolder(item.id) },
		]);
	} else if (can(item, "read")) {
		groups.push([
			{ label: "Öffnen", icon: "i-lucide-eye", to: fileLink(item) },
			{
				label: "Herunterladen",
				icon: "i-lucide-download",
				to: fileURL(item.content_url, true),
				target: "_blank",
			},
			{ label: "Versionen", icon: "i-lucide-history", onSelect: () => openVersions(item) },
		]);
	}

	const sharing: DropdownMenuItem[] = [];
	if (can(item, "manage")) {
		sharing.push({ label: "Zugriff", icon: "i-lucide-lock", onSelect: () => openAccess(item) });
		if (shareLinksAllowed.value) {
			sharing.push({ label: "Teilen", icon: "i-lucide-share-2", onSelect: () => openShare(item) });
		}
	}
	if (sharing.length) groups.push(sharing);

	const editing: DropdownMenuItem[] = [];
	if (item.kind === "file" && can(item, "edit")) {
		editing.push({
			label: "Neue Fassung hochladen",
			icon: "i-lucide-file-up",
			disabled: Boolean(item.editing),
			onSelect: () => pickReplacement(item),
		});
	}
	if (can(item, "rename")) {
		editing.push({ label: "Umbenennen", icon: "i-lucide-pencil", onSelect: () => openRename(item) });
	}
	if (can(item, "delete") && listing.value?.folder) {
		editing.push({
			label: "Eine Ebene nach oben",
			icon: "i-lucide-arrow-up-left",
			onSelect: () => onMoveUp(item),
		});
	}
	if (editing.length) groups.push(editing);

	if (can(item, "delete")) {
		groups.push([
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => openDelete(item),
			},
		]);
	}

	return groups;
}

/** The listed items with their menus (built once per change, not on every render). */
const rows = computed(() => items.value.map((item) => ({ item, actions: itemActions(item) })));

async function onMoveUp(item: FileItem) {
	draggedItem.value = item;
	await onDropOnFolder(listing.value?.folder?.parent_id ?? null);
}

/** The in-app file page; `from` leads its breadcrumb back to this library page. */
function fileLink(item: FileItem) {
	return { path: `/files/${item.id}`, query: { from: route.path } };
}

/** Where a row leads: the folder in this library, or the file page. */
function itemLink(item: FileItem) {
	if (item.kind === "folder") {
		const { folder: _folder, ...query } = route.query;
		return { query: { ...query, folder: String(item.id) } };
	}
	return fileLink(item);
}

/** A plain click opens it here (like the row); with Ctrl/⌘/Shift the browser opens a new tab. */
function onLinkClick(event: MouseEvent, item: FileItem) {
	event.stopPropagation();
	if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
	event.preventDefault();
	onRowClick(item);
}

function onRowClick(item: FileItem) {
	if (item.kind === "folder") {
		void openFolder(item.id);
	} else if (item.content_url && can(item, "read")) {
		void router.push(fileLink(item));
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
				<template v-for="(crumb, index) in breadcrumb" :key="crumb.id ?? 'root'">
					<UIcon v-if="index > 0" name="i-lucide-chevron-right" class="size-4 text-slate-600" />
					<button
						type="button"
						:class="[
							'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition',
							index === breadcrumb.length - 1 ? 'font-medium text-white' : 'text-slate-400 hover:text-white',
							dropTargetId === (crumb.id ?? 'root') ? 'bg-primary/15 ring-1 ring-primary' : '',
						]"
						@click="openFolder(crumb.id)"
						@dragenter="onDragOver($event, crumb.id)"
						@dragover="onDragOver($event, crumb.id)"
						@dragleave="dropTargetId = null"
						@drop="draggedItem && ($event.preventDefault(), onDropOnFolder(crumb.id))"
					>
						<UIcon v-if="crumb.icon" :name="crumb.icon" class="size-4" />
						{{ crumb.label }}
					</button>
				</template>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<UInput
					v-if="!uploadOnly"
					v-model="search"
					icon="i-lucide-search"
					placeholder="In diesem Ordner suchen"
					class="w-full sm:w-56"
				/>
				<UTooltip v-if="trash" text="Papierkorb">
					<UButton
						icon="i-lucide-trash-2"
						color="neutral"
						variant="ghost"
						aria-label="Papierkorb"
						@click="trashOpen = true"
					/>
				</UTooltip>
				<template v-if="canAdd">
					<UDropdownMenu v-if="newItems.flat().length" :items="newItems" :ui="{ viewport: 'main-bg-color' }">
						<UButton label="Neu" icon="i-lucide-plus" color="neutral" variant="subtle" trailing-icon="i-lucide-chevron-down" />
					</UDropdownMenu>
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

		<!-- Who has access here (managers) / what you may do here (everyone else). -->
		<div
			v-if="listing && showAccess && folderAccess"
			class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm"
		>
			<UIcon name="i-lucide-shield-check" class="size-4 shrink-0 text-slate-400" />
			<span class="text-slate-400">Zugriff:</span>
			<UBadge
				v-if="!folderAccess.entries.length"
				:label="onlyManagersLabel"
				icon="i-lucide-lock"
				color="warning"
				variant="subtle"
				size="sm"
			/>
			<UBadge
				v-for="entry in folderAccess.entries"
				:key="`${entry.principal}:${entry.id}`"
				:label="entryText(entry, 'folder')"
				:icon="accessEntryIcon(entry)"
				color="neutral"
				variant="subtle"
				size="sm"
			/>
			<span class="text-xs text-slate-500">· {{ folderAccess.source }}</span>
			<UButton
				v-if="listing.folder"
				label="Zugriff ändern"
				icon="i-lucide-lock"
				size="xs"
				color="neutral"
				variant="ghost"
				class="ml-auto"
				@click="openAccess(listing.folder)"
			/>
		</div>
		<p
			v-else-if="listing && folderPermissions && !folderPermissions.manage && listing.folder"
			class="flex items-center gap-2 text-xs text-slate-500"
		>
			<UIcon :name="uploadOnly ? 'i-lucide-inbox' : 'i-lucide-info'" class="size-3.5" />
			{{ ownRightsSentence(folderPermissions) }}
		</p>

		<UCard class="border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
			<div v-if="loading && !listing" class="flex justify-center py-12">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
			</div>

			<UEmpty
				v-else-if="uploadOnly"
				icon="i-lucide-inbox"
				title="Nur hochladen"
				:description="`Lade hier Dateien hoch. Was in diesem Ordner liegt, sehen nur die Personen mit Zugriff und ${managers.the}.`"
				variant="naked"
				class="py-10"
			/>

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
					v-for="{ item, actions } in rows"
					:key="item.id"
					:draggable="can(item, 'delete')"
					:class="[
						'group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-800/40',
						dropTargetId === item.id ? 'bg-primary/10 ring-1 ring-inset ring-primary' : '',
						draggedItem?.id === item.id ? 'opacity-50' : '',
					]"
					@click="onRowClick(item)"
					@dragstart="onItemDragStart($event, item)"
					@dragend="onDragEnd"
					@dragenter="item.kind === 'folder' && onDragOver($event, item.id, item)"
					@dragover="item.kind === 'folder' && onDragOver($event, item.id, item)"
					@dragleave="dropTargetId = null"
					@drop="onItemDrop($event, item)"
				>
					<UIcon
						:name="itemIcon(item)"
						:class="['size-5 shrink-0', item.kind === 'folder' ? 'text-amber-400' : 'text-slate-400']"
					/>
					<div class="min-w-0 flex-1">
						<p class="flex items-center gap-1.5 truncate text-sm font-medium text-white">
							<!-- Real links: middle-click and "open in new tab" work too. -->
							<a :href="router.resolve(itemLink(item)).href" class="truncate hover:underline" @click="onLinkClick($event, item)">{{ item.name }}</a>
							<UTooltip
								v-if="item.custom_access && item.kind === 'file' && !showAccess"
								text="Nur für ausgewählte Personen sichtbar"
							>
								<span class="inline-flex shrink-0">
									<UIcon name="i-lucide-lock" class="size-3.5 text-slate-500" aria-hidden="true" />
									<span class="sr-only">Nur für ausgewählte Personen sichtbar</span>
								</span>
							</UTooltip>
							<UTooltip v-if="item.shared" text="Per Link geteilt">
								<span class="inline-flex shrink-0">
									<UIcon name="i-lucide-share-2" class="size-3.5 text-primary-400" aria-hidden="true" />
									<span class="sr-only">Per Link geteilt</span>
								</span>
							</UTooltip>
						</p>
						<p class="flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
							<template v-if="item.kind === 'file'">{{ formatFileSize(item.size) }} · </template>
							{{ formatDate(item.updated_at) }}
							<UBadge
								v-if="item.permissions && !item.permissions.read"
								label="Nur hochladen"
								icon="i-lucide-inbox"
								color="neutral"
								variant="subtle"
								size="xs"
								class="ml-1"
							/>
							<UBadge
								v-if="item.editing"
								label="Wird in Office bearbeitet"
								icon="i-lucide-pencil"
								color="warning"
								variant="subtle"
								size="xs"
								class="ml-1"
							/>
						</p>
						<!-- Own access list (managers): who may see this. -->
						<div v-if="showAccess && item.access" class="mt-1 flex flex-wrap items-center gap-1">
							<UBadge
								v-if="!item.access.length"
								:label="onlyManagersLabel"
								icon="i-lucide-lock"
								color="warning"
								variant="subtle"
								size="xs"
							/>
							<UTooltip
								v-for="entry in item.access.slice(0, 3)"
								:key="`${entry.principal}:${entry.id}`"
								:text="entryText(entry, item.kind)"
							>
								<UBadge :label="entry.label" color="neutral" variant="subtle" size="xs">
									<template #leading>
										<span
											v-if="entry.color"
											class="size-2 rounded-full"
											:style="{ backgroundColor: entry.color }"
										/>
										<UIcon v-else :name="accessEntryIcon(entry)" class="size-3" />
									</template>
								</UBadge>
							</UTooltip>
							<UTooltip
								v-if="item.access.length > 3"
								:text="item.access.slice(3).map((entry) => entryText(entry, item.kind)).join(', ')"
							>
								<UBadge :label="`+${item.access.length - 3}`" color="neutral" variant="subtle" size="xs" />
							</UTooltip>
						</div>
					</div>
					<UDropdownMenu
						v-if="actions.length"
						:items="actions"
						:ui="{ viewport: 'main-bg-color' }"
					>
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

		<p v-if="canAdd && !uploadOnly" class="text-xs text-slate-500">
			Tipp: Dateien vom Computer hierher ziehen, um sie hochzuladen. Einträge auf einen Ordner oder
			den Pfad oben ziehen, um sie zu verschieben.
		</p>

		<div
			v-if="canAdd && upload && isOverDropZone"
			class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10"
		>
			<p class="flex items-center gap-2 font-medium text-primary-300">
				<UIcon name="i-lucide-upload" class="size-5" /> Zum Hochladen loslassen
			</p>
		</div>

		<DashboardModal v-model:open="folderModalOpen" :title="nameModal.title" :icon="nameModal.icon">
			<form class="space-y-4" @submit.prevent="submitFolderModal">
				<UFormField
					label="Name"
					required
					:description="
						!renameTarget && showAccess
							? 'Übernimmt den Zugriff dieses Ordners – ändern kannst du ihn danach über „Zugriff“.'
							: undefined
					"
				>
					<UInput
						v-model="folderName"
						autofocus
						class="w-full"
						:placeholder="!renameTarget && createKind !== 'folder' ? 'z. B. Protokoll Leitungstreffen' : undefined"
					/>
				</UFormField>
				<div class="flex justify-end gap-2">
					<UButton label="Abbrechen" color="neutral" variant="ghost" @click="folderModalOpen = false" />
					<UButton type="submit" :label="nameModal.submit" :loading="saving" />
				</div>
			</form>
		</DashboardModal>

		<input ref="replaceInput" type="file" class="hidden" @change="onReplace" />
		<FilesVersionsModal v-model:open="versionsOpen" :item="versionsTarget" @restored="refresh" />
		<FilesShareModal v-model:open="shareOpen" :item="shareTarget" @changed="refresh" />
		<FilesAccessModal v-model:open="accessOpen" :item="accessTarget" :scope="scope" @changed="refresh" />

		<DashboardDeleteModal
			v-model:open="deleteOpen"
			:title="deleteTarget?.kind === 'folder' ? 'Ordner löschen' : 'Datei löschen'"
			:warning-text="
				deleteTarget?.kind === 'folder'
					? `Der Ordner „${deleteTarget?.name}“ kommt mit allem darin in den Papierkorb. Dort lässt er sich 30 Tage lang wiederherstellen.`
					: `„${deleteTarget?.name}“ kommt in den Papierkorb. Dort lässt sich die Datei 30 Tage lang wiederherstellen.`
			"
			:require-confirm-text="false"
			:on-delete="confirmDelete"
		/>

		<FilesTrashModal
			v-if="trash"
			v-model:open="trashOpen"
			:trash="trash"
			:scope="scope"
			:manage="showAccess"
			@restored="refresh"
		/>
	</div>
</template>
