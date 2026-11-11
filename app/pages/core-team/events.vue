<script setup lang="ts">
/** Kernteam: every camp, event and recurring event; creating new ones and copying existing ones. */
import type { TableColumn } from "@nuxt/ui";
import * as z from "zod";
import { zPostEventsBody } from "~/api-client/zod.gen";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import type { EventWithAccess, UserSummary } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Freizeiten & Events | Kernteam" });

const toast = useToast();
const route = useRoute();
const router = useRouter();

const {
	data: events,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-events", async () => {
	const result = await useAPI((api) =>
		api.getEvents({
			// Archived events come along; the status filter hides them until "Archiviert" is picked.
			query: { scope: "all", include_archived: "true" },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Events konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as EventWithAccess[];
	}
	return result.data;
});

// Archived events stay hidden until "Archiviert" is picked in the status filter.
const table = useDataTableInitialFilters({
	status: EVENT_STATUS_OPTIONS.filter((option) => option.value !== "archived").map(
		(option) => option.value,
	),
});

const { data: users } = await useAPIAsyncData("core-team-users-directory", async () => {
	const result = await useAPI((api) => api.getUsers({}));
	return result.success ? result.data : ([] as UserSummary[]);
});

const today = toDayString();

type EventRow = EventWithAccess & { phase: "running" | "upcoming" | "past" };

const rows = computed<EventRow[]>(() =>
	// A recurring event runs on the days of its dates and is upcoming until its last one.
	(events.value ?? []).map((event) => ({ ...event, phase: eventPhase(event, today) })),
);

const PHASE_LABELS: Record<EventRow["phase"], string> = {
	running: "Läuft",
	upcoming: "Bevorstehend",
	past: "Vergangen",
};

const columns: TableColumn<EventRow>[] = [
	{ accessorKey: "name", header: "Event" },
	{ accessorKey: "start_date", header: "Zeitraum" },
	{ accessorKey: "status", header: "Status" },
	{ id: "leaders", header: "Leitung" },
	{ accessorKey: "participant_count", header: "Teilnehmende" },
	{ accessorKey: "staff_count", header: "Team" },
	{ accessorKey: "phase", header: "Phase" },
	{ id: "actions", header: "" },
];

const filters = [
	{
		column: "name" as const,
		type: "text" as const,
		placeholder: "Event suchen …",
		class: "w-full sm:w-52",
	},
	{
		column: "status" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		options: EVENT_STATUS_OPTIONS,
		class: "w-full sm:w-64",
	},
	{
		column: "phase" as const,
		type: "multi-select" as const,
		placeholder: "Alle Phasen",
		class: "w-full sm:w-44",
		options: (Object.keys(PHASE_LABELS) as EventRow["phase"][]).map((value) => ({
			label: PHASE_LABELS[value],
			value,
		})),
	},
];

// --- create -------------------------------------------------------------------------------

const createSchema = zPostEventsBody
	.omit({ participant_fee_cents: true, budget_cents: true, max_participants: true })
	.extend({
		fee: z.string().refine((v) => v === "" || inputToCents(v) !== null, "Ungültiger Betrag"),
		budget: z.string().refine((v) => v === "" || inputToCents(v) !== null, "Ungültiger Betrag"),
		max_participants: z.number().int().min(0).nullable(),
	})
	.refine((data) => !data.start_date || !data.end_date || data.start_date <= data.end_date, {
		message: "Das Ende darf nicht vor dem Beginn liegen",
		path: ["end_date"],
	})
	.refine(
		(data) =>
			data.type !== "recurring" ||
			!data.start_date ||
			!data.end_date ||
			parseDay(data.end_date).getTime() - parseDay(data.start_date).getTime() <= 3 * 366 * 86_400_000,
		{ message: "Eine Serie kann höchstens drei Jahre laufen", path: ["end_date"] },
	);

const createOpen = ref(false);
const creating = ref(false);
const createForm = reactive({
	name: "",
	type: "camp" as EventWithAccess["type"],
	status: "planning" as EventWithAccess["status"],
	start_date: "",
	end_date: "",
	location: "",
	description: "",
	color: COLOR_PRESETS[0] as string,
	max_participants: null as number | null,
	fee: "",
	budget: "",
	leader_ids: [] as number[],
	// Only sent for recurring events.
	recurrence: defaultRecurrence(),
});

function openCreate() {
	Object.assign(createForm, {
		name: "",
		type: "camp",
		status: "planning",
		start_date: "",
		end_date: "",
		location: "",
		description: "",
		color: COLOR_PRESETS[0],
		max_participants: null,
		fee: "",
		budget: "",
		leader_ids: [],
		recurrence: defaultRecurrence(),
	});
	createOpen.value = true;
}

// Open the dialog from links like `/core-team/events?create=1` (event switcher, overview).
watch(
	() => route.query.create,
	(value) => {
		if (value === "1") {
			openCreate();
			const { create: _create, ...query } = route.query;
			void router.replace({ query });
		}
	},
	{ immediate: true },
);

const leaderOptions = computed(() =>
	(users.value ?? []).map((user) => ({
		label: user.display_name,
		description: `@${user.username}`,
		value: user.id,
	})),
);

async function submitCreate() {
	creating.value = true;
	const result = await useAPI((api) =>
		api.postEvents({
			body: {
				name: createForm.name,
				type: createForm.type,
				status: createForm.status,
				start_date: createForm.start_date,
				end_date: createForm.end_date,
				location: createForm.location.trim() || null,
				description: createForm.description,
				color: createForm.color || null,
				max_participants: createForm.max_participants,
				participant_fee_cents: inputToCents(createForm.fee),
				budget_cents: inputToCents(createForm.budget) ?? 0,
				leader_ids: createForm.leader_ids,
				recurrence:
					createForm.type === "recurring"
						? normalizeRecurrence(createForm.recurrence, createForm.start_date)
						: null,
			},
		}),
	);
	creating.value = false;

	if (!result.success) {
		toast.add({
			title: "Event konnte nicht angelegt werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	toast.add({
		title: `${EVENT_TYPE_LABELS[result.data.type]} „${result.data.name}“ angelegt`,
		description: createForm.leader_ids.length ? "Die Leitung wurde benachrichtigt." : undefined,
		color: "success",
		icon: "i-lucide-check",
	});
	createOpen.value = false;
	await useMyEventsStore().refresh();
	await navigateTo(
		result.data.type === "recurring"
			? `/events/${result.data.id}/occurrences`
			: `/events/${result.data.id}`,
	);
}

// --- copy ---------------------------------------------------------------------------------

const copyOpen = ref(false);
const copySource = ref<EventWithAccess | null>(null);

function openCopy(event: EventWithAccess) {
	copySource.value = event;
	copyOpen.value = true;
}

async function onCopied(event: EventWithAccess) {
	await navigateTo(`/events/${event.id}`);
}

function rowActions(event: EventRow) {
	return [
		[
			{ label: "Öffnen", icon: "i-lucide-arrow-right", to: `/events/${event.id}` },
			...(event.type === "recurring"
				? [
						{
							label: "Termine",
							icon: "i-lucide-calendar-check",
							to: `/events/${event.id}/occurrences`,
						},
					]
				: []),
			{ label: "Team", icon: "i-lucide-contact", to: `/events/${event.id}/staff` },
			{ label: "Finanzen", icon: "i-lucide-receipt-euro", to: `/events/${event.id}/finances` },
		],
		[
			{ label: "Kopieren …", icon: "i-lucide-copy", onSelect: () => openCopy(event) },
			{ label: "Einstellungen", icon: "i-lucide-settings-2", to: `/events/${event.id}/settings` },
		],
	];
}
</script>

<template>
	<UDashboardPanel id="core-team-events">
		<template #header>
			<DashboardPageHeader title="Freizeiten & Events" icon="i-lucide-tent" description="Alle Events der Organisation" />
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					ref="table"
					:data="rows"
					:columns="columns"
					:loading="loading"
					:filters="filters"
					empty-title="Noch keine Events"
					empty-description="Lege die erste Freizeit oder das erste Event an."
					empty-icon="i-lucide-tent"
					@refresh="refresh"
				>
					<template #header-right>
						<UButton label="Event anlegen" icon="i-lucide-plus" @click="openCreate" />
					</template>

					<template #name-cell="{ row }">
						<NuxtLink :to="`/events/${row.original.id}`" class="flex min-w-48 items-center gap-2.5 hover:text-primary-400">
							<span
								class="size-2.5 shrink-0 rounded-full"
								:style="{ backgroundColor: row.original.color ?? 'var(--ui-primary)' }"
							/>
							<UIcon :name="EVENT_TYPE_ICONS[row.original.type]" class="size-4 shrink-0 text-slate-400" />
							<span class="min-w-0">
								<span class="block truncate font-medium text-white">{{ row.original.name }}</span>
								<span v-if="row.original.location" class="block truncate text-xs text-slate-500">
									{{ row.original.location }}
								</span>
							</span>
						</NuxtLink>
					</template>
					<template #start_date-cell="{ row }">
						<span class="whitespace-nowrap text-slate-300">
							{{ formatDayRange(row.original.start_date, row.original.end_date) }}
						</span>
						<span
							v-if="row.original.type === 'recurring' && row.original.recurrence"
							class="block whitespace-nowrap text-xs text-slate-500"
						>
							{{ describeRecurrence(row.original.recurrence, row.original.start_date) }}
						</span>
					</template>
					<template #status-cell="{ row }">
						<UBadge
							:label="EVENT_STATUS_LABELS[row.original.status]"
							:color="EVENT_STATUS_COLORS[row.original.status]"
							variant="subtle"
							size="sm"
						/>
					</template>
					<template #leaders-cell="{ row }">
						<span v-if="!row.original.leaders.length" class="flex items-center gap-1 text-xs text-red-400">
							<UIcon name="i-lucide-user-x" class="size-3.5" /> keine
						</span>
						<span v-else class="text-sm text-slate-300">
							{{ row.original.leaders.map((leader) => leader.display_name).join(", ") }}
						</span>
					</template>
					<template #participant_count-cell="{ row }">
						<span class="tabular-nums text-slate-300">
							{{ row.original.participant_count }}<template v-if="row.original.max_participants"> / {{ row.original.max_participants }}</template>
						</span>
					</template>
					<template #phase-cell="{ row }">
						<span
							:class="[
								'text-xs',
								row.original.phase === 'running'
									? 'text-emerald-400'
									: row.original.phase === 'upcoming'
										? 'text-primary-400'
										: 'text-slate-500',
							]"
						>
							{{ PHASE_LABELS[row.original.phase] }}
						</span>
					</template>
					<template #actions-cell="{ row }">
						<div class="flex justify-end">
							<UDropdownMenu :items="rowActions(row.original)" :ui="{ viewport: 'main-bg-color' }">
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									size="xs"
									aria-label="Aktionen"
								/>
							</UDropdownMenu>
						</div>
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="createOpen"
		title="Event anlegen"
		icon="i-lucide-tent"
		width="sm:max-w-2xl"
	>
		<UForm :schema="createSchema" :state="createForm" class="space-y-4" @submit="submitCreate">
			<UFormField label="Name" name="name" required>
				<UInput v-model="createForm.name" placeholder="z. B. Sommerfreizeit 2027" class="w-full" autofocus />
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Art" name="type" :help="EVENT_TYPE_HINTS[createForm.type]">
					<USelect v-model="createForm.type" :items="EVENT_TYPE_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Status" name="status">
					<USelect v-model="createForm.status" :items="EVENT_STATUS_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField
					:label="createForm.type === 'recurring' ? 'Erster Termin' : 'Beginn'"
					name="start_date"
					required
				>
					<FormDatePicker v-model="createForm.start_date" />
				</UFormField>
				<UFormField
					:label="createForm.type === 'recurring' ? 'Serie endet am' : 'Ende'"
					name="end_date"
					required
				>
					<FormDatePicker v-model="createForm.end_date" :min="createForm.start_date || undefined" />
				</UFormField>
			</div>

			<EventRecurrenceFields
				v-if="createForm.type === 'recurring'"
				v-model="createForm.recurrence"
				:start-date="createForm.start_date"
				:end-date="createForm.end_date"
			/>

			<UFormField label="Ort" name="location">
				<UInput v-model="createForm.location" placeholder="z. B. Freizeitheim Waldblick" class="w-full" />
			</UFormField>

			<UFormField label="Leitung" name="leader_ids" description="Die Leitung wird benachrichtigt und kann das Event selbst verwalten.">
				<USelectMenu
					v-model="createForm.leader_ids"
					:items="leaderOptions"
					value-key="value"
					multiple
					placeholder="Personen auswählen"
					class="w-full"
				/>
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-3">
				<UFormField label="Max. Teilnehmende" name="max_participants">
					<UInputNumber v-model="createForm.max_participants" :min="0" placeholder="unbegrenzt" class="w-full" />
				</UFormField>
				<UFormField label="Teilnahmebeitrag" name="fee">
					<UInput v-model="createForm.fee" inputmode="decimal" placeholder="0,00" class="w-full">
						<template #trailing><span class="text-sm text-slate-400">€</span></template>
					</UInput>
				</UFormField>
				<UFormField label="Budget" name="budget">
					<UInput v-model="createForm.budget" inputmode="decimal" placeholder="0,00" class="w-full">
						<template #trailing><span class="text-sm text-slate-400">€</span></template>
					</UInput>
				</UFormField>
			</div>

			<UFormField label="Farbe" name="color" description="Für Kalender und Übersichten.">
				<div class="flex flex-wrap gap-2">
					<button
						v-for="color in COLOR_PRESETS"
						:key="color"
						type="button"
						:aria-label="`Farbe ${color}`"
						:class="[
							'size-7 rounded-full ring-offset-2 ring-offset-slate-900 transition',
							createForm.color === color ? 'ring-2 ring-white' : 'hover:scale-110',
						]"
						:style="{ backgroundColor: color }"
						@click="createForm.color = color"
					/>
				</div>
			</UFormField>

			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="createForm.description" :rows="3" autoresize class="w-full" />
			</UFormField>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="createOpen = false" />
				<UButton type="submit" label="Anlegen" icon="i-lucide-check" :loading="creating" />
			</div>
		</UForm>
	</DashboardModal>

	<EventCopyModal v-if="copySource" v-model:open="copyOpen" :event="copySource" @copied="onCopied" />
</template>
