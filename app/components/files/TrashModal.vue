<script setup lang="ts">
/**
 * The Papierkorb of a document library: deleted documents and folders (a folder with what was in
 * it), where they were, who deleted them and when they go for good. Restore puts an item back
 * (to the top level when its folder is gone); managers can delete for good and empty it.
 */
import { Utils } from "~/utils";
import type { TrashAdapter, TrashItem } from "~/utils/types";

const props = defineProps<{ trash: TrashAdapter; scope: "org" | "event" }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ restored: [] }>();

const toast = useToast();
const confirm = useConfirmDialog();

const items = ref<TrashItem[]>([]);
const loading = ref(false);
const busy = ref<number | "empty" | null>(null);

const canEmpty = computed(() => items.value.some((item) => item.can_purge));

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

async function restore(item: TrashItem) {
	busy.value = item.id;
	const ok = await props.trash.restore(item.id);
	busy.value = null;
	if (!ok) return;
	toast.add({
		title: `„${item.name}“ wiederhergestellt`,
		description: item.location.length ? `In „${item.location.join(" / ")}“` : undefined,
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
				{{
					items.some((item) => item.can_purge)
						? ""
						: `Du siehst, was du selbst gelöscht hast – alles andere ${scope === "org" ? "das Kernteam" : "die Leitung"}.`
				}}
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
							{{ item.deleted_by?.display_name ?? "über einen Freigabelink" }} · {{ formatRelative(item.deleted_at) }}
							· endgültig weg {{ formatDate(item.purge_at) }}
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
