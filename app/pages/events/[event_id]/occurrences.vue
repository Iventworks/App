<script setup lang="ts">
/**
 * The dates of a recurring event ("Regeltermin"). Layout for the two views — "Termine"
 * (`/occurrences`, what each date is about) and "Dienstplan" (`/occurrences/roster`, who is on duty
 * when) — as toolbar sub-navigation. It loads the dates, the responsibilities and the team, owns
 * the filters, the modals and every change, and shares them with the views via
 * `provideEventOccurrencesView`.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import type { EventMember, EventOccurrence, OccurrenceResponsibility } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const route = useRoute();
const user = await useUserInfoStore().use();

const canManage = computed(() => can("occurrences:manage"));
const canSignUp = computed(() => can("occurrences:signup") && event.value.is_member);
const userId = computed(() => user.value?.id);
const basePath = computed(() => `/events/${eventId.value}/occurrences`);
const today = toDayString();

// --- sub-navigation -----------------------------------------------------------------------

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	[basePath.value]: {
		isNavLink: true,
		label: "Termine",
		icon: "i-lucide-calendar-check",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { description: `Termine von ${event.value.name}` },
			breadcrumbItems: [],
		}),
	},
	[`${basePath.value}/roster`]: {
		isNavLink: true,
		label: "Dienstplan",
		icon: "i-lucide-table-properties",
		getDynamicValues: () => ({
			seoSettings: { title: "Dienstplan", description: `Dienstplan von ${event.value.name}` },
			breadcrumbItems: [],
		}),
	},
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: `Termine | ${event.value.name}`,
	routes,
});

await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});

// --- data ---------------------------------------------------------------------------------

const isRecurring = computed(() => event.value.type === "recurring");

const { data, loading, refresh } = await useAPIAsyncData(
	`event-${eventId.value}-occurrences`,
	async () => {
		const empty = {
			occurrences: [] as EventOccurrence[],
			responsibilities: [] as OccurrenceResponsibility[],
		};
		if (!isRecurring.value) return empty;
		const result = await useAPI((api) =>
			api.getEventsByEventIdOccurrences({ path: { eventId: eventId.value } }),
		);
		if (!result.success) {
			toast.add({
				title: "Termine konnten nicht geladen werden",
				description: result.message,
				color: "error",
			});
			return empty;
		}
		return result.data;
	},
);

const { data: members } = await useAPIAsyncData(`event-${eventId.value}-members`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : ([] as EventMember[]);
});

const all = computed(() => data.value?.occurrences ?? []);
const responsibilities = computed(() => data.value?.responsibilities ?? []);

/** Put a changed date back into the list (re-sorted: it may have moved). */
function replace(occurrence: EventOccurrence) {
	if (!data.value) return;
	const others = data.value.occurrences.filter((entry) => entry.id !== occurrence.id);
	data.value = {
		...data.value,
		occurrences: [...others, occurrence].sort(
			(a, b) =>
				a.date.localeCompare(b.date) ||
				(a.start_time ?? "").localeCompare(b.start_time ?? "") ||
				a.id - b.id,
		),
	};
}

// --- filters ------------------------------------------------------------------------------

const upcomingCount = computed(() => all.value.filter((entry) => entry.date >= today).length);
const pastCount = computed(() => all.value.length - upcomingCount.value);

const { value: scope, items: scopeItems } = useQueryFilter("scope", () => [
	{
		value: "upcoming" as const,
		label: "Kommende",
		icon: "i-lucide-calendar-clock",
		count: upcomingCount.value,
	},
	{ value: "past" as const, label: "Vergangene", icon: "i-lucide-history", count: pastCount.value },
	{ value: "all" as const, label: "Alle", icon: "i-lucide-calendar", count: all.value.length },
]);

const onlyMine = ref(false);

const visible = computed(() => {
	const list = all.value.filter((entry) => {
		if (onlyMine.value && !entry.is_mine) return false;
		if (scope.value === "upcoming") return entry.date >= today;
		if (scope.value === "past") return entry.date < today;
		return true;
	});
	// The past reads backwards: the latest date first.
	return scope.value === "past" ? [...list].reverse() : list;
});

// --- modals -------------------------------------------------------------------------------

const modalOpen = ref(false);
const selected = ref<EventOccurrence | null>(null);
const presetCancelled = ref(false);
const planOpen = ref(false);
const deleteOpen = ref(false);
const deleteTarget = ref<EventOccurrence | null>(null);

function openCreate() {
	selected.value = null;
	presetCancelled.value = false;
	modalOpen.value = true;
}

function openEdit(occurrence: EventOccurrence, cancel = false) {
	selected.value = occurrence;
	presetCancelled.value = cancel;
	modalOpen.value = true;
}

async function restore(occurrence: EventOccurrence) {
	const result = await useAPI((api) =>
		api.putEventsByEventIdOccurrencesByOccurrenceId({
			path: { eventId: eventId.value, occurrenceId: occurrence.id },
			body: { status: "planned" },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Ändern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	replace(result.data);
	toast.add({
		title: `Termin am ${formatDay(occurrence.date)} findet wieder statt`,
		color: "success",
		icon: "i-lucide-check",
	});
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdOccurrencesByOccurrenceId({
			path: { eventId: eventId.value, occurrenceId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	await refresh();
}

function entryMenu(occurrence: EventOccurrence): DropdownMenuItem[][] {
	const groups: DropdownMenuItem[][] = [
		[
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(occurrence) },
			occurrence.status === "cancelled"
				? {
						label: "Findet doch statt",
						icon: "i-lucide-calendar-check",
						onSelect: () => void restore(occurrence),
					}
				: {
						label: "Absagen …",
						icon: "i-lucide-calendar-x",
						onSelect: () => openEdit(occurrence, true),
					},
		],
	];
	// Dates of the series come back from the rule: they are cancelled, not deleted.
	if (occurrence.origin === "manual") {
		groups.push([
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => {
					deleteTarget.value = occurrence;
					deleteOpen.value = true;
				},
			},
		]);
	}
	return groups;
}

// --- duties -------------------------------------------------------------------------------

async function setDuty(occurrence: EventOccurrence, responsibilityId: number, userIds: number[]) {
	const result = await useAPI((api) =>
		api.putEventsByEventIdOccurrencesByOccurrenceIdDutiesByResponsibilityId({
			path: { eventId: eventId.value, occurrenceId: occurrence.id, responsibilityId },
			body: { user_ids: userIds },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Einteilen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	replace(result.data);
}

async function signUp(occurrence: EventOccurrence, responsibilityId: number, assigned: boolean) {
	const result = await useAPI((api) =>
		api.putEventsByEventIdOccurrencesByOccurrenceIdDutiesByResponsibilityIdMe({
			path: { eventId: eventId.value, occurrenceId: occurrence.id, responsibilityId },
			body: { assigned },
		}),
	);
	if (!result.success) {
		toast.add({
			title: assigned ? "Übernehmen fehlgeschlagen" : "Abgeben fehlgeschlagen",
			description: result.message,
			color: "error",
		});
		return;
	}
	replace(result.data);
	const title = responsibilities.value.find((entry) => entry.id === responsibilityId)?.title;
	toast.add({
		title: assigned
			? `Du übernimmst „${title}“ am ${formatDay(occurrence.date)}`
			: `Du hast „${title}“ am ${formatDay(occurrence.date)} abgegeben`,
		color: "success",
		icon: assigned ? "i-lucide-hand" : "i-lucide-user-minus",
	});
}

provideEventOccurrencesView({
	visible,
	all,
	responsibilities,
	members,
	scope,
	today,
	userId,
	canManage,
	canSignUp,
	openCreate,
	entryMenu,
	setDuty,
	signUp,
});
</script>

<template>
	<UDashboardPanel id="event-occurrences">
		<template #header>
			<DashboardPageHeader title="Termine" icon="i-lucide-calendar-check" :description="event.name">
				<template #right>
					<UButton
						v-if="can('event:edit')"
						:to="`/events/${eventId}/settings`"
						icon="i-lucide-repeat"
						label="Wiederholung"
						color="neutral"
						variant="ghost"
						class="hidden sm:inline-flex"
					/>
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar v-if="isRecurring">
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<UEmpty
					v-if="!isRecurring"
					icon="i-lucide-repeat"
					title="Kein Regeltermin"
					description="Einzelne Termine gibt es nur bei Events, die regelmäßig stattfinden. Die Art eines Events lässt sich in den Einstellungen ändern."
				>
					<template #actions>
						<UButton :to="`/events/${eventId}`" label="Zur Übersicht" color="neutral" variant="subtle" />
					</template>
				</UEmpty>

				<template v-else>
					<DashboardFilterBar>
						<template #left>
							<USelect v-model="scope" :items="scopeItems" class="w-full sm:w-52" />
							<USwitch v-model="onlyMine" label="Nur meine Dienste" />
							<span v-if="event.recurrence" class="flex items-center gap-1.5 text-sm text-slate-400">
								<UIcon name="i-lucide-repeat" class="size-4 shrink-0" />
								{{ describeRecurrence(event.recurrence, event.start_date) }}
							</span>
						</template>
						<template v-if="canManage" #right>
							<UButton
								label="Dienstplan füllen"
								icon="i-lucide-wand-sparkles"
								color="neutral"
								variant="subtle"
								@click="planOpen = true"
							/>
							<UButton label="Termin hinzufügen" icon="i-lucide-plus" @click="openCreate" />
						</template>
					</DashboardFilterBar>

					<div v-if="loading && !data" class="flex justify-center py-12">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
					</div>

					<NuxtPage v-else />
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<EventOccurrenceModal
		v-model:open="modalOpen"
		:event="event"
		:occurrence="selected"
		:preset-cancelled="presetCancelled"
		@saved="replace"
	/>

	<EventRosterPlanModal
		v-model:open="planOpen"
		:event-id="eventId"
		:responsibilities="responsibilities"
		@planned="refresh"
	/>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Termin löschen"
		:warning-text="`Der Termin am ${formatDay(deleteTarget?.date)} wird mit seiner Einteilung gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
