<script setup lang="ts">
/**
 * A shared folder as a small file browser: breadcrumbs, the open folder (`?folder=<id>`), and what
 * the link allows — open and download, upload (by button or drag & drop), new folders, rename,
 * new versions and delete. A link without view rights is a drop box: only what you upload yourself
 * is listed.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import { Utils } from "~/utils";
import type { PublicShareInfo, PublicShareItem, PublicShareListing } from "~/utils/types";

const props = defineProps<{
	token: string;
	/** The shared folder. */
	root: PublicShareItem;
	permissions: NonNullable<PublicShareInfo["permissions"]>;
}>();

/** The link needs its password again (the unlock expired). */
const emit = defineEmits<{ locked: [] }>();

const route = useRoute();
const router = useRouter();
const toast = useToast();
const fileURL = useFileURL();
const token = props.token;

// --- listing -----------------------------------------------------------------------------------

const folderId = computed(() => {
	const raw = Number(route.query.folder);
	return Number.isInteger(raw) && raw > 0 ? raw : undefined;
});
const listing = ref<PublicShareListing | null>(null);
const loadingListing = ref(false);

async function loadListing() {
	if (!props.permissions.read) return;
	loadingListing.value = true;
	const result = await useAPI(
		(api) => api.getPublicDocsByTokenItems({ path: { token }, query: { folder_id: folderId.value } }),
		true,
	);
	loadingListing.value = false;
	if (result.success) {
		listing.value = result.data;
	} else if ((result.code as number) === 401) {
		emit("locked");
	} else {
		toast.add({ title: "Ordner nicht gefunden", color: "error" });
		await openFolder(undefined);
	}
}
watch(folderId, loadListing);
void loadListing();

function openFolder(id: number | undefined) {
	const query = { ...route.query };
	if (id && id !== props.root.id) query.folder = String(id);
	else delete query.folder;
	return router.push({ query });
}

/** The folder new uploads go into: the open folder, or the shared folder. */
const targetFolderId = computed(() => listing.value?.folder.id ?? props.root.id);

// --- uploads -----------------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(0);
const droppedHere = ref<PublicShareItem[]>([]);
const isOver = ref(false);

async function uploadFiles(files: FileList | File[] | null) {
	if (!files || !props.permissions.upload) return;
	const list = Array.from(files);
	uploading.value += list.length;
	let failed = 0;
	for (const file of list) {
		const parentId = targetFolderId.value;
		const result = await useAPI(
			(api) =>
				api.postPublicDocsByTokenFiles({
					path: { token },
					body: { file, ...(parentId ? { parent_id: parentId } : {}) },
				}),
			true,
		);
		uploading.value--;
		if (result.success) droppedHere.value.unshift(result.data);
		else {
			failed++;
			toast.add({
				title: `„${file.name}“ nicht hochgeladen`,
				description: result.message,
				color: "error",
			});
		}
	}
	if (!failed) {
		toast.add({
			title: list.length === 1 ? "Datei hochgeladen" : `${list.length} Dateien hochgeladen`,
			icon: "i-lucide-check",
			color: "success",
		});
	}
	await loadListing();
}

function onFileInput(event: Event) {
	const input = event.target as HTMLInputElement;
	void uploadFiles(input.files);
	input.value = "";
}

function onDrop(event: DragEvent) {
	isOver.value = false;
	if (!props.permissions.upload) return;
	event.preventDefault();
	void uploadFiles(event.dataTransfer?.files ?? null);
}

function onDragOver(event: DragEvent) {
	if (!props.permissions.upload || !event.dataTransfer?.types.includes("Files")) return;
	event.preventDefault();
	isOver.value = true;
}

// --- new folder / rename -------------------------------------------------------------------------

const nameModalOpen = ref(false);
const nameTarget = ref<PublicShareItem | null>(null);
const nameValue = ref("");
const savingName = ref(false);

function openNewFolder() {
	nameTarget.value = null;
	nameValue.value = "";
	nameModalOpen.value = true;
}

function openRename(item: PublicShareItem) {
	nameTarget.value = item;
	nameValue.value = item.name;
	nameModalOpen.value = true;
}

async function submitName() {
	const name = nameValue.value.trim();
	if (!name) return;
	savingName.value = true;
	const target = nameTarget.value;
	const parentId = targetFolderId.value;
	const result = target
		? await useAPI(
				(api) =>
					api.putPublicDocsByTokenFilesByFileId({
						path: { token, fileId: target.id },
						body: { name },
					}),
				true,
			)
		: await useAPI(
				(api) =>
					api.postPublicDocsByTokenFolders({
						path: { token },
						body: { name, ...(parentId ? { parent_id: parentId } : {}) },
					}),
				true,
			);
	savingName.value = false;
	if (!result.success) {
		toast.add({
			title: target ? "Umbenennen fehlgeschlagen" : "Ordner nicht angelegt",
			description: result.message,
			color: "error",
		});
		return;
	}
	nameModalOpen.value = false;
	await loadListing();
}

// --- new version / delete ----------------------------------------------------------------------

const replacement = useShareReplacement(token, loadListing);
const replaceInput = replacement.input;

const deleteTarget = ref<PublicShareItem | null>(null);
const deleteOpen = computed({
	get: () => deleteTarget.value !== null,
	set: (value) => {
		if (!value) deleteTarget.value = null;
	},
});

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI(
		(api) => api.deletePublicDocsByTokenFilesByFileId({ path: { token, fileId: target.id } }),
		true,
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `„${target.name}“ gelöscht`, icon: "i-lucide-check", color: "success" });
	await loadListing();
}

// --- items ---------------------------------------------------------------------------------------

function itemActions(item: PublicShareItem): DropdownMenuItem[][] {
	const groups: DropdownMenuItem[][] = [];
	if (item.kind === "folder") {
		groups.push([
			{ label: "Öffnen", icon: "i-lucide-folder-open", onSelect: () => openFolder(item.id) },
		]);
	} else if (item.content_url) {
		groups.push([
			{
				label: "Öffnen",
				icon: "i-lucide-external-link",
				to: fileURL(item.content_url),
				target: "_blank",
			},
			{
				label: "Herunterladen",
				icon: "i-lucide-download",
				to: fileURL(item.content_url, true),
				target: "_blank",
			},
		]);
	}
	const edit: DropdownMenuItem[] = [];
	if (props.permissions.edit) {
		edit.push({ label: "Umbenennen", icon: "i-lucide-pencil", onSelect: () => openRename(item) });
		if (item.kind === "file") {
			edit.push({
				label: "Neue Fassung hochladen",
				icon: "i-lucide-file-up",
				onSelect: () => replacement.pick(item),
			});
		}
	}
	if (edit.length) groups.push(edit);
	if (props.permissions.delete) {
		groups.push([
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => (deleteTarget.value = item),
			},
		]);
	}
	return groups;
}

function onRowClick(item: PublicShareItem) {
	if (item.kind === "folder") void openFolder(item.id);
	else if (item.content_url) window.open(fileURL(item.content_url), "_blank", "noopener");
}
</script>

<template>
	<div class="relative space-y-4" @dragover="onDragOver" @dragleave="isOver = false" @drop="onDrop">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex min-w-0 flex-wrap items-center gap-1">
				<template v-for="(crumb, index) in listing?.path ?? []" :key="crumb.id">
					<UIcon v-if="index > 0" name="i-lucide-chevron-right" class="size-4 text-slate-600" />
					<button
						type="button"
						class="rounded-md px-2 py-1 text-sm transition"
						:class="index === (listing?.path.length ?? 0) - 1 ? 'font-medium text-white' : 'text-slate-400 hover:text-white'"
						@click="openFolder(crumb.id)"
					>
						{{ crumb.name }}
					</button>
				</template>
			</div>
			<div v-if="permissions.upload" class="flex flex-wrap gap-2">
				<UButton v-if="permissions.read" label="Ordner" icon="i-lucide-folder-plus" color="neutral" variant="subtle" @click="openNewFolder" />
				<UButton label="Hochladen" icon="i-lucide-upload" color="primary" :loading="uploading > 0" @click="fileInput?.click()" />
				<input ref="fileInput" type="file" multiple class="hidden" @change="onFileInput" />
			</div>
		</div>

		<!-- Drop box: upload only -->
		<UCard v-if="!permissions.read" class="border-slate-800 bg-slate-900/60">
			<div class="flex flex-col items-center gap-3 py-8 text-center">
				<UIcon name="i-lucide-inbox" class="size-12 text-primary-400" />
				<p class="font-medium text-white">Dateien hier ablegen</p>
				<p class="max-w-md text-sm text-slate-400">
					Zieh Dateien hierher oder wähle sie aus. Du siehst nur, was du selbst hochlädst – der Inhalt des Ordners bleibt verborgen.
				</p>
				<UButton label="Dateien auswählen" icon="i-lucide-upload" color="primary" :loading="uploading > 0" @click="fileInput?.click()" />
			</div>
			<ul v-if="droppedHere.length" class="mt-2 divide-y divide-slate-800 border-t border-slate-800">
				<li v-for="item in droppedHere" :key="item.id" class="flex items-center gap-2 px-2 py-2 text-sm">
					<UIcon name="i-lucide-check" class="size-4 text-emerald-400" />
					<span class="truncate text-white">{{ item.name }}</span>
					<span class="ml-auto text-xs text-slate-500">{{ formatFileSize(item.size) }}</span>
				</li>
			</ul>
		</UCard>

		<UCard v-else class="border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
			<div v-if="loadingListing && !listing" class="flex justify-center py-12">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
			</div>
			<UEmpty v-else-if="!listing?.items.length" icon="i-lucide-folder-open" title="Leerer Ordner" variant="naked" class="py-10" />
			<ul v-else class="divide-y divide-slate-800">
				<li
					v-for="item in listing.items"
					:key="item.id"
					class="group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-800/40"
					@click="onRowClick(item)"
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
						<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="sm" aria-label="Aktionen" @click.stop />
					</UDropdownMenu>
				</li>
			</ul>
		</UCard>

		<div
			v-if="permissions.upload && isOver"
			class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10"
		>
			<p class="flex items-center gap-2 font-medium text-primary-300">
				<UIcon name="i-lucide-upload" class="size-5" /> Zum Hochladen loslassen
			</p>
		</div>

		<input ref="replaceInput" type="file" class="hidden" @change="replacement.onPicked" />

		<DashboardModal v-model:open="nameModalOpen" :title="nameTarget ? 'Umbenennen' : 'Neuer Ordner'" :icon="nameTarget ? 'i-lucide-pencil' : 'i-lucide-folder-plus'">
			<form class="space-y-4" @submit.prevent="submitName">
				<UFormField label="Name" required>
					<UInput v-model="nameValue" autofocus class="w-full" />
				</UFormField>
				<div class="flex justify-end gap-2">
					<UButton label="Abbrechen" color="neutral" variant="ghost" @click="nameModalOpen = false" />
					<UButton type="submit" :label="nameTarget ? 'Speichern' : 'Anlegen'" :loading="savingName" />
				</div>
			</form>
		</DashboardModal>

		<DashboardDeleteModal
			v-model:open="deleteOpen"
			:title="deleteTarget?.kind === 'folder' ? 'Ordner löschen' : 'Datei löschen'"
			:warning-text="deleteTarget?.kind === 'folder' ? `Der Ordner „${deleteTarget?.name}“ und alles darin wird gelöscht.` : `„${deleteTarget?.name}“ wird gelöscht.`"
			:require-confirm-text="false"
			:on-delete="confirmDelete"
		/>
	</div>
</template>
