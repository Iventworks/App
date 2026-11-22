<script setup lang="ts">
/**
 * "Verschieben nach …": pick the folder to move a document or folder to — without drag and drop
 * (phones, keyboards). Starts in the item's folder; the path goes up, the subfolders go down. The
 * folders come from the browser's own loader (`load`), so they carry what the caller may do there:
 * "Hierher verschieben" only where they may add things (`permissions.upload`), not where the item
 * already is, and a folder is never offered inside itself. `move` is the browser's move (toasts,
 * refresh); the server checks the rights again.
 */
import type { FileItem, FolderListing } from "~/utils/types";

const props = defineProps<{
	item: FileItem | null;
	/** The library's top level in the path, e.g. "Bibliothek". */
	rootLabel: string;
	load: (parentId: number | null) => Promise<FolderListing | null>;
	/** Moves `item` into `targetId` (null: the top level); true when it worked. */
	move: (item: FileItem, targetId: number | null) => Promise<boolean>;
}>();
const open = defineModel<boolean>("open", { required: true });

/** The folder shown (null: the top level) and its listing. */
const shownId = ref<number | null>(null);
const listing = ref<FolderListing | null>(null);
const loading = ref(false);
const moving = ref(false);
const pathNav = ref<HTMLElement | null>(null);

/** Counts loads: only the latest one may fill the dialog (folders can be clicked faster). */
let loads = 0;

async function show(folderId: number | null, focusPath = true) {
	const current = ++loads;
	shownId.value = folderId;
	loading.value = true;
	const result = await props.load(folderId);
	if (current !== loads) return;
	loading.value = false;
	if (!result) {
		// The library's loader has said why; back to where the item lies, or close.
		if (props.item && folderId !== props.item.parent_id) void show(props.item.parent_id);
		else open.value = false;
		return;
	}
	listing.value = result;
	// The button that was clicked is gone: keep the keyboard focus in the dialog, on where it is now.
	if (focusPath) {
		await nextTick();
		pathNav.value?.querySelector<HTMLElement>("[aria-current]")?.focus();
	}
}

watch(open, (value) => {
	if (!value || !props.item) return;
	listing.value = null;
	void show(props.item.parent_id, false);
});

/** The path to the shown folder; `id` null is the top level. */
const breadcrumb = computed<{ id: number | null; label: string }[]>(() => [
	{ id: null, label: props.rootLabel },
	...(listing.value?.path ?? []).map((folder) => ({ id: folder.id, label: folder.name })),
]);

/** Folders to go into — never the item itself (a folder can't go inside itself). */
const folders = computed(() =>
	(listing.value?.items ?? []).filter(
		(entry) => entry.kind === "folder" && entry.id !== props.item?.id,
	),
);

function folderIcon(folder: FileItem) {
	if (folder.permissions && !folder.permissions.read) return "i-lucide-folder-input";
	return folder.custom_access ? "i-lucide-folder-lock" : "i-lucide-folder";
}

/** Why it can't go into the shown folder (null: it can). */
const blocked = computed(() => {
	const item = props.item;
	const shown = listing.value;
	if (!item || !shown) return null;
	if (shownId.value === item.parent_id) return `„${item.name}“ liegt schon hier.`;
	if (shownId.value === item.id || shown.path.some((folder) => folder.id === item.id)) {
		return "Ein Ordner lässt sich nicht in sich selbst verschieben.";
	}
	if (!shown.permissions?.upload) return "Hier darfst du nichts ablegen.";
	return null;
});

const canMoveHere = computed(
	() => Boolean(props.item && listing.value) && !loading.value && blocked.value === null,
);

async function moveHere() {
	const item = props.item;
	if (!item || !canMoveHere.value) return;
	moving.value = true;
	const moved = await props.move(item, shownId.value);
	moving.value = false;
	if (moved) open.value = false;
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="`„${item?.name ?? ''}“ verschieben`"
		description="Wähle den Ordner, in den es kommen soll."
		icon="i-lucide-folder-input"
		:loading="!listing"
	>
		<div class="space-y-3" :aria-busy="loading">
			<nav ref="pathNav" aria-label="Ordnerpfad" class="flex min-w-0 flex-wrap items-center gap-1">
				<template v-for="(crumb, index) in breadcrumb" :key="crumb.id ?? 'root'">
					<UIcon v-if="index > 0" name="i-lucide-chevron-right" class="size-4 text-slate-600" aria-hidden="true" />
					<button
						type="button"
						:aria-current="index === breadcrumb.length - 1 ? 'location' : undefined"
						:class="[
							'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition focus-visible:outline-2 focus-visible:outline-primary',
							index === breadcrumb.length - 1 ? 'font-medium text-white' : 'text-slate-400 hover:text-white',
						]"
						@click="show(crumb.id)"
					>
						<UIcon v-if="index === 0" name="i-lucide-folder-root" class="size-4" aria-hidden="true" />
						{{ crumb.label }}
					</button>
				</template>
			</nav>

			<ul
				v-if="folders.length"
				aria-label="Unterordner"
				:class="[
					'max-h-72 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800 transition-opacity',
					loading ? 'opacity-60' : '',
				]"
			>
				<li v-for="folder in folders" :key="folder.id">
					<button
						type="button"
						class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-slate-800/40 focus-visible:bg-slate-800/60 focus-visible:outline-none"
						:aria-label="`Ordner „${folder.name}“ öffnen`"
						@click="show(folder.id)"
					>
						<UIcon :name="folderIcon(folder)" class="size-5 shrink-0 text-amber-400" aria-hidden="true" />
						<span class="min-w-0 flex-1 truncate text-white">{{ folder.name }}</span>
						<UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-slate-500" aria-hidden="true" />
					</button>
				</li>
			</ul>
			<p
				v-else
				class="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-sm text-slate-500"
			>
				Hier gibt es keine Unterordner.
			</p>

			<!-- Always there, so screen readers announce when it changes. -->
			<p class="flex min-h-4 items-center gap-2 text-xs text-slate-400" aria-live="polite">
				<template v-if="blocked">
					<UIcon name="i-lucide-info" class="size-3.5 shrink-0" aria-hidden="true" />
					{{ blocked }}
				</template>
			</p>
		</div>

		<template #footer>
			<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
			<UButton
				label="Hierher verschieben"
				icon="i-lucide-folder-input"
				:disabled="!canMoveHere"
				:loading="moving"
				@click="moveHere"
			/>
		</template>
	</DashboardModal>
</template>
