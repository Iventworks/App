<script setup lang="ts">
/** "Termine": one row per date — when, where, what it is about, who is on duty. */
import type { EventOccurrence } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const {
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
} = useEventOccurrencesView();

const { event } = await useCurrentEvent();

const nextId = computed(
	() => all.value.find((entry) => entry.date >= today && entry.status === "planned")?.id ?? null,
);

/** Responsibilities nobody covers on a planned date. */
function openDuties(occurrence: EventOccurrence) {
	if (occurrence.status === "cancelled") return 0;
	const covered = new Set(
		occurrence.duties.filter((duty) => duty.users.length).map((duty) => duty.responsibility_id),
	);
	return responsibilities.value.filter((entry) => !covered.has(entry.id)).length;
}

function relative(date: string) {
	const days = Math.round((parseDay(date).getTime() - parseDay(today).getTime()) / 86_400_000);
	if (days === 0) return "Heute";
	if (days === 1) return "Morgen";
	if (days === -1) return "Gestern";
	return days > 0 ? `in ${days} Tagen` : `vor ${-days} Tagen`;
}
</script>

<template>
	<UEmpty
		v-if="!visible.length"
		icon="i-lucide-calendar-check"
		:title="all.length ? 'Keine Termine' : 'Noch keine Termine'"
		:description="
			all.length
				? scope === 'upcoming'
					? 'Es stehen keine Termine mehr an. Verlängere die Serie in den Einstellungen oder füge einen Termin hinzu.'
					: 'Für diese Auswahl gibt es keine Termine.'
				: 'Aus der Wiederholung entstehen die Termine automatisch.'
		"
	>
		<template v-if="canManage" #actions>
			<UButton label="Termin hinzufügen" icon="i-lucide-plus" @click="openCreate" />
		</template>
	</UEmpty>

	<ul v-else class="space-y-3">
		<li
			v-for="occurrence in visible"
			:key="occurrence.id"
			:class="[
				'overflow-hidden rounded-xl border bg-slate-900/60',
				occurrence.id === nextId ? 'border-primary/50' : 'border-slate-800',
				occurrence.status === 'cancelled' || occurrence.date < today ? 'opacity-70' : '',
			]"
		>
			<div class="flex flex-wrap items-start gap-4 p-4">
				<!-- Date tile -->
				<div
					:class="[
						'flex w-16 shrink-0 flex-col items-center rounded-lg py-2',
						occurrence.id === nextId ? 'bg-primary/15 text-primary-200' : 'bg-slate-800 text-slate-200',
					]"
				>
					<span class="text-xs uppercase">{{ formatShortDay(occurrence.date).split(",")[0] }}</span>
					<span class="text-xl font-semibold leading-tight">{{ parseDay(occurrence.date).getDate() }}.</span>
					<span class="text-xs">{{ parseDay(occurrence.date).toLocaleDateString("de-DE", { month: "short" }) }}</span>
				</div>

				<div class="min-w-0 flex-1 space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<p
							:class="[
								'font-medium',
								occurrence.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-white',
							]"
						>
							{{ occurrence.title || event.name }}
						</p>
						<UBadge
							v-if="occurrence.status === 'cancelled'"
							label="Fällt aus"
							color="error"
							variant="subtle"
							size="sm"
						/>
						<UBadge
							v-else-if="occurrence.id === nextId"
							label="Nächster Termin"
							color="primary"
							variant="subtle"
							size="sm"
						/>
						<UBadge
							v-if="occurrence.origin === 'manual'"
							label="Zusätzlich"
							color="info"
							variant="outline"
							size="sm"
						/>
						<UBadge v-if="occurrence.is_mine" label="Du hast Dienst" color="success" variant="soft" size="sm" />
					</div>

					<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
						<span class="flex items-center gap-1">
							<UIcon name="i-lucide-calendar" class="size-3.5" />
							{{ formatLongDay(occurrence.date) }} · {{ relative(occurrence.date) }}
						</span>
						<span v-if="occurrence.start_time" class="flex items-center gap-1">
							<UIcon name="i-lucide-clock" class="size-3.5" />
							{{ timeRangeLabel(occurrence.start_time, occurrence.end_time) }}
							<span v-if="occurrence.custom_time" class="text-amber-400">(geändert)</span>
						</span>
						<span v-if="occurrence.location" class="flex items-center gap-1">
							<UIcon name="i-lucide-map-pin" class="size-3.5" />
							{{ occurrence.location }}
							<span v-if="occurrence.custom_location" class="text-amber-400">(geändert)</span>
						</span>
					</p>

					<p v-if="occurrence.status === 'cancelled' && occurrence.cancel_reason" class="text-sm text-red-300">
						{{ occurrence.cancel_reason }}
					</p>
					<p v-if="occurrence.notes" class="whitespace-pre-line text-sm text-slate-300">{{ occurrence.notes }}</p>
				</div>

				<div class="flex shrink-0 items-center gap-2">
					<UBadge
						v-if="canManage && openDuties(occurrence) > 0 && occurrence.date >= today"
						:label="`${openDuties(occurrence)} offen`"
						color="warning"
						variant="subtle"
						size="sm"
					/>
					<UDropdownMenu v-if="canManage" :items="entryMenu(occurrence)" :ui="{ viewport: 'main-bg-color' }">
						<UButton
							icon="i-lucide-ellipsis-vertical"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Aktionen"
						/>
					</UDropdownMenu>
				</div>
			</div>

			<!-- Duties -->
			<div
				v-if="responsibilities.length && occurrence.status !== 'cancelled'"
				class="grid gap-x-6 gap-y-2 border-t border-slate-800 bg-slate-950/30 px-4 py-3 sm:grid-cols-2 xl:grid-cols-3"
			>
				<div
					v-for="responsibility in responsibilities"
					:key="responsibility.id"
					class="flex min-w-0 items-center gap-3"
				>
					<span class="w-28 shrink-0 truncate text-xs font-medium uppercase tracking-wide text-slate-500">
						{{ responsibility.title }}
					</span>
					<div class="min-w-0 flex-1">
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
					</div>
				</div>
			</div>
		</li>
	</ul>
</template>
