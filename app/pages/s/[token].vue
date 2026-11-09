<script setup lang="ts">
/**
 * A share link for people without an account (`/s/<token>`): the shared file, or the shared folder
 * as a small file browser. What can be done depends on the link (view, upload, edit, delete); an
 * upload-only link is a drop box. Password-protected links ask for the password first.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import { Utils } from "~/utils";
import type { PublicShareInfo, PublicShareItem, PublicShareListing } from "~/utils/types";

definePageMeta({ layout: "public" });

const route = useRoute();
const router = useRouter();
const toast = useToast();
const fileURL = useFileURL();
const brandName = useBrandName();

const token = String(route.params.token ?? "");

const info = ref<PublicShareInfo | null>(null);
const notFound = ref(false);

async function loadInfo() {
	const result = await useAPI((api) => api.getSharesByToken({ path: { token } }), true);
	if (result.success) info.value = result.data;
	else notFound.value = true;
}
await loadInfo();

useSeoMeta({
	title: () => info.value?.item?.name ?? "Geteilter Link",
	robots: "noindex, nofollow",
});

const permissions = computed(() => info.value?.permissions ?? null);
const isFolder = computed(() => info.value?.kind === "folder");

// --- password ---------------------------------------------------------------------------------

const password = ref("");
const unlocking = ref(false);
const passwordError = ref<string | null>(null);

async function unlock() {
	unlocking.value = true;
	passwordError.value = null;
	const result = await useAPI(
		(api) => api.postSharesByTokenUnlock({ path: { token }, body: { password: password.value } }),
		true,
	);
	unlocking.value = false;
	if (!result.success) {
		passwordError.value =
			(result.code as number) === 429
				? "Zu viele Versuche. Bitte warte ein paar Minuten."
				: "Falsches Passwort.";
		return;
	}
	password.value = "";
	info.value = result.data;
	await loadListing();
}

// --- folder ------------------------------------------------------------------------------------

const folderId = computed(() => {
	const raw = Number(route.query.folder);
	return Number.isInteger(raw) && raw > 0 ? raw : undefined;
});
const listing = ref<PublicShareListing | null>(null);
const loadingListing = ref(false);

async function loadListing() {
	if (!isFolder.value || !info.value?.unlocked || !permissions.value?.read) return;
	loadingListing.value = true;
	const result = await useAPI(
		(api) => api.getSharesByTokenItems({ path: { token }, query: { folder_id: folderId.value } }),
		true,
	);
	loadingListing.value = false;
	if (result.success) {
		listing.value = result.data;
	} else if ((result.code as number) === 401) {
		await loadInfo();
	} else {
		toast.add({ title: "Ordner nicht gefunden", color: "error" });
		await openFolder(undefined);
	}
}
watch(folderId, loadListing);
await loadListing();

function openFolder(id: number | undefined) {
	const query = { ...route.query };
	if (id && id !== info.value?.item?.id) query.folder = String(id);
	else delete query.folder;
	return router.push({ query });
}

/** The folder new uploads go into: the open folder, or the shared folder. */
const targetFolderId = computed(() => listing.value?.folder.id ?? info.value?.item?.id);

// --- uploads -----------------------------------------------------------------------------------

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(0);
const droppedHere = ref<PublicShareItem[]>([]);
const isOver = ref(false);

async function uploadFiles(files: FileList | File[] | null) {
	if (!files || !permissions.value?.upload) return;
	const list = Array.from(files);
	uploading.value += list.length;
	let failed = 0;
	for (const file of list) {
		const parentId = targetFolderId.value;
		const result = await useAPI(
			(api) =>
				api.postSharesByTokenFiles({
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
	if (!permissions.value?.upload) return;
	event.preventDefault();
	void uploadFiles(event.dataTransfer?.files ?? null);
}

function onDragOver(event: DragEvent) {
	if (!permissions.value?.upload || !event.dataTransfer?.types.includes("Files")) return;
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
					api.putSharesByTokenFilesByFileId({ path: { token, fileId: target.id }, body: { name } }),
				true,
			)
		: await useAPI(
				(api) =>
					api.postSharesByTokenFolders({
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

// --- replace / delete -----------------------------------------------------------------------------

const replaceInput = ref<HTMLInputElement | null>(null);
const replaceTarget = ref<PublicShareItem | null>(null);
const replacing = ref(false);

function pickReplacement(item: PublicShareItem) {
	replaceTarget.value = item;
	replaceInput.value?.click();
}

async function onReplacePicked(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	const target = replaceTarget.value;
	if (!file || !target) return;
	replacing.value = true;
	const result = await useAPI(
		(api) =>
			api.putSharesByTokenFilesByFileIdContent({ path: { token, fileId: target.id }, body: { file } }),
		true,
	);
	replacing.value = false;
	if (!result.success) {
		toast.add({ title: "Ersetzen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: `Neue Fassung von „${target.name}“ hochgeladen`,
		icon: "i-lucide-check",
		color: "success",
	});
	if (isFolder.value) await loadListing();
	else await loadInfo();
}

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
		(api) => api.deleteSharesByTokenFilesByFileId({ path: { token, fileId: target.id } }),
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
	if (permissions.value?.edit) {
		edit.push({ label: "Umbenennen", icon: "i-lucide-pencil", onSelect: () => openRename(item) });
		if (item.kind === "file") {
			edit.push({
				label: "Neue Fassung hochladen",
				icon: "i-lucide-file-up",
				onSelect: () => pickReplacement(item),
			});
		}
	}
	if (edit.length) groups.push(edit);
	if (permissions.value?.delete) {
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

const isImage = computed(() => (info.value?.item?.mime_type ?? "").startsWith("image/"));
</script>

<template>
	<div class="space-y-6">
		<!-- Unknown, expired or switched-off link -->
		<UPageCard v-if="notFound || !info" class="mx-auto max-w-lg border-slate-800">
			<div class="flex flex-col items-center gap-3 py-4 text-center">
				<UIcon name="i-lucide-link-2-off" class="size-12 text-primary-400" />
				<h1 class="text-xl font-semibold text-white">Link nicht gefunden</h1>
				<p class="text-sm text-slate-400">
					Dieser Link ist abgelaufen, wurde gelöscht oder hat sich vertippt. Frag bei {{ brandName }} nach einem neuen.
				</p>
			</div>
		</UPageCard>

		<!-- Password -->
		<UPageCard v-else-if="!info.unlocked" class="mx-auto max-w-md border-slate-800">
			<form class="space-y-4" @submit.prevent="unlock">
				<div class="flex flex-col items-center gap-2 text-center">
					<UIcon name="i-lucide-lock" class="size-10 text-primary-400" />
					<h1 class="text-lg font-semibold text-white">Geschützter Link</h1>
					<p class="text-sm text-slate-400">{{ brandName }} hat diesen Link mit einem Passwort geschützt.</p>
				</div>
				<UFormField label="Passwort" :error="passwordError ?? undefined">
					<UInput v-model="password" type="password" autocomplete="current-password" autofocus class="w-full" />
				</UFormField>
				<UButton type="submit" label="Öffnen" color="primary" block :loading="unlocking" :disabled="!password" />
			</form>
		</UPageCard>

		<template v-else-if="info.item">
			<div class="flex flex-col gap-1">
				<p class="text-sm text-slate-400">Geteilt von {{ brandName }}</p>
				<h1 class="flex items-center gap-2 text-2xl font-semibold text-white">
					<UIcon :name="isFolder ? 'i-lucide-folder' : Utils.getFileIcon(info.item.name, info.item.mime_type)" :class="isFolder ? 'text-amber-400' : 'text-slate-400'" class="size-7 shrink-0" />
					<span class="truncate">{{ info.item.name }}</span>
				</h1>
				<p v-if="info.expires_at" class="text-xs text-slate-500">Dieser Link gilt bis {{ formatDate(info.expires_at) }}.</p>
			</div>

			<!-- A single file -->
			<UCard v-if="!isFolder" class="border-slate-800 bg-slate-900/60">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
					<img v-if="isImage && info.item.content_url" :src="fileURL(info.item.content_url)" :alt="info.item.name" class="max-h-64 rounded-md object-contain sm:max-w-sm" />
					<div class="flex-1 space-y-1 text-sm text-slate-400">
						<p>{{ formatFileSize(info.item.size) }} · zuletzt geändert {{ formatDate(info.item.updated_at) }}</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<UButton v-if="info.item.content_url" label="Öffnen" icon="i-lucide-external-link" color="neutral" variant="subtle" :to="fileURL(info.item.content_url)" target="_blank" />
						<UButton v-if="info.item.content_url" label="Herunterladen" icon="i-lucide-download" color="primary" :to="fileURL(info.item.content_url, true)" target="_blank" />
						<UButton v-if="permissions?.edit" label="Neue Fassung" icon="i-lucide-file-up" color="neutral" variant="subtle" :loading="replacing" @click="pickReplacement(info.item)" />
					</div>
				</div>
			</UCard>

			<!-- A folder -->
			<div v-else class="relative space-y-4" @dragover="onDragOver" @dragleave="isOver = false" @drop="onDrop">
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
					<div v-if="permissions?.upload" class="flex flex-wrap gap-2">
						<UButton v-if="permissions.read" label="Ordner" icon="i-lucide-folder-plus" color="neutral" variant="subtle" @click="openNewFolder" />
						<UButton label="Hochladen" icon="i-lucide-upload" color="primary" :loading="uploading > 0" @click="fileInput?.click()" />
						<input ref="fileInput" type="file" multiple class="hidden" @change="onFileInput" />
					</div>
				</div>

				<!-- Drop box: upload only -->
				<UCard v-if="!permissions?.read" class="border-slate-800 bg-slate-900/60">
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
					v-if="permissions?.upload && isOver"
					class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10"
				>
					<p class="flex items-center gap-2 font-medium text-primary-300">
						<UIcon name="i-lucide-upload" class="size-5" /> Zum Hochladen loslassen
					</p>
				</div>
			</div>

			<input ref="replaceInput" type="file" class="hidden" @change="onReplacePicked" />
		</template>

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
