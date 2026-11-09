<script setup lang="ts">
/**
 * "Todos from everything": personal to-dos plus event tasks assigned to the user or one of their
 * groups, grouped by due date. Personal tasks are edited here; event tasks link to their event.
 */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { GetTasksResponses } from "~/api-client";
import { zPostTasksBody } from "~/api-client/zod.gen";

type MyTask = GetTasksResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Meine Aufgaben", description: "Alle deine Aufgaben an einem Ort" });

const route = useRoute();
const router = useRouter();
const toast = useToast();

const { value: scope, items: scopeItems } = useQueryFilter("scope", [
	{ value: "all", label: "Alle", icon: "i-lucide-list-checks" },
	{ value: "personal", label: "Persönlich", icon: "i-lucide-user" },
	{ value: "assigned", label: "Aus Events", icon: "i-lucide-tent" },
]);
const showDone = ref(false);

const {
	data: tasks,
	loading,
	refresh,
} = await useAPIAsyncData("personal-tasks", async () => {
	const result = await useAPI((api) =>
		api.getTasks({
			query: { scope: scope.value, include_done: showDone.value ? "true" : "false" },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Aufgaben konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as MyTask[];
	}
	return result.data;
});

watch([scope, showDone], () => refresh());

// --- grouping -----------------------------------------------------------------------------

type GroupKey = "overdue" | "today" | "week" | "later" | "none" | "done";

const GROUPS: { key: GroupKey; label: string; icon: string; tone: string }[] = [
	{ key: "overdue", label: "Überfällig", icon: "i-lucide-alarm-clock", tone: "text-red-400" },
	{ key: "today", label: "Heute", icon: "i-lucide-sun", tone: "text-amber-400" },
	{ key: "week", label: "Nächste 7 Tage", icon: "i-lucide-calendar-days", tone: "text-primary-400" },
	{ key: "later", label: "Später", icon: "i-lucide-calendar-clock", tone: "text-slate-400" },
	{ key: "none", label: "Ohne Datum", icon: "i-lucide-inbox", tone: "text-slate-400" },
	{ key: "done", label: "Erledigt", icon: "i-lucide-circle-check", tone: "text-emerald-400" },
];

function groupOf(task: MyTask): GroupKey {
	if (task.status === "done") return "done";
	if (!task.due_at) return "none";
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfTomorrow = startOfToday + 86_400_000;
	if (task.due_at < Date.now()) return "overdue";
	if (task.due_at < startOfTomorrow) return "today";
	if (task.due_at < startOfToday + 8 * 86_400_000) return "week";
	return "later";
}

const grouped = computed(() =>
	GROUPS.map((group) => ({
		...group,
		tasks: (tasks.value ?? []).filter((task) => groupOf(task) === group.key),
	})).filter((group) => group.tasks.length > 0),
);

const openCount = computed(
	() => (tasks.value ?? []).filter((task) => task.status !== "done").length,
);

// --- toggle done --------------------------------------------------------------------------

const busy = ref<Set<number>>(new Set());

async function setStatus(task: MyTask, status: MyTask["status"]) {
	busy.value = new Set([...busy.value, task.id]);
	const eventId = task.event_id;
	const result =
		task.source === "event" && eventId
			? await useAPI((api) =>
					api.putEventsByEventIdTasksByTaskId({
						path: { eventId, taskId: task.id },
						body: { status },
					}),
				)
			: await useAPI((api) => api.putTasksByTaskId({ path: { taskId: task.id }, body: { status } }));

	const next = new Set(busy.value);
	next.delete(task.id);
	busy.value = next;

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

function toggleDone(task: MyTask) {
	return setStatus(task, task.status === "done" ? "open" : "done");
}

// --- create / edit personal tasks ---------------------------------------------------------

// The API takes `due_at` as unix ms; the form edits it as a `datetime-local` string.
const schema = zPostTasksBody.omit({ due_at: true }).extend({ due_at: z.string() });

const formOpen = ref(false);
const editing = ref<MyTask | null>(null);
const saving = ref(false);
const form = reactive({
	title: "",
	description: "",
	priority: "normal" as MyTask["priority"],
	status: "open" as MyTask["status"],
	due_at: "",
});

function openCreate() {
	editing.value = null;
	Object.assign(form, {
		title: "",
		description: "",
		priority: "normal",
		status: "open",
		due_at: "",
	});
	formOpen.value = true;
}

function openEdit(task: MyTask) {
	editing.value = task;
	Object.assign(form, {
		title: task.title,
		description: task.description,
		priority: task.priority,
		status: task.status,
		due_at: toDateTimeInput(task.due_at),
	});
	formOpen.value = true;
}

// `/tasks?new=1` (e.g. from the dashboard) opens the create dialog right away.
onMounted(() => {
	if (route.query.new) {
		openCreate();
		const { new: _new, ...query } = route.query;
		void router.replace({ query });
	}
});

async function submit(_event: FormSubmitEvent<unknown>) {
	saving.value = true;
	const body = {
		title: form.title,
		description: form.description,
		priority: form.priority,
		status: form.status,
		due_at: fromDateTimeInput(form.due_at),
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) => api.putTasksByTaskId({ path: { taskId: target.id }, body }))
		: await useAPI((api) => api.postTasks({ body }));
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

// --- delete -------------------------------------------------------------------------------

const deleteTarget = ref<MyTask | null>(null);
const deleteOpen = ref(false);

function openDelete(task: MyTask) {
	deleteTarget.value = task;
	deleteOpen.value = true;
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) => api.deleteTasksByTaskId({ path: { taskId: target.id } }));
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Aufgabe gelöscht", color: "success" });
	await refresh();
}

function taskActions(task: MyTask) {
	if (task.source === "event") {
		return [
			[
				{
					label: "Im Event öffnen",
					icon: "i-lucide-external-link",
					to: `/events/${task.event_id}/tasks`,
				},
			],
		];
	}
	return [
		[
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(task) },
			...TASK_STATUS_ORDER.filter((status) => status !== task.status).map((status) => ({
				label: `Als „${TASK_STATUS_LABELS[status]}“ markieren`,
				icon: TASK_STATUS_ICONS[status],
				onSelect: () => setStatus(task, status),
			})),
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => openDelete(task),
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="my-tasks">
		<template #header>
			<DashboardPageHeader
				title="Meine Aufgaben"
				icon="i-lucide-list-checks"
				:description="`${openCount} offen`"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<USelect
							v-model="scope"
							:items="scopeItems"
							:icon="scopeItems.find((item) => item.value === scope)?.icon"
							class="w-full sm:w-44"
							aria-label="Aufgaben filtern"
						/>
						<USwitch v-model="showDone" label="Erledigte anzeigen" />
					</template>
					<template #right>
						<UButton label="Neue Aufgabe" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !tasks" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!grouped.length"
					icon="i-lucide-party-popper"
					title="Alles erledigt!"
					:description="
						scope === 'assigned'
							? 'Dir ist in deinen Events gerade keine Aufgabe zugeteilt.'
							: 'Du hast keine offenen Aufgaben. Leg dir eine persönliche Aufgabe an, wenn du an etwas denken willst.'
					"
				/>

				<div v-else class="space-y-6">
					<section v-for="group in grouped" :key="group.key">
						<h3 :class="['mb-2 flex items-center gap-2 text-sm font-semibold', group.tone]">
							<UIcon :name="group.icon" class="size-4" />
							{{ group.label }}
							<UBadge :label="String(group.tasks.length)" color="neutral" variant="subtle" size="sm" />
						</h3>

						<UCard
							:class="[
								'bg-slate-900/60',
								group.key === 'overdue' ? 'border-red-900/60' : 'border-slate-800',
							]"
							:ui="{ body: 'p-0 sm:p-0' }"
						>
							<ul class="divide-y divide-slate-800">
								<li v-for="task in group.tasks" :key="task.id" class="flex items-start gap-3 px-4 py-3">
									<UCheckbox
										:model-value="task.status === 'done'"
										:disabled="busy.has(task.id)"
										class="mt-0.5"
										:aria-label="task.status === 'done' ? 'Als offen markieren' : 'Als erledigt markieren'"
										@update:model-value="toggleDone(task)"
									/>

									<div class="min-w-0 flex-1">
										<button
											type="button"
											class="block w-full text-left"
											:disabled="task.source === 'event'"
											@click="task.source === 'personal' && openEdit(task)"
										>
											<p
												:class="[
													'text-sm font-medium',
													task.status === 'done' ? 'text-slate-500 line-through' : 'text-white',
												]"
											>
												{{ task.title }}
											</p>
											<p v-if="task.description" class="mt-0.5 line-clamp-2 text-xs text-slate-400">
												{{ task.description }}
											</p>
										</button>

										<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
											<span
												v-if="task.due_at"
												:class="[
													'flex items-center gap-1',
													task.is_overdue && task.status !== 'done' ? 'text-red-400' : 'text-slate-400',
												]"
											>
												<UIcon name="i-lucide-clock" class="size-3.5" />
												{{ formatDate(task.due_at) }}
											</span>
											<UBadge
												v-if="task.status === 'in_progress'"
												label="In Arbeit"
												color="info"
												variant="subtle"
												size="sm"
											/>
											<UBadge
												v-if="task.priority !== 'normal'"
												:label="TASK_PRIORITY_LABELS[task.priority]"
												:color="TASK_PRIORITY_COLORS[task.priority]"
												variant="subtle"
												size="sm"
											/>
											<NuxtLink
												v-if="task.event"
												:to="`/events/${task.event.id}/tasks`"
												class="inline-flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:text-white"
											>
												<UIcon name="i-lucide-tent" class="size-3" />
												{{ task.event.name }}
											</NuxtLink>
											<span
												v-if="task.group"
												class="inline-flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-slate-300"
											>
												<span class="size-2 rounded-full" :style="{ backgroundColor: task.group.color ?? '#64748b' }" />
												{{ task.group.name }}
											</span>
											<span v-if="task.source === 'personal'" class="text-slate-500">Persönlich</span>
										</div>
									</div>

									<UDropdownMenu :items="taskActions(task)" :ui="{ viewport: 'main-bg-color' }">
										<UButton
											icon="i-lucide-ellipsis-vertical"
											color="neutral"
											variant="ghost"
											size="xs"
											aria-label="Aktionen"
										/>
									</UDropdownMenu>
								</li>
							</ul>
						</UCard>
					</section>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Aufgabe bearbeiten' : 'Neue persönliche Aufgabe'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-list-plus'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Titel" name="title" required>
				<UInput v-model="form.title" class="w-full" autofocus placeholder="Was ist zu tun?" />
			</UFormField>
			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="form.description" :rows="3" autoresize class="w-full" />
			</UFormField>
			<div class="grid gap-4 sm:grid-cols-2">
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
