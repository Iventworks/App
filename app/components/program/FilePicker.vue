<script setup lang="ts">
/**
 * Pick documents or folders to link to a program item — from the event's documents or the
 * organisation library. Folders can be opened (click the name) or selected themselves.
 */
import { Utils } from "~/utils";
import type { FileItem, FolderListing } from "~/utils/types";

const props = defineProps<{
	eventId: number;
}>();

const open = defineModel<boolean>("open", { required: true });
const selected = defineModel<FileItem[]>("selected", { required: true });

const toast = useToast();

type Source = "event" | "org";
const source = ref<Source>("event");
const folderBySource = reactive<Record<Source, number | null>>({ event: null, org: null });
const listing = ref<FolderListing | null>(null);
const loading = ref(false);

/** Working copy; applied on "Übernehmen". */
const draft = ref<FileItem[]>([]);

async function load() {
	loading.value = true;
	const parentId = folderBySource[source.value] ?? undefined;
	const result =
		source.value === "event"
			? await useAPI((api) =>
					api.getEventsByEventIdFiles({
						path: { eventId: props.eventId },
						query: { parent_id: parentId },
					}),
				)
			: await useAPI((api) => api.getOrgDocuments({ query: { parent_id: parentId } }));
	loading.value = false;

	if (!result.success) {
		toast.add({
			title: "Dokumente konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		listing.value = null;
		return;
	}
	listing.value = result.data;
}

watch(open, (isOpen) => {
	if (!isOpen) return;
	draft.value = [...selected.value];
	void load();
});

watch(source, () => void load());

function openFolder(id: number | null) {
	folderBySource[source.value] = id;
	void load();
}

function isSelected(item: FileItem) {
	return draft.value.some((entry) => entry.id === item.id);
}

function toggle(item: FileItem) {
	draft.value = isSelected(item)
		? draft.value.filter((entry) => entry.id !== item.id)
		: [...draft.value, item];
}

function apply() {
	selected.value = draft.value;
	open.value = false;
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		title="Dokumente verknüpfen"
		description="Präsentationen, Regeln, Abläufe … Ordner können auch als Ganzes verknüpft werden."
		icon="i-lucide-paperclip"
		width="sm:max-w-2xl"
	>
		<div class="space-y-4">
			<UTabs
				v-model="source"
				:items="[
					{ label: 'Event-Dokumente', value: 'event', icon: 'i-lucide-folder' },
					{ label: 'Organisation', value: 'org', icon: 'i-lucide-library' },
				]"
				:content="false"
				size="sm"
			/>

			<div class="flex flex-wrap items-center gap-1 text-sm">
				<button
					type="button"
					class="rounded px-1.5 py-0.5 text-slate-400 hover:text-white"
					@click="openFolder(null)"
				>
					{{ source === "event" ? "Dokumente" : "Bibliothek" }}
				</button>
				<template v-for="folder in listing?.path ?? []" :key="folder.id">
					<UIcon name="i-lucide-chevron-right" class="size-4 text-slate-600" />
					<button
						type="button"
						class="rounded px-1.5 py-0.5 text-slate-400 hover:text-white"
						@click="openFolder(folder.id)"
					>
						{{ folder.name }}
					</button>
				</template>
			</div>

			<div class="max-h-80 overflow-y-auto rounded-lg border border-slate-800">
				<div v-if="loading" class="flex justify-center py-8">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-xl text-slate-400" />
				</div>
				<p v-else-if="!listing?.items.length" class="p-6 text-center text-sm text-slate-500">
					Dieser Ordner ist leer.
				</p>
				<ul v-else class="divide-y divide-slate-800">
					<li
						v-for="item in listing.items"
						:key="item.id"
						class="flex items-center gap-3 px-3 py-2 hover:bg-slate-800/40"
					>
						<UCheckbox
							:model-value="isSelected(item)"
							:aria-label="`${item.name} auswählen`"
							@update:model-value="toggle(item)"
						/>
						<UIcon
							:name="item.kind === 'folder' ? 'i-lucide-folder' : Utils.getFileIcon(item.name, item.mime_type)"
							:class="['size-5 shrink-0', item.kind === 'folder' ? 'text-amber-400' : 'text-slate-400']"
						/>
						<button
							v-if="item.kind === 'folder'"
							type="button"
							class="min-w-0 flex-1 truncate text-left text-sm text-white hover:underline"
							@click="openFolder(item.id)"
						>
							{{ item.name }}
						</button>
						<button
							v-else
							type="button"
							class="min-w-0 flex-1 truncate text-left text-sm text-white"
							@click="toggle(item)"
						>
							{{ item.name }}
						</button>
						<span v-if="item.kind === 'file'" class="shrink-0 text-xs text-slate-500">
							{{ formatFileSize(item.size) }}
						</span>
					</li>
				</ul>
			</div>

			<p class="text-sm text-slate-400">{{ draft.length }} ausgewählt</p>
		</div>

		<template #footer>
			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton label="Übernehmen" icon="i-lucide-check" @click="apply" />
			</div>
		</template>
	</DashboardModal>
</template>
