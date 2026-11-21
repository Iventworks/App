<script setup lang="ts">
/**
 * The Papierkorb of a document library: deleted documents and folders (a folder with what was in
 * it), where they were, who deleted them and when they go for good. Restore puts an item back
 * (managers: to the top level, only for them, when its folder is in the Papierkorb too); managers
 * can delete for good and empty it.
 */
import { Utils } from "~/utils";
import type { TrashAdapter, TrashItem } from "~/utils/types";

const props = defineProps<{
	trash: TrashAdapter;
	scope: "org" | "event";
	/** The caller manages the library (`permissions.manage` of the listing). */
	manage?: boolean;
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ restored: [] }>();

const toast = useToast();
const confirm = useConfirmDialog();

const items = ref<TrashItem[]>([]);
const loading = ref(false);
const busy = ref<number | "empty" | null>(null);

/**
 * Managers see everything in the Papierkorb and may delete for good. In the member view of the org
 * library (`/documents`) the listing doesn't say so, but the Papierkorb shows the Kernteam
 * everything all the same (`can_purge`).
 */
const isManager = computed(() => props.manage || items.value.some((item) => item.can_purge));
const canEmpty = computed(() => isManager.value && items.value.length > 0);

async function load() {
	loading.value = true;
	items.value = (await props.trash.list()) ?? [];
	loading.value = false;
}

watch(open, (value) => {
	if (value) void load();
});

function iconOf(item: TrashItem) {
	return item.kind === "folder" ? "i-lucide-folder" : Utils.getFileIcon(item.name, item.mime_type);
}

const onlyManagers = computed(() => managersOf(props.scope).the);

async function restore(item: TrashItem) {
	busy.value = item.id;
	const restored = await props.trash.restore(item.id);
	busy.value = null;
	if (!restored) return;
	// Its folder is in the Papierkorb too: it went to the top level, only for the managers.
	const toRoot = item.parent_id !== null && restored.parent_id === null;
	toast.add({
		title: `„${item.name}“ wiederhergestellt`,
		description: toRoot
			? `Auf der obersten Ebene, weil der Ordner auch im Papierkorb ist. Sehen kann es erst nur ${onlyManagers.value}, bis du den Zugriff änderst.`
			: item.location.length
				? `In „${item.location.join(" / ")}“`
				: undefined,
		color: "success",
		icon: "i-lucide-undo-2",
	});
	emit("restored");
	await load();
}

async function purge(item: TrashItem) {
	const choice = await confirm({
		title: "Endgültig löschen?",
		description: `„${item.name}“${item.kind === "folder" ? " und alles darin" : ""} wird endgültig gelöscht – auch alle Versionen. Das lässt sich nicht rückgängig machen.`,
		icon: "i-lucide-trash-2",
		iconColor: "error",
		confirmLabel: "Endgültig löschen",
		confirmColor: "error",
	});
	if (choice !== "confirm") return;
	busy.value = item.id;
	const ok = await props.trash.purge(item.id);
	busy.value = null;
	if (ok) await load();
}

async function empty() {
	const choice = await confirm({
		title: "Papierkorb leeren?",
		description: `Alle ${items.value.length} Einträge werden endgültig gelöscht – auch alle Versionen. Das lässt sich nicht rückgängig machen.`,
		icon: "i-lucide-trash-2",
		iconColor: "error",
		confirmLabel: "Papierkorb leeren",
		confirmColor: "error",
	});
	if (choice !== "confirm") return;
	busy.value = "empty";
	const ok = await props.trash.empty();
	busy.value = null;
	if (ok) {
		toast.add({ title: "Papierkorb geleert", color: "success" });
		await load();
	}
}
</script>

<template>
	<DashboardModal v-model:open="open" title="Papierkorb" icon="i-lucide-trash-2" :loading="loading" width="sm:max-w-2xl">
		<div class="space-y-3">
			<p class="text-sm text-slate-400">
				Gelöschte Dateien und Ordner bleiben 30 Tage hier und lassen sich wiederherstellen.
				<template v-if="!isManager">
					Du siehst, was du selbst gelöscht hast – alles andere {{ onlyManagers }}.
				</template>
			</p>

			<ul v-if="items.length" class="divide-y divide-slate-800 rounded-lg border border-slate-800">
				<li v-for="item in items" :key="item.id" class="flex flex-wrap items-center gap-3 px-3 py-2.5">
					<UIcon
						:name="iconOf(item)"
						:class="['size-5 shrink-0', item.kind === 'folder' ? 'text-amber-400' : 'text-slate-500']"
					/>
					<div class="min-w-0 flex-1 text-sm">
						<p class="truncate text-white">{{ item.name }}</p>
						<p class="text-xs text-slate-500">
							<template v-if="item.location.length">aus „{{ item.location.join(" / ") }}“ · </template>
							{{ item.deleted_by?.display_name ?? "Über einen Freigabelink" }} · {{ formatRelative(item.deleted_at) }}
							· endgültig weg {{ formatDate(item.purge_at) }}
						</p>
						<p v-if="item.folder_in_trash" class="text-xs text-amber-400/80">
							{{
								item.can_purge
									? "Der Ordner ist auch im Papierkorb. Stelle am besten zuerst den Ordner wieder her."
									: "Der Ordner ist auch im Papierkorb. Wiederherstellen kannst du es, sobald der Ordner wieder da ist."
							}}
						</p>
					</div>
					<div class="flex items-center gap-1">
						<UButton
							v-if="item.can_restore"
							label="Wiederherstellen"
							icon="i-lucide-undo-2"
							color="neutral"
							variant="subtle"
							size="sm"
							:loading="busy === item.id"
							@click="restore(item)"
						/>
						<UButton
							v-if="item.can_purge"
							icon="i-lucide-trash-2"
							color="error"
							variant="ghost"
							size="sm"
							aria-label="Endgültig löschen"
							@click="purge(item)"
						/>
					</div>
				</li>
			</ul>
			<UEmpty
				v-else-if="!loading"
				icon="i-lucide-trash"
				title="Der Papierkorb ist leer"
				variant="naked"
				class="py-6"
			/>
		</div>

		<template v-if="canEmpty" #footer>
			<UButton
				label="Papierkorb leeren"
				icon="i-lucide-trash-2"
				color="error"
				variant="subtle"
				:loading="busy === 'empty'"
				@click="empty"
			/>
		</template>
	</DashboardModal>
</template>
