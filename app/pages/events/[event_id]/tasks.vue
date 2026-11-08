<script setup lang="ts">
/**
 * Event tasks — the reference page for event sub-pages: `useCurrentEvent()` for the event and
 * permissions, `useAPIAsyncData` with an event-specific key, header actions in `#right`,
 * `DashboardModal` + `UForm` for create/edit, `DashboardDeleteModal` for deletion.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { zPostEventsByEventIdTasksBody } from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { EventTask } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const userInfo = await useUserInfoStore().use();

useSeoMeta({ title: `Aufgaben | ${event.value.name} | CMP` });

// --- data ---------------------------------------------------------------------------------

const { active: filter, links: filterLinks } = useQueryTabs("filter", [
	{ value: "open", label: "Offen", icon: "i-lucide-circle-dashed" },
	{ value: "mine", label: "Meine", icon: "i-lucide-user-check" },
	{ value: "all", label: "Alle", icon: "i-lucide-list-checks" },
]);

const {
	data: tasks,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-tasks`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdTasks({ path: { eventId: eventId.value }, query: { filter: "all" } }),
	);
	if (!result.success) {
		toast.add({
			title: "Aufgaben konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as EventTask[];
	}
	return result.data;
});

const { data: members } = await useAPIAsyncData(`event-${eventId.value}-members`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : [];
});

const { data: groups } = await useAPIAsyncData(`event-${eventId.value}-groups`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdGroups({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : [];
});

const myGroupIds = computed(
	() =>
		new Set(
			(groups.value ?? [])
				.filter((group) => group.members.some((member) => member.id === userInfo.value?.id))
				.map((group) => group.id),
		),
);

function isMine(task: EventTask) {
	return (
		task.assignee_id === userInfo.value?.id ||
		(task.group_id !== null && myGroupIds.value.has(task.group_id))
	);
}

const visibleTasks = computed(() => {
	const all = tasks.value ?? [];
	if (filter.value === "mine") return all.filter(isMine);
	if (filter.value === "open") return all.filter((task) => task.status !== "done");
	return all;
});

const columns = computed(() =>
	TASK_STATUS_ORDER.map((status) => ({
		status,
		label: TASK_STATUS_LABELS[status],
		tasks: visibleTasks.value.filter((task) => task.status === status),
	})).filter((column) => filter.value !== "open" || column.status !== "done"),
);

// No `null` items: selects reset to `undefined` via their clear button (mapped to null on submit).
const assigneeOptions = computed(() =>
	(members.value ?? []).map((member) => ({
		label: member.user.display_name,
		value: member.user.id,
	})),
);

const groupOptions = computed(() =>
	(groups.value ?? []).map((group) => ({ label: group.name, value: group.id })),
);

// --- create / edit ------------------------------------------------------------------------

// The API takes `due_at` as unix ms; the form edits it as a `datetime-local` string.
const schema = zPostEventsByEventIdTasksBody.omit({ due_at: true }).extend({ due_at: z.string() });

const formOpen = ref(false);
const editing = ref<EventTask | null>(null);
const saving = ref(false);
const form = reactive({
	title: "",
	description: "",
	priority: "normal" as EventTask["priority"],
	status: "open" as EventTask["status"],
	due_at: "",
	assignee_id: undefined as number | undefined,
	group_id: undefined as number | undefined,
});

function openCreate() {
	editing.value = null;
	Object.assign(form, {
		title: "",
		description: "",
		priority: "normal",
		status: "open",
		due_at: "",
		assignee_id: undefined,
		group_id: undefined,
	});
	formOpen.value = true;
}

function openEdit(task: EventTask) {
	editing.value = task;
	Object.assign(form, {
		title: task.title,
		description: task.description,
		priority: task.priority,
		status: task.status,
		due_at: toDateTimeInput(task.due_at),
		assignee_id: task.assignee_id ?? undefined,
		group_id: task.group_id ?? undefined,
	});
	formOpen.value = true;
}

async function submit(_event: FormSubmitEvent<unknown>) {
	saving.value = true;
	const body = {
		title: form.title,
		description: form.description,
		priority: form.priority,
		status: form.status,
		due_at: fromDateTimeInput(form.due_at),
		assignee_id: form.assignee_id ?? null,
		group_id: form.group_id ?? null,
	};

	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdTasksByTaskId({
					path: { eventId: eventId.value, taskId: target.id },
					body,
				}),
			)
		: await useAPI((api) => api.postEventsByEventIdTasks({ path: { eventId: eventId.value }, body }));
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	toast.add({
		title: target ? "Aufgabe gespeichert" : "Aufgabe angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await refresh();
}

async function setStatus(task: EventTask, status: EventTask["status"]) {
	const result = await useAPI((api) =>
		api.putEventsByEventIdTasksByTaskId({
			path: { eventId: eventId.value, taskId: task.id },
			body: { status },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Status konnte nicht geändert werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	await refresh();
}

function canChangeStatus(task: EventTask) {
	return task.can_edit || isMine(task);
}

// --- delete -------------------------------------------------------------------------------

const deleteTarget = ref<EventTask | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdTasksByTaskId({ path: { eventId: eventId.value, taskId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Aufgabe gelöscht", color: "success" });
	await refresh();
}
</script>

<template>
	<UDashboardPanel id="event-tasks">
		<template #header>
			<DashboardPageHeader title="Aufgaben" icon="i-lucide-list-todo" :description="event.name">
				<template #right>
					<UButton v-if="can('tasks:create')" label="Neue Aufgabe" icon="i-lucide-plus" @click="openCreate" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<UNavigationMenu :items="filterLinks" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !tasks" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!visibleTasks.length"
					icon="i-lucide-list-checks"
					title="Keine Aufgaben"
					:description="filter === 'mine' ? 'Dir ist hier gerade nichts zugeteilt.' : 'Für dieses Event gibt es noch keine Aufgaben.'"
				>
					<template v-if="can('tasks:create')" #actions>
						<UButton label="Aufgabe anlegen" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</UEmpty>

				<div v-else class="grid gap-4 lg:grid-cols-3">
					<div v-for="column in columns" :key="column.status" class="space-y-3">
						<div class="flex items-center gap-2 text-sm font-medium text-slate-300">
							<UIcon :name="TASK_STATUS_ICONS[column.status]" class="size-4" />
							{{ column.label }}
							<UBadge :label="String(column.tasks.length)" color="neutral" variant="subtle" size="sm" />
						</div>

						<UCard
							v-for="task in column.tasks"
							:key="task.id"
							class="border-slate-800 bg-slate-900/60"
							:ui="{ body: 'space-y-2 p-4 sm:p-4' }"
						>
							<div class="flex items-start justify-between gap-2">
								<p :class="['font-medium', task.status === 'done' ? 'text-slate-500 line-through' : 'text-white']">
									{{ task.title }}
								</p>
								<UDropdownMenu
									v-if="task.can_edit || canChangeStatus(task)"
									:ui="{ viewport: 'main-bg-color' }"
									:items="[
										TASK_STATUS_ORDER.filter((s) => s !== task.status).map((s) => ({
											label: `Als „${TASK_STATUS_LABELS[s]}“ markieren`,
											icon: TASK_STATUS_ICONS[s],
											onSelect: () => setStatus(task, s),
										})),
										...(task.can_edit ? [[{ label: 'Bearbeiten', icon: 'i-lucide-pencil', onSelect: () => openEdit(task) }]] : []),
										...(task.can_delete
											? [[{ label: 'Löschen', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { deleteTarget = task; deleteOpen = true; } }]]
											: []),
									]"
								>
									<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
								</UDropdownMenu>
							</div>

							<p v-if="task.description" class="line-clamp-3 text-sm text-slate-400">{{ task.description }}</p>

							<div class="flex flex-wrap items-center gap-2 text-xs">
								<UBadge
									v-if="task.priority !== 'normal'"
									:label="TASK_PRIORITY_LABELS[task.priority]"
									:color="TASK_PRIORITY_COLORS[task.priority]"
									variant="subtle"
									size="sm"
								/>
								<span
									v-if="task.due_at"
									:class="[
										'flex items-center gap-1',
										task.status !== 'done' && task.due_at < Date.now() ? 'text-red-400' : 'text-slate-400',
									]"
								>
									<UIcon name="i-lucide-clock" class="size-3.5" /> {{ formatDate(task.due_at) }}
								</span>
								<span v-if="task.assignee" class="flex items-center gap-1 text-slate-400">
									<UAvatar :text="initials(task.assignee.display_name)" size="3xs" />
									{{ task.assignee.display_name }}
								</span>
								<UBadge v-if="task.group" :label="task.group.name" color="neutral" variant="outline" size="sm" />
							</div>
						</UCard>

						<p v-if="!column.tasks.length" class="rounded-lg border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">
							Nichts hier.
						</p>
					</div>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-list-plus'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Titel" name="title" required>
				<UInput v-model="form.title" class="w-full" autofocus />
			</UFormField>
			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="form.description" :rows="3" autoresize class="w-full" />
			</UFormField>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Zuständig" name="assignee_id">
					<USelectMenu
						v-model="form.assignee_id"
						:items="assigneeOptions"
						value-key="value"
						placeholder="Niemand"
						clear
						class="w-full"
					/>
				</UFormField>
				<UFormField label="Gruppe" name="group_id">
					<USelectMenu
						v-model="form.group_id"
						:items="groupOptions"
						value-key="value"
						placeholder="Keine Gruppe"
						clear
						class="w-full"
					/>
				</UFormField>
				<UFormField label="Priorität" name="priority">
					<USelect v-model="form.priority" :items="TASK_PRIORITY_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Status" name="status">
					<USelect v-model="form.status" :items="TASK_STATUS_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Fällig am" name="due_at" class="sm:col-span-2">
					<FormDateTimePicker v-model="form.due_at" default-time="18:00" clearable />
				</UFormField>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Aufgabe löschen"
		:warning-text="`Die Aufgabe „${deleteTarget?.title}“ wird gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
