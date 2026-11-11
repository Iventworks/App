<script setup lang="ts">
/**
 * "Dienstplan": the duty roster as a table — one row per date, one column per responsibility.
 * Leaders assign people in the cells; staff take a free duty themselves. Also what gets printed.
 */
definePageMeta({ layout: "dashboard" });

const {
	visible,
	responsibilities,
	members,
	today,
	userId,
	canManage,
	canSignUp,
	openCreate,
	entryMenu,
	setDuty,
	signUp,
} = useEventOccurrencesView();

const { eventId } = await useCurrentEvent();

/** How often each person is on duty among the shown dates (for a fair distribution). */
const load = computed(() => {
	const counts = new Map<number, { name: string; count: number }>();
	for (const occurrence of visible.value) {
		if (occurrence.status === "cancelled") continue;
		for (const duty of occurrence.duties) {
			for (const user of duty.users) {
				const entry = counts.get(user.id) ?? { name: user.display_name, count: 0 };
				entry.count++;
				counts.set(user.id, entry);
			}
		}
	}
	return [...counts.values()].sort(
		(a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"),
	);
});

function print() {
	window.print();
}
</script>

<template>
	<UEmpty
		v-if="!responsibilities.length"
		icon="i-lucide-badge-check"
		title="Noch keine Zuständigkeiten"
		description="Die Spalten des Dienstplans sind die Zuständigkeiten des Events — z. B. Technik, Andacht, Snacks. Trage dort auch ein, wer sie üblicherweise übernimmt."
	>
		<template #actions>
			<UButton
				:to="`/events/${eventId}/responsibilities`"
				label="Zuständigkeiten anlegen"
				icon="i-lucide-badge-check"
				color="neutral"
				variant="subtle"
			/>
		</template>
	</UEmpty>

	<UEmpty
		v-else-if="!visible.length"
		icon="i-lucide-calendar-check"
		title="Keine Termine"
		description="Für diese Auswahl gibt es keine Termine."
	>
		<template v-if="canManage" #actions>
			<UButton label="Termin hinzufügen" icon="i-lucide-plus" @click="openCreate" />
		</template>
	</UEmpty>

	<div v-else class="space-y-4">
		<div class="roster-print overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
			<table class="w-full min-w-max border-collapse text-sm">
				<thead>
					<tr class="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
						<th class="sticky left-0 z-[1] bg-slate-900 px-4 py-3 font-medium">Termin</th>
						<th v-for="responsibility in responsibilities" :key="responsibility.id" class="px-3 py-3 font-medium">
							{{ responsibility.title }}
						</th>
						<th v-if="canManage" class="roster-no-print w-10" />
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="occurrence in visible"
						:key="occurrence.id"
						:class="[
							'border-b border-slate-800/70 last:border-0',
							occurrence.status === 'cancelled' ? 'opacity-60' : '',
							occurrence.date === today ? 'bg-primary/5' : '',
						]"
					>
						<td class="sticky left-0 z-[1] bg-slate-900 px-4 py-2 align-top">
							<p class="whitespace-nowrap font-medium text-slate-100">
								{{ formatShortDay(occurrence.date) }}
								<span v-if="occurrence.start_time" class="font-normal text-slate-400">
									· {{ occurrence.start_time }}
								</span>
							</p>
							<p v-if="occurrence.status === 'cancelled'" class="text-xs text-red-300">
								Fällt aus<template v-if="occurrence.cancel_reason">: {{ occurrence.cancel_reason }}</template>
							</p>
							<p v-else-if="occurrence.title" class="max-w-48 truncate text-xs text-slate-400">
								{{ occurrence.title }}
							</p>
						</td>
						<td v-for="responsibility in responsibilities" :key="responsibility.id" class="px-2 py-1.5 align-top">
							<EventDutyControl
								:occurrence="occurrence"
								:responsibility="responsibility"
								:members="members ?? []"
								:can-manage="canManage"
								:can-sign-up="canSignUp && occurrence.date >= today"
								:user-id="userId"
								@set="setDuty(occurrence, responsibility.id, $event)"
								@sign="signUp(occurrence, responsibility.id, $event)"
							/>
						</td>
						<td v-if="canManage" class="roster-no-print px-2 py-1.5 align-top">
							<UDropdownMenu :items="entryMenu(occurrence)" :ui="{ viewport: 'main-bg-color' }">
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									size="xs"
									aria-label="Aktionen"
								/>
							</UDropdownMenu>
						</td>
					</tr>
				</tbody>
			</table>
		</div>

		<div class="roster-no-print flex flex-wrap items-start justify-between gap-4">
			<div v-if="load.length" class="space-y-1.5">
				<p class="text-xs font-medium uppercase tracking-wide text-slate-500">Dienste pro Person</p>
				<div class="flex flex-wrap gap-1.5">
					<UBadge
						v-for="entry in load"
						:key="entry.name"
						:label="`${entry.name} · ${entry.count}`"
						color="neutral"
						variant="subtle"
						size="sm"
					/>
				</div>
			</div>
			<UButton
				label="Drucken"
				icon="i-lucide-printer"
				color="neutral"
				variant="ghost"
				class="hidden md:inline-flex"
				@click="print"
			/>
		</div>
	</div>
</template>

<style>
@media print {
	aside,
	nav,
	header,
	[data-slot="toolbar"],
	.roster-no-print {
		display: none !important;
	}

	body,
	.main-bg-color,
	.roster-print,
	.roster-print th,
	.roster-print td {
		background: white !important;
		color: black !important;
	}
}
</style>
