<script setup lang="ts">
/**
 * Event notes: one shared notebook for all staff ("Alle Mitarbeitenden") plus one per group the
 * caller belongs to (leaders see every group). Event-wide notes are collaborative — any staff
 * member may edit them; deleting is up to the author and the leaders.
 */
import type {
	GetEventsByEventIdGroupsResponses,
	GetEventsByEventIdNotesResponses,
} from "~/api-client";
import { zPostEventsByEventIdNotesBody } from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type EventNote = GetEventsByEventIdNotesResponses["200"]["data"][number];
type EventGroup = GetEventsByEventIdGroupsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const user = await useUserInfoStore().use();
const route = useRoute();
const router = useRouter();
const toast = useToast();

useSeoMeta({ title: `Notizen | ${event.value.name} | CMP` });

// --- data ---------------------------------------------------------------------------------

const {
	data: notes,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-notes`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdNotes({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Notizen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as EventNote[];
	}
	return result.data;
});

const { data: groups } = await useAPIAsyncData(`event-${eventId.value}-groups`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdGroups({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : ([] as EventGroup[]);
});

const visibleGroups = computed(() =>
	(groups.value ?? []).filter(
		(group) =>
			can("notes:manage_all") || group.members.some((member) => member.id === user.value?.id),
	),
);

// --- selection (kept in the URL) ----------------------------------------------------------

const activeGroupId = computed(() =>
	activeTab.value === "event" ? null : Number(activeTab.value),
);

const tabs = computed(() => [
	{ label: "Alle Mitarbeitenden", value: "event", icon: "i-lucide-users" },
	...visibleGroups.value.map((group) => ({
		label: group.name,
		value: String(group.id),
		icon: "i-lucide-users-round",
	})),
]);

// The group tab lives in `?group=`; switching it drops the open note (`?note=`).
const { active: activeTab, links: tabLinks } = useQueryTabs("group", tabs, { resetKeys: ["note"] });

onBeforeRouteUpdate((to, from) => {
	if (to.query.group !== from.query.group && !confirmDiscard()) return false;
});

const tabNotes = computed(() =>
	(notes.value ?? [])
		.filter((note) => (note.group_id ?? null) === activeGroupId.value)
		.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at),
);

const selectedId = computed<number | "new" | null>(() => {
	const raw = route.query.note;
	if (raw === "new") return "new";
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : null;
});

const selectedNote = computed(() =>
	typeof selectedId.value === "number"
		? ((notes.value ?? []).find((note) => note.id === selectedId.value) ?? null)
		: null,
);

function select(id: number | "new" | null) {
	if (!confirmDiscard()) return;
	const query = { ...route.query };
	if (id === null) delete query.note;
	else query.note = String(id);
	void router.replace({ query });
}

// --- editor state -------------------------------------------------------------------------

const schema = zPostEventsByEventIdNotesBody;

const editor = reactive({ title: "", content: "", pinned: false });
const original = ref({ title: "", content: "", pinned: false });
const saving = ref(false);

watch(
	[selectedId, selectedNote],
	() => {
		const note = selectedNote.value;
		const values = note
			? { title: note.title, content: note.content, pinned: note.pinned }
			: { title: "", content: "", pinned: false };
		Object.assign(editor, values);
		original.value = { ...values };
	},
	{ immediate: true },
);

const isEditing = computed(
	() => selectedId.value === "new" || Boolean(selectedNote.value?.can_edit),
);

const dirty = computed(
	() =>
		isEditing.value &&
		(editor.title !== original.value.title ||
			editor.content !== original.value.content ||
			editor.pinned !== original.value.pinned),
);

function confirmDiscard() {
	return !dirty.value || window.confirm("Ungespeicherte Änderungen verwerfen?");
}

const canCreate = computed(() => {
	if (!can("notes:create")) return false;
	if (activeGroupId.value === null) return true;
	return (
		can("notes:manage_all") ||
		visibleGroups.value.some(
			(group) =>
				group.id === activeGroupId.value &&
				group.members.some((member) => member.id === user.value?.id),
		)
	);
});

async function save() {
	if (!isEditing.value || saving.value) return;
	const title = editor.title.trim();
	if (!title) {
		toast.add({ title: "Bitte gib einen Titel ein", color: "warning" });
		return;
	}

	saving.value = true;
	const note = selectedNote.value;
	const result = note
		? await useAPI((api) =>
				api.putEventsByEventIdNotesByNoteId({
					path: { eventId: eventId.value, noteId: note.id },
					body: { title, content: editor.content, pinned: editor.pinned },
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdNotes({
					path: { eventId: eventId.value },
					body: {
						title,
						content: editor.content,
						pinned: editor.pinned,
						group_id: activeGroupId.value,
					},
				}),
			);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	original.value = { title, content: editor.content, pinned: editor.pinned };
	editor.title = title;
	toast.add({ title: "Notiz gespeichert", color: "success", icon: "i-lucide-check" });
	await refresh();
	if (!note) {
		void router.replace({ query: { ...route.query, note: String(result.data.id) } });
	}
}

defineShortcuts({
	meta_s: { usingInput: true, handler: () => void save() },
});

// --- delete -------------------------------------------------------------------------------

const deleteOpen = ref(false);

async function confirmDelete() {
	const note = selectedNote.value;
	if (!note) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdNotesByNoteId({ path: { eventId: eventId.value, noteId: note.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Notiz gelöscht", color: "success" });
	original.value = { ...editor };
	select(null);
	await refresh();
}

const activeGroup = computed(() =>
	visibleGroups.value.find((group) => group.id === activeGroupId.value),
);
</script>

<template>
	<UDashboardPanel id="event-notes">
		<template #header>
			<DashboardPageHeader title="Notizen" icon="i-lucide-sticky-note" :description="event.name">
				<template #right>
					<UButton v-if="canCreate" label="Neue Notiz" icon="i-lucide-plus" @click="select('new')" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar v-if="tabs.length > 1">
				<UNavigationMenu :items="tabLinks" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !notes" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<div v-else class="grid gap-6 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
					<!-- note list -->
					<div :class="['space-y-2', selectedId !== null ? 'hidden lg:block' : '']">
						<p class="text-sm text-slate-400">
							<template v-if="activeGroup">Nur für die Gruppe „{{ activeGroup.name }}“ sichtbar.</template>
							<template v-else>Für alle Mitarbeitenden dieses Events sichtbar und bearbeitbar.</template>
						</p>

						<UEmpty
							v-if="!tabNotes.length"
							icon="i-lucide-notebook"
							title="Noch keine Notizen"
							description="Halte Absprachen, Infos und Listen fürs Team fest."
							variant="naked"
						>
							<template v-if="canCreate" #actions>
								<UButton label="Notiz anlegen" icon="i-lucide-plus" @click="select('new')" />
							</template>
						</UEmpty>

						<button
							v-for="note in tabNotes"
							:key="note.id"
							type="button"
							:class="[
								'w-full rounded-lg border px-4 py-3 text-left transition',
								note.id === selectedId
									? 'border-primary/60 bg-primary/10'
									: 'border-slate-800 bg-slate-900/60 hover:border-slate-700',
							]"
							@click="select(note.id)"
						>
							<p class="flex items-center gap-2 font-medium text-white">
								<UIcon v-if="note.pinned" name="i-lucide-pin" class="size-4 shrink-0 text-primary-400" />
								<span class="truncate">{{ note.title }}</span>
							</p>
							<p class="mt-1 truncate text-xs text-slate-500">
								{{ note.updater?.display_name ?? note.creator?.display_name ?? "Unbekannt" }} ·
								{{ formatRelative(note.updated_at) }}
							</p>
						</button>
					</div>

					<!-- editor / viewer -->
					<div v-if="selectedId !== null" class="min-w-0 space-y-4">
						<UButton
							label="Alle Notizen"
							icon="i-lucide-arrow-left"
							color="neutral"
							variant="ghost"
							size="sm"
							class="lg:hidden"
							@click="select(null)"
						/>

						<UEmpty
							v-if="selectedId !== 'new' && !selectedNote"
							icon="i-lucide-file-question"
							title="Notiz nicht gefunden"
							description="Sie wurde gelöscht oder ist in diesem Bereich nicht sichtbar."
						/>

						<UForm v-else-if="isEditing" :schema="schema" :state="editor" class="space-y-4" @submit="save">
							<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
								<UFormField name="title" class="flex-1">
									<UInput
										v-model="editor.title"
										placeholder="Titel"
										size="xl"
										variant="none"
										class="w-full"
										:ui="{ base: 'px-0 text-xl font-semibold' }"
									/>
								</UFormField>
								<USwitch v-model="editor.pinned" label="Angepinnt" />
							</div>

							<FormMarkdownEditor
								:key="selectedId ?? 'none'"
								v-model="editor.content"
								placeholder="Absprachen, Listen, Infos …"
								min-height="min-h-80"
							/>

							<div class="flex flex-wrap items-center justify-between gap-3">
								<p v-if="selectedNote" class="text-xs text-slate-500">
									Erstellt von {{ selectedNote.creator?.display_name ?? "Unbekannt" }} · zuletzt
									geändert {{ formatRelative(selectedNote.updated_at) }}
									<template v-if="selectedNote.updater"> von {{ selectedNote.updater.display_name }}</template>
								</p>
								<span v-else />
								<div class="flex gap-2">
									<UButton
										v-if="selectedNote?.can_delete"
										label="Löschen"
										icon="i-lucide-trash-2"
										color="error"
										variant="ghost"
										@click="deleteOpen = true"
									/>
									<UButton
										type="submit"
										:label="dirty || selectedId === 'new' ? 'Speichern' : 'Gespeichert'"
										icon="i-lucide-save"
										:loading="saving"
										:disabled="!dirty && selectedId !== 'new'"
									/>
								</div>
							</div>
						</UForm>

						<DashboardSectionCard
							v-else-if="selectedNote"
							:title="selectedNote.title"
							:description="`${selectedNote.updater?.display_name ?? selectedNote.creator?.display_name ?? 'Unbekannt'} · ${formatRelative(selectedNote.updated_at)}`"
							:icon="selectedNote.pinned ? 'i-lucide-pin' : 'i-lucide-sticky-note'"
						>
							<ContentMarkdownView :content="selectedNote.content" />
						</DashboardSectionCard>
					</div>

					<div
						v-else
						class="hidden items-center justify-center rounded-xl border border-dashed border-slate-800 p-10 text-sm text-slate-500 lg:flex"
					>
						Wähle links eine Notiz aus<template v-if="canCreate"> oder lege eine neue an</template>.
					</div>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Notiz löschen"
		:warning-text="`Die Notiz „${selectedNote?.title}“ wird für alle gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
