<script setup lang="ts">
/**
 * The event's schedule. Layout for the two views — "Wochenplan" (`/program`) and "Liste"
 * (`/program/list`) — as toolbar sub-navigation (style guide 07: useSubrouterPathDynamics). It
 * loads the items, owns the filters (`DashboardFilterBar`) and the item modal, and shares them with
 * the views via `provideEventProgramView`. Leaders drag & drop, resize and create items directly in
 * the grid (changes are applied optimistically and rolled back if the API refuses); staff get a
 * read-only view with a "Nur meine" filter. Phones get the agenda per day in both views.
 */
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
import type { GetEventsByEventIdProgramResponses } from "~/api-client";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import type { EventMember } from "~/utils/types";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const route = useRoute();
const router = useRouter();

const editable = computed(() => can("program:manage"));
const programPath = computed(() => `/events/${eventId.value}/program`);

// --- sub-navigation -----------------------------------------------------------------------

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	[programPath.value]: {
		isNavLink: true,
		label: "Wochenplan",
		icon: "i-lucide-calendar-range",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { description: `Wochenplan von ${event.value.name}` },
			breadcrumbItems: [],
		}),
	},
	[`${programPath.value}/list`]: {
		isNavLink: true,
		label: "Liste",
		icon: "i-lucide-list",
		getDynamicValues: () => ({
			seoSettings: { title: "Liste", description: `Programm von ${event.value.name} als Liste` },
			breadcrumbItems: [],
		}),
	},
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: `Programm | ${event.value.name} | CMP`,
	routes,
});

await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});

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

// --- filters ------------------------------------------------------------------------------

const breakpoints = useBreakpoints(breakpointsTailwind);
const isNarrow = breakpoints.smaller("md");

const onlyMine = ref(false);
const listDay = ref<string>(days.value.includes(toDayString()) ? toDayString() : "all");

const visibleItems = computed(() =>
	(items.value ?? []).filter((item) => !onlyMine.value || item.is_mine),
);

// The day buttons only exist on phones; elsewhere the agenda always shows every day.
const listDays = computed(() =>
	isNarrow.value && listDay.value !== "all"
		? days.value.filter((day) => day === listDay.value)
		: days.value,
);

const showEmpty = computed(
	() => !visibleItems.value.length && (!isNarrow.value || listDay.value === "all"),
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

provideEventProgramView({
	days,
	listDays,
	visibleItems,
	showEmpty,
	onlyMine,
	isNarrow,
	editable,
	openItem,
	openCreate,
	onMove,
});

// Printing uses the agenda, so switch to the list view first.
async function print() {
	await router.push(`${programPath.value}/list`);
	await nextTick();
	requestAnimationFrame(() => window.print());
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
				</template>
			</DashboardPageHeader>

			<!-- Phones get the agenda in both views, so the switch only exists from `md` up. -->
			<UDashboardToolbar v-if="!isNarrow">
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar class="program-no-print">
					<template #left>
						<div v-if="isNarrow" class="flex gap-1 overflow-x-auto pb-1">
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
						<USwitch v-model="onlyMine" label="Nur meine" />
					</template>
					<template v-if="editable" #right>
						<UButton label="Programmpunkt" icon="i-lucide-plus" @click="openCreate()" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !items" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else>
					<UAlert
						v-if="outsideCount"
						icon="i-lucide-calendar-x"
						color="warning"
						variant="subtle"
						class="program-no-print"
						:title="`${outsideCount} Programmpunkt(e) liegen außerhalb des Event-Zeitraums`"
						description="Passe die Daten des Events oder der Programmpunkte an, damit sie im Plan erscheinen."
					/>

					<NuxtPage />
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
