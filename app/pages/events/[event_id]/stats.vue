<script setup lang="ts">
/** Event statistics for leaders: participants, care info, staff, rooms, tasks, finances. */
import type { GetEventsByEventIdStatsResponses } from "~/api-client";

type Stats = GetEventsByEventIdStatsResponses["200"]["data"];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Statistiken | ${event.value.name} | CMP` });

if (!can("stats:view")) {
	throw createError({
		statusCode: 403,
		statusMessage: "Statistiken sind nur für die Leitung sichtbar.",
		fatal: true,
	});
}

const {
	data: stats,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-stats`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdStats({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Statistiken konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data as Stats;
});

const GENDER_DISPLAY: Record<string, string> = {
	female: "weiblich",
	male: "männlich",
	diverse: "divers",
	unknown: "keine Angabe",
};

const participantStatusItems = computed(() =>
	stats.value
		? (["registered", "confirmed", "waitlist", "cancelled"] as const).map((status) => ({
				label: PARTICIPANT_STATUS_LABELS[status],
				value: stats.value!.participants.by_status[status],
				tone:
					status === "confirmed"
						? ("emerald" as const)
						: status === "waitlist"
							? ("amber" as const)
							: status === "cancelled"
								? ("neutral" as const)
								: ("primary" as const),
			}))
		: [],
);

const genderItems = computed(() =>
	Object.entries(stats.value?.participants.by_gender ?? {})
		.filter(([, count]) => count > 0)
		.map(([key, count]) => ({ label: GENDER_DISPLAY[key] ?? key, value: count })),
);

const occupancy = computed(() => {
	const rooms = stats.value?.rooms;
	if (!rooms || rooms.capacity === 0) return null;
	return Math.round((rooms.assigned_participants / rooms.capacity) * 100);
});

const actualCents = computed(() => {
	const byStatus = stats.value?.finances.expenses_by_status;
	return byStatus ? byStatus.approved + byStatus.reimbursed : 0;
});
</script>

<template>
	<UDashboardPanel id="event-stats">
		<template #header>
			<DashboardPageHeader title="Statistiken" icon="i-lucide-chart-column" :description="event.name">
				<template #right>
					<UButton
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="ghost"
						aria-label="Aktualisieren"
						:loading="loading"
						@click="refresh()"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="!stats" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else>
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<DashboardStatCard
							label="Teilnehmende"
							:value="stats.participants.total"
							:hint="
								event.max_participants
									? `von ${event.max_participants} Plätzen · ${stats.participants.by_status.waitlist} auf Warteliste`
									: `${stats.participants.by_status.waitlist} auf Warteliste`
							"
							icon="i-lucide-users"
							:to="`/events/${eventId}/participants`"
						/>
						<DashboardStatCard
							label="Team"
							:value="stats.staff.total"
							:hint="`davon ${stats.staff.leaders} in der Leitung`"
							icon="i-lucide-contact"
							icon-color="emerald"
							:to="`/events/${eventId}/staff`"
						/>
						<DashboardStatCard
							label="Offene Aufgaben"
							:value="stats.tasks.open + stats.tasks.in_progress"
							:hint="stats.tasks.overdue ? `${stats.tasks.overdue} überfällig` : 'nichts überfällig'"
							:icon="stats.tasks.overdue ? 'i-lucide-alarm-clock' : 'i-lucide-list-todo'"
							:icon-color="stats.tasks.overdue ? 'error' : 'amber'"
							:to="`/events/${eventId}/tasks`"
						/>
						<DashboardStatCard
							label="Programm"
							:value="`${stats.program.hours_scheduled.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`"
							:hint="`${stats.program.items} Programmpunkte`"
							icon="i-lucide-calendar-range"
							icon-color="neutral"
							:to="`/events/${eventId}/program`"
						/>
					</div>

					<div class="grid gap-6 lg:grid-cols-3">
						<DashboardSectionCard title="Anmeldestatus" icon="i-lucide-clipboard-check">
							<FinanceBarList :items="participantStatusItems" />
						</DashboardSectionCard>

						<DashboardSectionCard title="Altersgruppen" description="Alter zu Beginn des Events" icon="i-lucide-cake">
							<FinanceBarList :items="stats.participants.age_buckets.map((b) => ({ label: b.label, value: b.count }))" />
						</DashboardSectionCard>

						<DashboardSectionCard title="Geschlecht" icon="i-lucide-users-round">
							<FinanceBarList :items="genderItems" empty-text="Keine Teilnehmenden." />
						</DashboardSectionCard>
					</div>

					<div class="grid gap-6 lg:grid-cols-3">
						<DashboardSectionCard title="Betreuung & Einverständnis" icon="i-lucide-heart-pulse">
							<ul class="space-y-3 text-sm">
								<li class="flex items-center justify-between">
									<span class="flex items-center gap-2 text-slate-300">
										<UIcon name="i-lucide-wheat-off" class="size-4 text-amber-400" /> Mit Allergien
									</span>
									<span class="font-medium tabular-nums text-white">{{ stats.participants.with_allergies }}</span>
								</li>
								<li class="flex items-center justify-between">
									<span class="flex items-center gap-2 text-slate-300">
										<UIcon name="i-lucide-pill" class="size-4 text-red-400" /> Mit Medikamenten
									</span>
									<span class="font-medium tabular-nums text-white">{{ stats.participants.with_medications }}</span>
								</li>
								<li class="flex items-center justify-between">
									<span class="flex items-center gap-2 text-slate-300">
										<UIcon name="i-lucide-camera" class="size-4 text-primary-400" /> Fotoerlaubnis
									</span>
									<span class="font-medium tabular-nums text-white">
										{{ stats.participants.photo_consent }} / {{ stats.participants.total }}
									</span>
								</li>
								<li class="flex items-center justify-between">
									<span class="flex items-center gap-2 text-slate-300">
										<UIcon name="i-lucide-badge-euro" class="size-4 text-emerald-400" /> Beitrag bezahlt
									</span>
									<span class="font-medium tabular-nums text-white">
										{{ stats.participants.fee_paid }}
										<span v-if="stats.participants.fee_open" class="text-amber-400">
											({{ stats.participants.fee_open }} offen)
										</span>
									</span>
								</li>
							</ul>
						</DashboardSectionCard>

						<DashboardSectionCard title="Zimmer" icon="i-lucide-bed-double">
							<ul class="space-y-3 text-sm">
								<li class="flex justify-between">
									<span class="text-slate-300">Zimmer</span>
									<span class="font-medium text-white">{{ stats.rooms.total }}</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Betten</span>
									<span class="font-medium text-white">{{ stats.rooms.capacity }}</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Zugeteilt</span>
									<span class="font-medium text-white">{{ stats.rooms.assigned_participants }}</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Noch ohne Zimmer</span>
									<span
										:class="[
											'font-medium',
											stats.rooms.unassigned_participants ? 'text-amber-400' : 'text-white',
										]"
									>
										{{ stats.rooms.unassigned_participants }}
									</span>
								</li>
							</ul>
							<UProgress
								v-if="occupancy !== null"
								:model-value="Math.min(occupancy, 100)"
								:color="occupancy > 100 ? 'error' : 'primary'"
								class="mt-4"
							/>
							<p v-if="occupancy !== null" class="mt-1 text-xs text-slate-500">{{ occupancy }} % belegt</p>
						</DashboardSectionCard>

						<DashboardSectionCard title="Team nach Gruppen" icon="i-lucide-users-round">
							<FinanceBarList
								:items="stats.staff.by_group.map((g) => ({ label: g.name, value: g.count }))"
								empty-text="Noch keine Gruppen angelegt."
							/>
						</DashboardSectionCard>
					</div>

					<DashboardSectionCard
						v-if="can('budget:view')"
						title="Finanzen"
						description="Genehmigte und erstattete Ausgaben im Vergleich zum Budget"
						icon="i-lucide-wallet"
					>
						<template #actions>
							<UButton
								label="Zu den Finanzen"
								:to="`/events/${eventId}/finances?tab=budget`"
								color="neutral"
								variant="subtle"
								size="sm"
								trailing-icon="i-lucide-arrow-right"
							/>
						</template>

						<div class="grid gap-6 lg:grid-cols-2">
							<ul class="space-y-3 text-sm">
								<li class="flex justify-between">
									<span class="text-slate-300">Budget</span>
									<span class="font-medium tabular-nums text-white">
										{{ formatCents(stats.finances.budget_cents) }}
									</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Geplante Ausgaben</span>
									<span class="tabular-nums text-white">
										{{ formatCents(stats.finances.planned_expenses_cents) }}
									</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Geplante Einnahmen</span>
									<span class="tabular-nums text-emerald-400">
										{{ formatCents(stats.finances.planned_income_cents) }}
									</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Erwartete Teilnahmebeiträge</span>
									<span class="tabular-nums text-emerald-400">
										{{ formatCents(stats.finances.expected_fees_cents) }}
									</span>
								</li>
								<li class="flex justify-between border-t border-slate-800 pt-3">
									<span class="text-slate-300">Ausgegeben</span>
									<span
										:class="[
											'font-semibold tabular-nums',
											stats.finances.budget_cents && actualCents > stats.finances.budget_cents
												? 'text-red-400'
												: 'text-white',
										]"
									>
										{{ formatCents(actualCents) }}
									</span>
								</li>
								<li class="flex justify-between">
									<span class="text-slate-300">Eingereicht, ungeprüft</span>
									<span class="tabular-nums text-amber-400">
										{{ formatCents(stats.finances.expenses_by_status.submitted) }}
									</span>
								</li>
							</ul>

							<FinanceBarList
								:items="
									stats.finances.expenses_by_category.map((c) => ({ label: c.category, value: c.amount_cents }))
								"
								:format="formatCents"
								empty-text="Noch keine genehmigten Ausgaben."
							/>
						</div>
					</DashboardSectionCard>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
