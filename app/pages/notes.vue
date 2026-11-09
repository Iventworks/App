<script setup lang="ts">
/**
 * Personal notes: list (search, pinned first) + markdown editor. The open note lives in
 * `?note=<id>`; on phones the list and the editor are shown one at a time.
 */
import type { GetNotesResponses } from "~/api-client";

type Note = GetNotesResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Notizen | CMP", description: "Deine persönlichen Notizen" });

const route = useRoute();
const router = useRouter();
const toast = useToast();

const {
	data: notes,
	loading,
	refresh,
} = await useAPIAsyncData("personal-notes", async () => {
	const result = await useAPI((api) => api.getNotes({}));
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
	const all = notes.value ?? [];
	if (!term) return all;
	return all.filter(
		(note) => note.title.toLowerCase().includes(term) || note.content.toLowerCase().includes(term),
	);
});

function preview(content: string) {
	return content
		.replace(/[#>*_`~[\]()-]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

// --- selection & editor state -------------------------------------------------------------

const selectedId = computed(() => {
	const id = Number(route.query.note);
	return Number.isInteger(id) && id > 0 ? id : null;
});

const selectedNote = computed(
	() => notes.value?.find((note) => note.id === selectedId.value) ?? null,
);

const draft = reactive({ title: "", content: "", pinned: false });
const saving = ref(false);

function loadDraft(note: Note | null) {
	draft.title = note?.title ?? "";
	draft.content = note?.content ?? "";
	draft.pinned = note?.pinned ?? false;
}

watch(
	selectedNote,
	(note, previous) => {
		// Only reset the draft when another note is opened, not when the list refreshes.
		if (note?.id !== previous?.id) loadDraft(note);
	},
	{ immediate: true },
);

const isDirty = computed(() => {
	const note = selectedNote.value;
	if (!note) return false;
	return (
		draft.title !== note.title || draft.content !== note.content || draft.pinned !== note.pinned
	);
});

function navigateToNote(id: number | null) {
	const query = { ...route.query };
	if (id) query.note = String(id);
	else delete query.note;
	return router.push({ query });
}

// Switching away from unsaved changes asks first.
const pendingSwitch = ref<{ id: number | null } | null>(null);

function openNote(id: number | null) {
	if (id === selectedId.value) return;
	if (isDirty.value) {
		pendingSwitch.value = { id };
		return;
	}
	void navigateToNote(id);
}

async function resolvePendingSwitch(action: "save" | "discard") {
	const target = pendingSwitch.value;
	pendingSwitch.value = null;
	if (!target) return;
	if (action === "save") {
		const saved = await save();
		if (!saved) return;
	} else {
		loadDraft(selectedNote.value);
	}
	await navigateToNote(target.id);
}

// --- create / save / delete ---------------------------------------------------------------

const creating = ref(false);

async function createNote() {
	if (isDirty.value) {
		const saved = await save();
		if (!saved) return;
	}
	creating.value = true;
	const result = await useAPI((api) =>
		api.postNotes({ body: { title: "Neue Notiz", content: "" } }),
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
	await navigateToNote(result.data.id);
}

async function save() {
	const note = selectedNote.value;
	if (!note) return false;
	if (!draft.title.trim()) {
		toast.add({ title: "Bitte gib einen Titel ein", color: "warning" });
		return false;
	}
	saving.value = true;
	const result = await useAPI((api) =>
		api.putNotesByNoteId({
			path: { noteId: note.id },
			body: { title: draft.title.trim(), content: draft.content, pinned: draft.pinned },
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return false;
	}
	await refresh();
	loadDraft(notes.value?.find((entry) => entry.id === note.id) ?? null);
	toast.add({ title: "Notiz gespeichert", color: "success", icon: "i-lucide-check" });
	return true;
}

defineShortcuts({
	meta_s: {
		usingInput: true,
		handler: () => {
			if (isDirty.value) void save();
		},
	},
});

const deleteOpen = ref(false);

async function confirmDelete() {
	const note = selectedNote.value;
	if (!note) return;
	const result = await useAPI((api) => api.deleteNotesByNoteId({ path: { noteId: note.id } }));
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Notiz gelöscht", color: "success" });
	await navigateToNote(null);
	await refresh();
}

// Warn before leaving the page with unsaved changes.
onBeforeRouteLeave(() => {
	if (isDirty.value) {
		return window.confirm("Du hast ungespeicherte Änderungen. Seite trotzdem verlassen?");
	}
});
</script>

<template>
	<UDashboardPanel id="notes">
		<template #header>
			<DashboardPageHeader title="Notizen" icon="i-lucide-notebook-pen" description="Nur für dich sichtbar" />
		</template>

		<template #body>
			<DashboardFilterBar :class="selectedNote ? 'hidden lg:block' : ''">
				<template #left>
					<UInput v-model="search" icon="i-lucide-search" placeholder="Notizen durchsuchen" class="w-full sm:w-64" />
				</template>
				<template #right>
					<UButton label="Neue Notiz" icon="i-lucide-plus" :loading="creating" @click="createNote" />
				</template>
			</DashboardFilterBar>

			<div class="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
				<!-- List -->
				<aside :class="['flex flex-col gap-3 lg:w-80 lg:shrink-0', selectedNote ? 'hidden lg:flex' : 'flex']">
					<div v-if="loading && !notes" class="flex justify-center py-12">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
					</div>

					<UEmpty
						v-else-if="!filteredNotes.length"
						icon="i-lucide-notebook"
						:title="search ? 'Nichts gefunden' : 'Noch keine Notizen'"
						:description="search ? 'Keine Notiz passt zu deiner Suche.' : 'Halte Ideen, Listen und Gedanken für dich fest.'"
						variant="naked"
					/>

					<ul v-else class="space-y-1.5">
						<li v-for="note in filteredNotes" :key="note.id">
							<button
								type="button"
								:class="[
									'w-full rounded-lg border px-3 py-2.5 text-left transition',
									note.id === selectedId
										? 'border-primary/50 bg-primary/10'
										: 'border-slate-800 bg-slate-900/60 hover:border-slate-700',
								]"
								@click="openNote(note.id)"
							>
								<p class="flex items-center gap-1.5 text-sm font-medium text-white">
									<UIcon v-if="note.pinned" name="i-lucide-pin" class="size-3.5 shrink-0 text-primary-400" />
									<span class="truncate">{{ note.title }}</span>
								</p>
								<p class="mt-0.5 line-clamp-2 text-xs text-slate-400">
									{{ preview(note.content) || "Leer" }}
								</p>
								<p class="mt-1 text-[11px] text-slate-500">{{ formatRelative(note.updated_at) }}</p>
							</button>
						</li>
					</ul>
				</aside>

				<!-- Editor -->
				<section :class="['min-w-0 flex-1', selectedNote ? 'block' : 'hidden lg:block']">
					<div
						v-if="!selectedNote"
						class="flex h-full min-h-64 items-center justify-center rounded-xl border border-dashed border-slate-800"
					>
						<UEmpty
							icon="i-lucide-mouse-pointer-click"
							title="Keine Notiz geöffnet"
							description="Wähle links eine Notiz aus oder leg eine neue an."
							variant="naked"
						/>
					</div>

					<div v-else class="space-y-3">
						<div class="flex flex-wrap items-center gap-2">
							<UButton
								icon="i-lucide-arrow-left"
								color="neutral"
								variant="ghost"
								class="lg:hidden"
								aria-label="Zurück zur Liste"
								@click="openNote(null)"
							/>
							<UInput
								v-model="draft.title"
								placeholder="Titel"
								size="lg"
								variant="none"
								class="min-w-0 flex-1"
								:ui="{ base: 'text-lg font-semibold px-0' }"
							/>
							<UTooltip :text="draft.pinned ? 'Nicht mehr anheften' : 'Anheften'">
								<UButton
									:icon="draft.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'"
									:color="draft.pinned ? 'primary' : 'neutral'"
									variant="ghost"
									:aria-label="draft.pinned ? 'Nicht mehr anheften' : 'Anheften'"
									@click="draft.pinned = !draft.pinned"
								/>
							</UTooltip>
							<UButton
								icon="i-lucide-trash-2"
								color="error"
								variant="ghost"
								aria-label="Notiz löschen"
								@click="deleteOpen = true"
							/>
							<UButton
								label="Speichern"
								icon="i-lucide-save"
								:loading="saving"
								:disabled="!isDirty"
								@click="save"
							/>
						</div>

						<p class="flex items-center gap-1.5 text-xs" :class="isDirty ? 'text-amber-400' : 'text-slate-500'">
							<UIcon :name="isDirty ? 'i-lucide-circle-dot' : 'i-lucide-check'" class="size-3.5" />
							{{ isDirty ? "Ungespeicherte Änderungen (Strg/⌘ + S zum Speichern)" : `Gespeichert ${formatRelative(selectedNote.updated_at)}` }}
						</p>

						<FormMarkdownEditor
							:key="selectedNote.id"
							v-model="draft.content"
							placeholder="Schreib los …"
							min-height="min-h-96"
						/>
					</div>
				</section>
			</div>
		</template>
	</UDashboardPanel>

	<DashboardModal
		:open="pendingSwitch !== null"
		title="Ungespeicherte Änderungen"
		icon="i-lucide-circle-alert"
		icon-color="amber"
		@update:open="(open: boolean) => { if (!open) pendingSwitch = null; }"
	>
		<p class="text-sm text-slate-300">Die geöffnete Notiz hat ungespeicherte Änderungen.</p>
		<template #footer>
			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="pendingSwitch = null" />
				<UButton label="Verwerfen" color="error" variant="subtle" @click="resolvePendingSwitch('discard')" />
				<UButton label="Speichern" icon="i-lucide-save" :loading="saving" @click="resolvePendingSwitch('save')" />
			</div>
		</template>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Notiz löschen"
		:warning-text="`Die Notiz „${selectedNote?.title}“ wird gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
