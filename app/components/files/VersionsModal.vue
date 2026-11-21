<script setup lang="ts">
/**
 * Earlier versions of a file ("Versionen"): who wrote them and when, view them in the app
 * (`/files/{id}?version=…`) or download them, and "Wiederherstellen" for people who may edit (the
 * current contents become a version, so a restore can be undone). Versions are kept for 30 days,
 * the newest ten longer, at most 50.
 */
import type { FileItem, FileVersion } from "~/utils/types";

const props = defineProps<{
	item: Pick<FileItem, "id" | "name" | "scope" | "permissions" | "updated_at" | "size"> | null;
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ restored: [] }>();

const toast = useToast();
const route = useRoute();
const fileURL = useFileURL();
const { restoring, restoreVersion } = useFileVersions();

const versions = ref<FileVersion[]>([]);
/** The file `versions` belong to. */
let shownFor: number | null = null;
const loading = ref(false);

const canEdit = computed(() => Boolean(props.item?.permissions?.edit));

/** A version in the file view — from the file view itself, or from a library page (`from`). */
function versionLink(version: FileVersion) {
	const path = `/files/${props.item?.id}`;
	const query = route.path === path ? { ...route.query } : { from: route.path };
	return { path, query: { ...query, version: String(version.id) } };
}

/** Counts loads: only the latest one may fill the list (it can be reopened for another file). */
let loads = 0;

async function load() {
	const item = props.item;
	if (!item) return;
	const current = ++loads;
	// Opened for another file: don't show the previous file's versions meanwhile.
	if (item.id !== shownFor) versions.value = [];
	loading.value = true;
	const result = await useAPI((api) => api.getFilesByFileIdVersions({ path: { fileId: item.id } }));
	if (current !== loads) return;
	loading.value = false;
	if (!result.success) {
		toast.add({
			title: "Versionen konnten nicht geladen werden",
			description: fileErrorText(result.message, libraryScopeOf(item)),
			color: "error",
		});
		return;
	}
	versions.value = result.data;
	shownFor = item.id;
}

watch(open, (value) => {
	if (value) void load();
});

async function restore(version: FileVersion) {
	const item = props.item;
	if (!item || !(await restoreVersion(item, version))) return;
	emit("restored");
	await load();
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="`Versionen: ${item?.name ?? ''}`"
		icon="i-lucide-history"
		:loading="loading"
		width="sm:max-w-xl"
	>
		<div class="space-y-3">
			<div v-if="item" class="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
				<UIcon name="i-lucide-file-check" class="size-5 shrink-0 text-primary-400" />
				<div class="min-w-0 flex-1 text-sm">
					<p class="font-medium text-white">Aktuelle Fassung</p>
					<p class="text-xs text-slate-400">{{ formatDate(item.updated_at) }} · {{ formatFileSize(item.size) }}</p>
				</div>
			</div>

			<ul v-if="versions.length" class="divide-y divide-slate-800 rounded-lg border border-slate-800">
				<li v-for="version in versions" :key="version.id" class="flex flex-wrap items-center gap-3 px-3 py-2.5">
					<UIcon name="i-lucide-file-clock" class="size-5 shrink-0 text-slate-500" />
					<div class="min-w-0 flex-1 text-sm">
						<p class="text-white">{{ formatDate(version.modified_at) }}</p>
						<p class="text-xs text-slate-500">
							{{ version.modified_by?.display_name ?? "Über einen Freigabelink" }} · {{ formatFileSize(version.size) }}
						</p>
					</div>
					<div class="flex items-center gap-1">
						<UButton
							icon="i-lucide-eye"
							color="neutral"
							variant="ghost"
							size="sm"
							aria-label="Ansehen"
							:to="versionLink(version)"
							@click="open = false"
						/>
						<UButton
							icon="i-lucide-download"
							color="neutral"
							variant="ghost"
							size="sm"
							aria-label="Herunterladen"
							:to="fileURL(version.content_url, true)"
							target="_blank"
						/>
						<UButton
							v-if="canEdit"
							label="Wiederherstellen"
							icon="i-lucide-history"
							color="neutral"
							variant="subtle"
							size="sm"
							:loading="restoring === version.id"
							@click="restore(version)"
						/>
					</div>
				</li>
			</ul>
			<p v-else-if="!loading" class="py-4 text-center text-sm text-slate-500">
				Noch keine früheren Versionen. Sobald jemand die Datei ändert, findest du die alte Fassung hier.
			</p>

			<p class="text-xs text-slate-500">
				Versionen bleiben 30 Tage erhalten, die zehn neuesten länger – höchstens 50 pro Datei.
			</p>
		</div>
	</DashboardModal>
</template>
