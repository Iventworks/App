<script setup lang="ts">
/** Kernteam: internal notes shared by the whole core team (list + markdown editor). */
import type { GetOrgCoreTeamNotesResponses } from "~/api-client";

type Note = GetOrgCoreTeamNotesResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Interne Notizen | Kernteam" });

const toast = useToast();

const {
	data: notes,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-notes", async () => {
	const result = await useAPI((api) => api.getOrgCoreTeamNotes({}));
	if (!result.success) {
		toast.add({
			title: "Notizen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Note[];
	}
	return result.data;
});

const search = ref("");
const filteredNotes = computed(() => {
	const term = search.value.trim().toLowerCase();
	const list = notes.value ?? [];
	if (!term) return list;
	return list.filter(
		(note) => note.title.toLowerCase().includes(term) || note.content.toLowerCase().includes(term),
	);
});

// --- selection & editing -------------------------------------------------------------------

const selectedId = ref<number | null>(null);
const selected = computed(
	() => (notes.value ?? []).find((note) => note.id === selectedId.value) ?? null,
);

const draft = reactive({ title: "", content: "", pinned: false });
// Bumped on every note switch so the (uncontrolled) markdown editor re-mounts with new content.
const editorKey = ref(0);
const saving = ref(false);

function select(note: Note) {
	selectedId.value = note.id;
	Object.assign(draft, { title: note.title, content: note.content, pinned: note.pinned });
	editorKey.value++;
}

const dirty = computed(
	() =>
		Boolean(selected.value) &&
		(draft.title !== selected.value!.title ||
			draft.content !== selected.value!.content ||
			draft.pinned !== selected.value!.pinned),
);

async function save() {
	const target = selected.value;
	if (!target || !draft.title.trim()) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.putOrgCoreTeamNotesByNoteId({
			path: { noteId: target.id },
			body: { title: draft.title.trim(), content: draft.content, pinned: draft.pinned },
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Notiz gespeichert", color: "success", icon: "i-lucide-check" });
	await refresh();
}

const creating = ref(false);

async function createNote() {
	creating.value = true;
	const result = await useAPI((api) =>
		api.postOrgCoreTeamNotes({ body: { title: "Neue Notiz", content: "", pinned: false } }),
	);
	creating.value = false;
	if (!result.success) {
		toast.add({
			title: "Notiz konnte nicht angelegt werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	await refresh();
	const created = (notes.value ?? []).find((note) => note.id === result.data.id);
	if (created) select(created);
}

const deleteOpen = ref(false);

async function confirmDelete() {
	const target = selected.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteOrgCoreTeamNotesByNoteId({ path: { noteId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Notiz gelöscht", color: "success" });
	selectedId.value = null;
	await refresh();
}

defineShortcuts({
	meta_s: {
		usingInput: true,
		handler: () => {
			if (dirty.value) void save();
		},
	},
});
</script>

<template>
	<UDashboardPanel id="core-team-notes">
		<template #header>
			<DashboardPageHeader
				title="Interne Notizen"
				icon="i-lucide-notebook-tabs"
				description="Nur für das Kernteam sichtbar"
			/>
		</template>

		<template #body>
			<DashboardFilterBar :class="selected ? 'hidden lg:block' : ''">
				<template #left>
					<UInput v-model="search" icon="i-lucide-search" placeholder="Notizen durchsuchen" class="w-full sm:w-64" />
				</template>
				<template #right>
					<UButton label="Neue Notiz" icon="i-lucide-plus" :loading="creating" @click="createNote" />
				</template>
			</DashboardFilterBar>

			<div class="grid min-h-0 flex-1 gap-6 lg:grid-cols-[18rem_1fr]">
				<!-- List -->
				<div :class="['flex min-h-0 flex-col gap-3', selected ? 'hidden lg:flex' : '']">
					<div v-if="loading && !notes" class="flex justify-center py-12">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
					</div>

					<UEmpty
						v-else-if="!filteredNotes.length"
						icon="i-lucide-notebook"
						:title="search ? 'Nichts gefunden' : 'Noch keine Notizen'"
						:description="search ? undefined : 'Halte Absprachen, Protokolle und Ideen des Kernteams fest.'"
						variant="naked"
					/>

					<ul v-else class="space-y-1 overflow-y-auto">
						<li v-for="note in filteredNotes" :key="note.id">
							<button
								type="button"
								:class="[
									'w-full rounded-lg border px-3 py-2.5 text-left transition',
									note.id === selectedId
										? 'border-primary/50 bg-primary/10'
										: 'border-transparent hover:bg-slate-800/50',
								]"
								@click="select(note)"
							>
								<p class="flex items-center gap-1.5 truncate text-sm font-medium text-white">
									<UIcon v-if="note.pinned" name="i-lucide-pin" class="size-3.5 shrink-0 text-primary-400" />
									<span class="truncate">{{ note.title }}</span>
								</p>
								<p class="line-clamp-1 text-xs text-slate-500">
									{{ note.content.replace(/[#*_>`-]/g, "").slice(0, 120) || "Leer" }}
								</p>
								<p class="mt-1 text-xs text-slate-600">
									{{ note.updater?.display_name ?? note.creator?.display_name ?? "Unbekannt" }} ·
									{{ formatRelative(note.updated_at) }}
								</p>
							</button>
						</li>
					</ul>
				</div>

				<!-- Editor -->
				<div v-if="selected" class="flex min-h-0 flex-col gap-4">
					<div class="flex flex-wrap items-center gap-2">
						<UButton
							icon="i-lucide-arrow-left"
							color="neutral"
							variant="ghost"
							class="lg:hidden"
							aria-label="Zurück zur Liste"
							@click="selectedId = null"
						/>
						<UInput
							v-model="draft.title"
							variant="none"
							size="xl"
							placeholder="Titel"
							class="min-w-0 flex-1"
							:ui="{ base: 'text-xl font-semibold px-0' }"
						/>
						<UTooltip :text="draft.pinned ? 'Lösen' : 'Anheften'">
							<UButton
								:icon="draft.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'"
								color="neutral"
								:variant="draft.pinned ? 'soft' : 'ghost'"
								:aria-label="draft.pinned ? 'Lösen' : 'Anheften'"
								@click="draft.pinned = !draft.pinned"
							/>
						</UTooltip>
						<UButton
							v-if="selected.can_delete"
							icon="i-lucide-trash-2"
							color="error"
							variant="ghost"
							aria-label="Notiz löschen"
							@click="deleteOpen = true"
						/>
						<UButton
							label="Speichern"
							icon="i-lucide-save"
							:disabled="!dirty || !draft.title.trim()"
							:loading="saving"
							@click="save"
						/>
					</div>

					<FormMarkdownEditor
						:key="editorKey"
						v-model="draft.content"
						placeholder="Schreib etwas …"
						min-height="min-h-96"
					/>

					<p class="text-xs text-slate-500">
						Erstellt von {{ selected.creator?.display_name ?? "Unbekannt" }} am {{ formatDate(selected.created_at) }}
						<template v-if="selected.updater"> · zuletzt bearbeitet von {{ selected.updater.display_name }} {{ formatRelative(selected.updated_at) }}</template>
						<template v-if="dirty"> · <span class="text-amber-400">ungespeicherte Änderungen</span></template>
					</p>
				</div>

				<div v-else class="hidden items-center justify-center rounded-xl border border-dashed border-slate-800 lg:flex">
					<UEmpty
						icon="i-lucide-mouse-pointer-click"
						title="Keine Notiz ausgewählt"
						description="Wähle links eine Notiz aus oder lege eine neue an."
						variant="naked"
					/>
				</div>
			</div>
		</template>
	</UDashboardPanel>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Notiz löschen"
		:warning-text="`Die Notiz „${selected?.title}“ wird für das ganze Kernteam gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
