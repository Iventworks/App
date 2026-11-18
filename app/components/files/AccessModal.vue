<script setup lang="ts">
/**
 * Who has access to one document or folder: inherit the parent folder's access, or an own list
 * of groups and people with the same rights presets as share links. Switching to an own list
 * starts from the inherited entries (like "stop inheriting" in SharePoint). Kernteam (org
 * documents) and Leitung (event documents) always have full access and are not listed.
 */
import type { SelectMenuItem } from "@nuxt/ui";
import {
	accessEntryIcon,
	rightsLabel,
	rightsPresetFor,
	rightsPresetsFor,
} from "~/utils/filePermissions";
import type {
	FileAccessCandidate,
	FileAccessEntry,
	FileAccessRights,
	FileAccessView,
	FileItem,
} from "~/utils/types";

const props = defineProps<{ item: FileItem | null; scope: "org" | "event" }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();

type Row = Pick<FileAccessEntry, "principal" | "id" | "label" | "color"> & {
	permissions: FileAccessRights;
};

const view = ref<FileAccessView | null>(null);
const candidates = ref<FileAccessCandidate[]>([]);
const loading = ref(false);
const saving = ref(false);
const mode = ref<"inherit" | "custom">("inherit");
const rows = ref<Row[]>([]);
/** Who can open the folder this item is in (null: it is at the top level, which everyone sees). */
const parentEntries = ref<FileAccessEntry[] | null>(null);

/**
 * Whether this entry's people can't open the folder above — then they never get to this item.
 * Only certain cases (a person in a group of the folder above can't be checked here, so no warning).
 */
function cutOff(row: Row) {
	const parent = parentEntries.value;
	if (!parent || (!row.permissions.read && !row.permissions.upload)) return false;
	const readers = parent.filter((entry) => entry.permissions.read);
	if (readers.some((entry) => entry.principal === "members" || entry.principal === "team"))
		return false;
	if (readers.some((entry) => entry.principal === row.principal && entry.id === row.id))
		return false;
	if (
		row.principal === "user" &&
		readers.some((entry) => entry.principal === "org_group" || entry.principal === "event_group")
	) {
		return false;
	}
	return true;
}

const isFolder = computed(() => props.item?.kind === "folder");
const presets = computed(() => rightsPresetsFor(props.item?.kind));

/** Rights that fit the item (files: view or edit), like the server stores them. */
function fit(rights: FileAccessRights): FileAccessRights {
	if (!isFolder.value) return { read: true, upload: false, edit: rights.edit, delete: false };
	return rights;
}

function toRows(entries: FileAccessEntry[]): Row[] {
	return entries.map((entry) => ({
		principal: entry.principal,
		id: entry.id,
		label: entry.label,
		color: entry.color,
		permissions: fit(entry.permissions),
	}));
}

async function load() {
	const item = props.item;
	if (!item) return;
	loading.value = true;
	const parentId = item.parent_id;
	const [access, list, parent] = await Promise.all([
		useAPI((api) => api.getFilesByFileIdAccess({ path: { fileId: item.id } })),
		useAPI((api) => api.getFilesByFileIdAccessCandidates({ path: { fileId: item.id } })),
		parentId !== null
			? useAPI((api) => api.getFilesByFileIdAccess({ path: { fileId: parentId } }))
			: Promise.resolve(null),
	]);
	parentEntries.value = parent?.success ? parent.data.entries : null;
	loading.value = false;
	if (!access.success) {
		toast.add({
			title: "Zugriff konnte nicht geladen werden",
			description: access.message,
			color: "error",
		});
		open.value = false;
		return;
	}
	view.value = access.data;
	candidates.value = list.success ? list.data : [];
	mode.value = access.data.custom ? "custom" : "inherit";
	rows.value = toRows(access.data.entries);
}

watch(open, (value) => {
	if (value) void load();
});

/** Back to inheriting: show what would apply again. */
watch(mode, (value) => {
	if (value === "inherit" && view.value && !view.value.custom)
		rows.value = toRows(view.value.entries);
});

const inheritedText = computed(() => {
	const source = view.value?.inherited_from;
	if (source) return `Wie der Ordner „${source.name}“`;
	if (view.value?.custom) return "Wie der übergeordnete Ordner";
	return props.scope === "org"
		? "Wie die oberste Ebene: nur das Kernteam"
		: "Wie die oberste Ebene: alle im Team dürfen ansehen und hochladen";
});

const modes = computed(() => [
	{
		value: "inherit" as const,
		label: "Übernehmen",
		description: inheritedText.value,
		icon: "i-lucide-folder-tree",
	},
	{
		value: "custom" as const,
		label: "Eigener Zugriff",
		description: `Gilt für ${isFolder.value ? "diesen Ordner und alles darin" : "diese Datei"}`,
		icon: "i-lucide-lock",
	},
]);

// --- entries ----------------------------------------------------------------------------------

const keyOf = (row: Pick<Row, "principal" | "id">) => `${row.principal}:${row.id ?? ""}`;

function presetItems(row: Row) {
	const items = presets.value.map((preset) => ({ label: preset.label, value: preset.key }));
	if (!rightsPresetFor(props.item?.kind, row.permissions)) {
		items.push({ label: rightsLabel(props.item?.kind, row.permissions), value: "custom" });
	}
	return items;
}

function presetKey(row: Row) {
	return rightsPresetFor(props.item?.kind, row.permissions)?.key ?? "custom";
}

function setPreset(row: Row, key: string) {
	const preset = presets.value.find((entry) => entry.key === key);
	if (preset) row.permissions = { ...preset.permissions };
}

const addItems = computed<SelectMenuItem[]>(() => {
	const taken = new Set(rows.value.map(keyOf));
	return candidates.value
		.filter((candidate) => !taken.has(keyOf(candidate)))
		.map((candidate) => ({
			label: candidate.label,
			description: candidate.description ?? undefined,
			icon: accessEntryIcon(candidate),
			value: keyOf(candidate),
		}));
});

const addKey = ref<string | undefined>(undefined);
watch(addKey, (key) => {
	if (!key) return;
	const candidate = candidates.value.find((entry) => keyOf(entry) === key);
	if (candidate) {
		rows.value.push({
			principal: candidate.principal,
			id: candidate.id,
			label: candidate.label,
			color: candidate.color,
			// "Nur ansehen" to start with.
			permissions: { read: true, upload: false, edit: false, delete: false },
		});
	}
	nextTick(() => {
		addKey.value = undefined;
	});
});

// --- save -------------------------------------------------------------------------------------

async function save() {
	const item = props.item;
	if (!item) return;
	saving.value = true;
	const custom = mode.value === "custom";
	const result = await useAPI((api) =>
		api.putFilesByFileIdAccess({
			path: { fileId: item.id },
			body: {
				custom,
				entries: custom
					? rows.value.map((row) => ({
							principal: row.principal,
							id: row.id,
							permissions: row.permissions,
						}))
					: [],
			},
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Zugriff nicht gespeichert", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Zugriff gespeichert", color: "success", icon: "i-lucide-check" });
	open.value = false;
	emit("changed");
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="`Zugriff: ${item?.name ?? ''}`"
		icon="i-lucide-lock"
		:loading="loading"
		width="sm:max-w-2xl"
	>
		<div class="space-y-5">
			<p class="flex items-start gap-2 text-sm text-slate-400">
				<UIcon name="i-lucide-crown" class="mt-0.5 size-4 shrink-0 text-amber-400" />
				<span>
					{{ scope === "org" ? "Das Kernteam" : "Die Leitung (und das Kernteam)" }} hat immer Vollzugriff und
					legt den Zugriff fest. Eigener Zugriff gilt für alles darin, bis ein Unterordner seinen eigenen hat.
				</span>
			</p>

			<div class="grid gap-2 sm:grid-cols-2">
				<button
					v-for="option in modes"
					:key="option.value"
					type="button"
					class="flex items-start gap-3 rounded-lg border p-3 text-left transition"
					:class="mode === option.value ? 'border-primary bg-primary/10' : 'border-slate-800 hover:border-slate-600'"
					:aria-pressed="mode === option.value"
					@click="mode = option.value"
				>
					<UIcon :name="option.icon" class="mt-0.5 size-5 shrink-0 text-primary-400" />
					<span>
						<span class="block text-sm font-medium text-white">{{ option.label }}</span>
						<span class="block text-xs text-slate-400">{{ option.description }}</span>
					</span>
				</button>
			</div>

			<div class="space-y-2">
				<p class="text-xs font-medium uppercase tracking-wide text-slate-500">
					{{ mode === "custom" ? "Wer Zugriff hat" : "Zugriff, der übernommen wird" }}
				</p>
				<ul v-if="rows.length" class="divide-y divide-slate-800 rounded-lg border border-slate-800">
					<li v-for="(row, index) in rows" :key="keyOf(row)" class="flex flex-wrap items-center gap-3 px-3 py-2.5">
						<span
							class="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-800"
							:style="row.color ? { backgroundColor: `${row.color}33` } : undefined"
						>
							<UIcon
								:name="accessEntryIcon(row)"
								class="size-4 text-slate-300"
								:style="row.color ? { color: row.color } : undefined"
							/>
						</span>
						<span class="min-w-0 flex-1 text-sm text-white">
							<span class="block truncate">{{ row.label }}</span>
							<span
								v-if="mode === 'custom' && cutOff(row)"
								class="flex items-center gap-1 text-xs text-amber-400"
							>
								<UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
								Kann den Ordner darüber nicht öffnen – findet das hier also nicht.
							</span>
						</span>
						<template v-if="mode === 'custom'">
							<USelect
								:model-value="presetKey(row)"
								:items="presetItems(row)"
								class="w-full sm:w-52"
								@update:model-value="setPreset(row, String($event))"
							/>
							<UButton
								icon="i-lucide-x"
								color="neutral"
								variant="ghost"
								size="sm"
								:aria-label="`${row.label} entfernen`"
								@click="rows.splice(index, 1)"
							/>
						</template>
						<UBadge v-else :label="rightsLabel(item?.kind, row.permissions)" color="neutral" variant="subtle" />
					</li>
				</ul>
				<div
					v-else
					class="flex items-center gap-2 rounded-lg border border-dashed border-slate-700 px-3 py-3 text-sm text-slate-400"
				>
					<UIcon name="i-lucide-lock" class="size-4 text-amber-400" />
					Nur {{ scope === "org" ? "das Kernteam" : "die Leitung" }} –
					sonst sieht niemand {{ isFolder ? "diesen Ordner" : "diese Datei" }}.
				</div>

				<USelectMenu
					v-if="mode === 'custom'"
					v-model="addKey"
					:items="addItems"
					value-key="value"
					icon="i-lucide-user-plus"
					:placeholder="scope === 'org' ? 'Mitglieder, Gruppe oder Person hinzufügen' : 'Team, Gruppe oder Person hinzufügen'"
					:search-input="{ placeholder: 'Suchen …' }"
					class="w-full"
				/>
			</div>
		</div>

		<template #footer>
			<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
			<UButton label="Speichern" icon="i-lucide-check" :loading="saving" :disabled="loading" @click="save" />
		</template>
	</DashboardModal>
</template>
