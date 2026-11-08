<script setup lang="ts">
/**
 * The event's schedule ("Wochenplan"). Leaders drag & drop, resize and create items directly in
 * the grid (changes are applied optimistically and rolled back if the API refuses); staff get a
 * read-only view with a "Nur meine" filter. Phones and the "Liste" view show an agenda per day.
 */
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
import type { GetEventsByEventIdProgramResponses } from "~/api-client";
import type { EventMember } from "~/utils/types";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Programm | ${event.value.name} | CMP` });

const editable = computed(() => can("program:manage"));

// --- data ---------------------------------------------------------------------------------

const {
	data: items,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-program`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdProgram({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Programm konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as ProgramItem[];
	}
	return result.data;
});

const { data: members } = await useAPIAsyncData(`event-${eventId.value}-members`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : ([] as EventMember[]);
});

const days = computed(() => {
	const result: string[] = [];
	const cursor = parseDay(event.value.start_date);
	const end = parseDay(event.value.end_date);
	while (cursor <= end && result.length < 62) {
		result.push(toDayString(cursor));
		cursor.setDate(cursor.getDate() + 1);
	}
	return result;
});

// --- view ---------------------------------------------------------------------------------

const breakpoints = useBreakpoints(breakpointsTailwind);
const isNarrow = breakpoints.smaller("md");

const view = ref<"grid" | "list">("grid");
const onlyMine = ref(false);
const listDay = ref<string>(days.value.includes(toDayString()) ? toDayString() : "all");

const effectiveView = computed(() => (isNarrow.value ? "list" : view.value));

const visibleItems = computed(() =>
	(items.value ?? []).filter((item) => !onlyMine.value || item.is_mine),
);

const listDays = computed(() =>
	effectiveView.value === "list" && isNarrow.value && listDay.value !== "all"
		? days.value.filter((day) => day === listDay.value)
		: days.value,
);

const outsideCount = computed(() => {
	if (!days.value.length) return 0;
	const first = parseDay(days.value[0] as string).getTime();
	const last = parseDay(days.value[days.value.length - 1] as string);
	last.setDate(last.getDate() + 1);
	return (items.value ?? []).filter(
		(item) => item.end_at <= first || item.start_at >= last.getTime(),
	).length;
});

const dayTabs = computed(() => [
	{ label: "Alle", value: "all" },
	...days.value.map((day) => ({ label: formatShortDay(day), value: day })),
]);

// --- modal --------------------------------------------------------------------------------

const modalOpen = ref(false);
const selectedItem = ref<ProgramItem | null>(null);
const draft = ref<{ start_at: number; end_at: number } | null>(null);

function openItem(item: ProgramItem) {
	selectedItem.value = item;
	draft.value = null;
	modalOpen.value = true;
}

function openCreate(range?: { start_at: number; end_at: number }) {
	if (!editable.value) return;
	selectedItem.value = null;
	if (range) {
		draft.value = range;
	} else {
		// Default: the next full hour today (or 10:00 on the first day of the event).
		const today = toDayString();
		const base = parseDay(days.value.includes(today) ? today : (days.value[0] ?? today));
		const start = days.value.includes(today) ? new Date() : base;
		if (days.value.includes(today)) start.setHours(start.getHours() + 1, 0, 0, 0);
		else start.setHours(10, 0, 0, 0);
		draft.value = { start_at: start.getTime(), end_at: start.getTime() + 60 * 60_000 };
	}
	modalOpen.value = true;
}

// --- drag & drop moves --------------------------------------------------------------------

async function onMove(item: ProgramItem, range: { start_at: number; end_at: number }) {
	const list = items.value;
	if (!list) return;
	const previous = { start_at: item.start_at, end_at: item.end_at };

	// Optimistic update.
	items.value = list.map((entry) => (entry.id === item.id ? { ...entry, ...range } : entry));

	const result = await useAPI((api) =>
		api.putEventsByEventIdProgramByProgramItemId({
			path: { eventId: eventId.value, programItemId: item.id },
			body: range,
		}),
	);

	if (!result.success) {
		items.value = (items.value ?? []).map((entry) =>
			entry.id === item.id ? { ...entry, ...previous } : entry,
		);
		toast.add({
			title: "Verschieben fehlgeschlagen",
			description: result.message,
			color: "error",
		});
		return;
	}

	items.value = (items.value ?? []).map((entry) => (entry.id === item.id ? result.data : entry));
	toast.add({
		title: `„${item.title}“ verschoben`,
		description: `${formatShortDay(range.start_at)}, ${formatTimeRange(range.start_at, range.end_at)}`,
		color: "success",
		icon: "i-lucide-move",
	});
}

function print() {
	view.value = "list";
	nextTick(() => window.print());
}
</script>

<template>
	<UDashboardPanel id="event-program">
		<template #header>
			<DashboardPageHeader title="Programm" icon="i-lucide-calendar-range" :description="event.name">
				<template #right>
					<UButton
						icon="i-lucide-printer"
						color="neutral"
						variant="ghost"
						aria-label="Drucken"
						class="hidden md:inline-flex"
						@click="print"
					/>
					<UButton v-if="editable" label="Programmpunkt" icon="i-lucide-plus" @click="openCreate()" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<template #left>
					<UTabs
						v-if="!isNarrow"
						v-model="view"
						:items="[
							{ label: 'Wochenplan', value: 'grid', icon: 'i-lucide-calendar-range' },
							{ label: 'Liste', value: 'list', icon: 'i-lucide-list' },
						]"
						:content="false"
						size="sm"
						variant="link"
					/>
					<div v-else class="-mx-1 flex gap-1 overflow-x-auto pb-1">
						<UButton
							v-for="tab in dayTabs"
							:key="tab.value"
							:label="tab.label"
							size="xs"
							:color="listDay === tab.value ? 'primary' : 'neutral'"
							:variant="listDay === tab.value ? 'soft' : 'ghost'"
							class="shrink-0"
							@click="listDay = tab.value"
						/>
					</div>
				</template>
				<template #right>
					<USwitch v-model="onlyMine" label="Nur meine" size="sm" />
				</template>
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !items" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else>
					<UAlert
						v-if="outsideCount"
						icon="i-lucide-calendar-x"
						color="warning"
						variant="subtle"
						:title="`${outsideCount} Programmpunkt(e) liegen außerhalb des Event-Zeitraums`"
						description="Passe die Daten des Events oder der Programmpunkte an, damit sie im Plan erscheinen."
					/>

					<p v-if="editable && effectiveView === 'grid'" class="program-no-print text-sm text-slate-400">
						Ziehe Programmpunkte, um sie zu verschieben, am unteren Rand, um die Dauer zu ändern, oder
						in einen freien Bereich, um einen neuen anzulegen.
					</p>

					<ProgramWeekGrid
						v-if="effectiveView === 'grid'"
						:days="days"
						:items="visibleItems"
						:editable="editable"
						@open="openItem"
						@create="openCreate"
						@move="onMove"
					/>

					<template v-else>
						<UEmpty
							v-if="!visibleItems.length && listDay === 'all'"
							icon="i-lucide-calendar-range"
							:title="onlyMine ? 'Dir ist kein Programmpunkt zugeteilt' : 'Noch kein Programm'"
							:description="editable ? 'Lege den ersten Programmpunkt an.' : 'Die Leitung plant das Programm hier.'"
						>
							<template v-if="editable" #actions>
								<UButton label="Programmpunkt anlegen" icon="i-lucide-plus" @click="openCreate()" />
							</template>
						</UEmpty>
						<ProgramAgendaList v-else :days="listDays" :items="visibleItems" @open="openItem" />
					</template>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<ProgramItemModal
		v-model:open="modalOpen"
		:event-id="eventId"
		:item="selectedItem"
		:draft="draft"
		:editable="editable"
		:members="members ?? []"
		@saved="refresh"
		@deleted="refresh"
	/>
</template>

<style>
@media print {
	/* Print only the agenda: hide the dashboard chrome around it. */
	aside,
	nav,
	header,
	[data-slot="toolbar"],
	.program-no-print {
		display: none !important;
	}

	body,
	.main-bg-color {
		background: white !important;
		color: black !important;
	}

	.program-print-day {
		break-inside: avoid;
	}
}
</style>
