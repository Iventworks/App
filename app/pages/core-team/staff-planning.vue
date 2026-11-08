<script setup lang="ts">
/**
 * Kernteam staff planning: a Gantt-like matrix of who works on which event in a date range,
 * with overlapping assignments highlighted, people without an assignment, and quick assignment.
 */
import type { GetOrgCoreTeamStaffPlanningResponses } from "~/api-client";
import type { EventRole } from "~/utils/roles";
import type { UserSummary } from "~/utils/types";

type Planning = GetOrgCoreTeamStaffPlanningResponses["200"]["data"];
type PlanningEvent = Planning["events"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Personalplanung | Kernteam | CMP" });

const toast = useToast();

const DAY_MS = 86_400_000;

function addDays(day: string, days: number) {
	const date = parseDay(day);
	date.setDate(date.getDate() + days);
	return toDayString(date);
}

const range = reactive({ from: toDayString(), to: addDays(toDayString(), 180) });

const {
	data: planning,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-staff-planning", async () => {
	const result = await useAPI((api) =>
		api.getOrgCoreTeamStaffPlanning({ query: { from: range.from, to: range.to } }),
	);
	if (!result.success) {
		toast.add({
			title: "Personalplanung konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data as Planning;
});

function applyRange() {
	if (range.from && range.to && range.from <= range.to) void refresh();
}

function setPreset(days: number) {
	range.from = toDayString();
	range.to = addDays(range.from, days);
	void refresh();
}

// --- timeline geometry ----------------------------------------------------------------------

const timeline = computed(() => {
	const from = planning.value?.from ?? range.from;
	const to = planning.value?.to ?? range.to;
	const start = parseDay(from).getTime();
	const days = Math.max(1, Math.round((parseDay(to).getTime() - start) / DAY_MS) + 1);
	return { from, to, start, days };
});

function dayIndex(day: string) {
	return Math.round((parseDay(day).getTime() - timeline.value.start) / DAY_MS);
}

function barStyle(event: Pick<PlanningEvent, "start_date" | "end_date" | "color">) {
	const first = Math.max(0, dayIndex(event.start_date));
	const last = Math.min(timeline.value.days - 1, dayIndex(event.end_date));
	const left = (first / timeline.value.days) * 100;
	const width = (Math.max(1, last - first + 1) / timeline.value.days) * 100;
	return {
		left: `${left}%`,
		width: `max(${width}%, 6px)`,
		"--event-color": event.color ?? "var(--ui-primary)",
	};
}

const monthMarks = computed(() => {
	const marks: { label: string; left: string }[] = [];
	const cursor = parseDay(timeline.value.from);
	cursor.setDate(1);
	const end = parseDay(timeline.value.to);
	while (cursor <= end) {
		const index = dayIndex(toDayString(cursor));
		if (index >= 0) {
			marks.push({
				label: cursor.toLocaleDateString("de-DE", { month: "short", year: "2-digit" }),
				left: `${(index / timeline.value.days) * 100}%`,
			});
		}
		cursor.setMonth(cursor.getMonth() + 1);
	}
	return marks;
});

const todayLeft = computed(() => {
	const index = dayIndex(toDayString());
	if (index < 0 || index >= timeline.value.days) return null;
	return `${((index + 0.5) / timeline.value.days) * 100}%`;
});

const eventsById = computed(
	() => new Map((planning.value?.events ?? []).map((event) => [event.id, event])),
);

const rows = computed(() =>
	(planning.value?.users ?? []).map((row) => {
		const conflicting = new Set(row.conflicts.flat());
		return {
			...row,
			conflicting,
			bars: row.assignments
				.map((assignment) => ({ ...assignment, event: eventsById.value.get(assignment.event_id) }))
				.filter((bar): bar is typeof bar & { event: PlanningEvent } => Boolean(bar.event)),
		};
	}),
);

const conflictCount = computed(() => rows.value.filter((row) => row.conflicts.length).length);

// --- quick assign ---------------------------------------------------------------------------

const assignOpen = ref(false);
const assigning = ref(false);
const assignForm = reactive({
	user_id: undefined as number | undefined,
	event_id: undefined as number | undefined,
	role: "staff" as EventRole,
	position: "",
});

const peopleOptions = computed(() => {
	const people: UserSummary[] = [
		...(planning.value?.users ?? []).map((row) => row.user),
		...(planning.value?.unassigned_users ?? []),
	];
	return people
		.sort((a, b) => a.display_name.localeCompare(b.display_name, "de"))
		.map((user) => ({ label: user.display_name, description: `@${user.username}`, value: user.id }));
});

const eventOptions = computed(() =>
	(planning.value?.events ?? []).map((event) => ({
		label: event.name,
		description: formatDayRange(event.start_date, event.end_date),
		value: event.id,
	})),
);

function openAssign(userId?: number, eventId?: number) {
	Object.assign(assignForm, { user_id: userId, event_id: eventId, role: "staff", position: "" });
	assignOpen.value = true;
}

async function submitAssign() {
	const { user_id, event_id } = assignForm;
	if (!user_id || !event_id) return;
	assigning.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdMembers({
			path: { eventId: event_id },
			body: { user_id, role: assignForm.role, position: assignForm.position.trim() || null },
		}),
	);
	assigning.value = false;

	if (!result.success) {
		toast.add({
			title: "Zuteilung fehlgeschlagen",
			description:
				(result.code as number) === 409
					? "Die Person ist bereits im Team dieses Events."
					: result.message,
			color: "error",
		});
		return;
	}

	toast.add({
		title: "Zugeteilt",
		description: "Die Person wurde benachrichtigt.",
		color: "success",
		icon: "i-lucide-check",
	});
	assignOpen.value = false;
	await refresh();
}
</script>

<template>
	<UDashboardPanel id="core-team-staff-planning">
		<template #header>
			<DashboardPageHeader title="Personalplanung" icon="i-lucide-calendar-cog" description="Wer ist wann wo im Einsatz?">
				<template #right>
					<UButton label="Person zuteilen" icon="i-lucide-user-plus" @click="openAssign()" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<div class="flex flex-wrap items-center gap-2">
					<UInput v-model="range.from" type="date" class="w-40" @change="applyRange" />
					<span class="text-slate-500">–</span>
					<UInput v-model="range.to" type="date" :min="range.from" class="w-40" @change="applyRange" />
					<UFieldGroup>
						<UButton label="3 Monate" color="neutral" variant="subtle" size="sm" @click="setPreset(90)" />
						<UButton label="6 Monate" color="neutral" variant="subtle" size="sm" @click="setPreset(180)" />
						<UButton label="1 Jahr" color="neutral" variant="subtle" size="sm" @click="setPreset(365)" />
					</UFieldGroup>
				</div>
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !planning" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else-if="planning">
					<div class="grid gap-4 sm:grid-cols-3">
						<DashboardStatCard label="Events im Zeitraum" :value="planning.events.length" icon="i-lucide-tent" />
						<DashboardStatCard
							label="Personen im Einsatz"
							:value="planning.users.length"
							:hint="`${planning.unassigned_users.length} ohne Einsatz`"
							icon="i-lucide-users"
							icon-color="emerald"
						/>
						<DashboardStatCard
							label="Überschneidungen"
							:value="conflictCount"
							:hint="conflictCount ? 'Personen in zwei Events gleichzeitig' : 'keine Konflikte'"
							:icon="conflictCount ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
							:icon-color="conflictCount ? 'error' : 'neutral'"
						/>
					</div>

					<UEmpty
						v-if="!planning.events.length"
						icon="i-lucide-calendar-x"
						title="Keine Events im Zeitraum"
						description="Wähle einen anderen Zeitraum oder lege ein Event an."
					>
						<template #actions>
							<UButton label="Event anlegen" icon="i-lucide-plus" to="/core-team/events?create=1" />
						</template>
					</UEmpty>

					<UCard v-else class="border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
						<div class="overflow-x-auto">
							<div class="min-w-[900px]">
								<!-- Month scale -->
								<div class="flex border-b border-slate-800">
									<div class="w-48 shrink-0 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
										Zeitraum
									</div>
									<div class="relative h-8 flex-1">
										<span
											v-for="mark in monthMarks"
											:key="mark.left"
											class="absolute top-0 h-full border-l border-slate-800 pl-1 pt-2 text-xs text-slate-500"
											:style="{ left: mark.left }"
										>
											{{ mark.label }}
										</span>
									</div>
								</div>

								<!-- Event lane -->
								<div class="flex border-b border-slate-800 bg-slate-950/40">
									<div class="w-48 shrink-0 px-4 py-3 text-sm font-medium text-slate-300">Events</div>
									<div class="relative flex-1 py-2" :style="{ height: `${Math.max(1, planning.events.length) * 26 + 16}px` }">
										<NuxtLink
											v-for="(event, index) in planning.events"
											:key="event.id"
											:to="`/events/${event.id}/staff`"
											class="planning-bar absolute flex h-5 items-center overflow-hidden rounded px-1.5 text-xs font-medium text-white hover:brightness-125"
											:style="{ ...barStyle(event), top: `${index * 26 + 8}px` }"
										>
											<span class="truncate">{{ event.name }}</span>
										</NuxtLink>
									</div>
								</div>

								<!-- People -->
								<div
									v-for="row in rows"
									:key="row.user.id"
									class="group flex border-b border-slate-800 last:border-b-0 hover:bg-slate-800/20"
								>
									<div class="flex w-48 shrink-0 items-center gap-2 px-4 py-2">
										<UAvatar :text="initials(row.user.display_name)" size="xs" />
										<span class="min-w-0 flex-1 truncate text-sm text-white">{{ row.user.display_name }}</span>
										<UTooltip v-if="row.conflicts.length" text="Überschneidende Einsätze">
											<UIcon name="i-lucide-triangle-alert" class="size-4 text-red-400" />
										</UTooltip>
										<UButton
											icon="i-lucide-plus"
											color="neutral"
											variant="ghost"
											size="xs"
											class="opacity-0 group-hover:opacity-100"
											aria-label="Zuteilen"
											@click="openAssign(row.user.id)"
										/>
									</div>
									<div class="relative h-11 flex-1">
										<span
											v-if="todayLeft"
											class="absolute inset-y-0 w-px bg-primary/50"
											:style="{ left: todayLeft }"
										/>
										<UTooltip
											v-for="bar in row.bars"
											:key="bar.event_id"
											:text="`${bar.event.name} · ${EVENT_ROLE_LABELS[bar.role]} · ${formatDayRange(bar.event.start_date, bar.event.end_date)}`"
										>
											<NuxtLink
												:to="`/events/${bar.event_id}/staff`"
												:class="[
													'planning-bar absolute top-2.5 flex h-6 items-center overflow-hidden rounded px-1.5 text-xs',
													bar.role === 'leader' ? 'font-semibold text-white' : 'planning-bar--staff text-slate-200',
													row.conflicting.has(bar.event_id) ? 'ring-2 ring-red-500' : '',
												]"
												:style="barStyle(bar.event)"
											>
												<UIcon v-if="bar.role === 'leader'" name="i-lucide-crown" class="mr-1 size-3 shrink-0" />
												<span class="truncate">{{ bar.event.name }}</span>
											</NuxtLink>
										</UTooltip>
									</div>
								</div>

								<p v-if="!rows.length" class="p-6 text-sm text-slate-500">
									Im Zeitraum ist noch niemand eingeteilt.
								</p>
							</div>
						</div>

						<template #footer>
							<div class="flex flex-wrap gap-4 text-xs text-slate-400">
								<span class="flex items-center gap-1.5">
									<span class="planning-bar inline-block h-3 w-6 rounded" style="--event-color: var(--ui-primary)" />
									Leitung
								</span>
								<span class="flex items-center gap-1.5">
									<span
										class="planning-bar planning-bar--staff inline-block h-3 w-6 rounded"
										style="--event-color: var(--ui-primary)"
									/>
									Team
								</span>
								<span class="flex items-center gap-1.5">
									<span class="inline-block h-3 w-6 rounded ring-2 ring-red-500" /> Überschneidung
								</span>
								<span class="flex items-center gap-1.5"><span class="inline-block h-3 w-px bg-primary" /> Heute</span>
							</div>
						</template>
					</UCard>

					<DashboardSectionCard
						title="Ohne Einsatz"
						description="Freigeschaltete Personen ohne Event im gewählten Zeitraum"
						icon="i-lucide-user-round-x"
					>
						<p v-if="!planning.unassigned_users.length" class="text-sm text-slate-500">
							Alle sind mindestens einem Event zugeteilt.
						</p>
						<div v-else class="flex flex-wrap gap-2">
							<UButton
								v-for="user in planning.unassigned_users"
								:key="user.id"
								:label="user.display_name"
								:avatar="{ text: initials(user.display_name) }"
								trailing-icon="i-lucide-plus"
								color="neutral"
								variant="subtle"
								size="sm"
								@click="openAssign(user.id)"
							/>
						</div>
					</DashboardSectionCard>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal v-model:open="assignOpen" title="Person zuteilen" icon="i-lucide-user-plus">
		<form class="space-y-4" @submit.prevent="submitAssign">
			<UFormField label="Person" required>
				<USelectMenu
					v-model="assignForm.user_id"
					:items="peopleOptions"
					value-key="value"
					placeholder="Person wählen"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Event" required>
				<USelectMenu
					v-model="assignForm.event_id"
					:items="eventOptions"
					value-key="value"
					placeholder="Event wählen"
					class="w-full"
				/>
			</UFormField>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Rolle">
					<USelect v-model="assignForm.role" :items="EVENT_ROLE_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Aufgabe im Team" hint="optional">
					<UInput v-model="assignForm.position" placeholder="z. B. Küche" class="w-full" />
				</UFormField>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="assignOpen = false" />
				<UButton
					type="submit"
					label="Zuteilen"
					icon="i-lucide-check"
					:loading="assigning"
					:disabled="!assignForm.user_id || !assignForm.event_id"
				/>
			</div>
		</form>
	</DashboardModal>
</template>

<style scoped>
.planning-bar {
	background-color: var(--event-color);
}

.planning-bar--staff {
	background-color: color-mix(in oklch, var(--event-color) 25%, transparent);
	box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--event-color) 70%, transparent);
}
</style>
