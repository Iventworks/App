<script setup lang="ts">
/** Kernteam statistics across all events: participants, ages, gender, staff engagement. */
import type { GetOrgCoreTeamStatsResponses } from "~/api-client";

type Stats = GetOrgCoreTeamStatsResponses["200"]["data"];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Statistiken | Kernteam" });

const toast = useToast();
const year = ref<number | null>(new Date().getFullYear());

const { data: stats, refresh } = await useAPIAsyncData("core-team-stats", async () => {
	const result = await useAPI((api) =>
		api.getOrgCoreTeamStats({ query: year.value ? { year: year.value } : {} }),
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

watch(year, () => refresh());

const GENDER_DISPLAY = {
	female: "weiblich",
	male: "männlich",
	diverse: "divers",
	unknown: "keine Angabe",
} as const;

const genderItems = computed(() =>
	stats.value
		? (Object.keys(GENDER_DISPLAY) as (keyof typeof GENDER_DISPLAY)[])
				.map((key) => ({ label: GENDER_DISPLAY[key], value: stats.value!.gender[key] }))
				.filter((item) => item.value > 0)
		: [],
);

const averagePerEvent = computed(() => {
	if (!stats.value?.events_count) return 0;
	return Math.round(stats.value.participants_total / stats.value.events_count);
});
</script>

<template>
	<UDashboardPanel id="core-team-stats">
		<template #header>
			<DashboardPageHeader title="Statistiken" icon="i-lucide-chart-pie" description="Über alle Events" />
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<FinanceYearSelect v-model="year" />
					</template>
				</DashboardFilterBar>

				<div v-if="!stats" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else>
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<DashboardStatCard label="Events" :value="stats.events_count" icon="i-lucide-tent" />
						<DashboardStatCard
							label="Teilnehmende"
							:value="stats.participants_total"
							:hint="`Ø ${averagePerEvent} pro Event`"
							icon="i-lucide-users"
							icon-color="emerald"
						/>
						<DashboardStatCard
							label="Wiederkehrende"
							:value="stats.returning_participants"
							hint="bei mehr als einem Event dabei"
							icon="i-lucide-repeat"
							icon-color="amber"
						/>
						<DashboardStatCard
							label="Aktive Mitarbeitende"
							:value="stats.staff_engagement.length"
							hint="mit mindestens einem Einsatz (Top 20)"
							icon="i-lucide-contact"
							icon-color="neutral"
						/>
					</div>

					<DashboardSectionCard title="Teilnehmende je Event" icon="i-lucide-chart-bar">
						<FinanceBarList
							:items="
								stats.participants_by_event.map((entry) => ({
									label: entry.name,
									value: entry.count,
									hint: formatDay(entry.start_date),
									to: `/events/${entry.event_id}/participants`,
								}))
							"
							empty-text="Keine Events im gewählten Zeitraum."
						/>
					</DashboardSectionCard>

					<div class="grid gap-6 lg:grid-cols-2">
						<DashboardSectionCard title="Altersgruppen" description="Alter zum Beginn des jeweiligen Events" icon="i-lucide-cake">
							<FinanceBarList :items="stats.age_buckets.map((b) => ({ label: b.label, value: b.count }))" />
						</DashboardSectionCard>

						<DashboardSectionCard title="Geschlecht" icon="i-lucide-users-round">
							<FinanceBarList :items="genderItems" empty-text="Keine Teilnehmenden." />
						</DashboardSectionCard>
					</div>

					<DashboardSectionCard
						title="Engagement im Team"
						description="Wer war bei den meisten Events dabei?"
						icon="i-lucide-heart-handshake"
						flush
					>
						<p v-if="!stats.staff_engagement.length" class="p-6 text-sm text-slate-500">
							Noch keine Einsätze.
						</p>
						<ol v-else class="divide-y divide-slate-800">
							<li
								v-for="(entry, index) in stats.staff_engagement"
								:key="entry.user.id"
								class="flex items-center gap-3 px-6 py-3"
							>
								<span class="w-6 text-right text-sm tabular-nums text-slate-500">{{ index + 1 }}.</span>
								<UAvatar :text="initials(entry.user.display_name)" size="sm" />
								<span class="min-w-0 flex-1 truncate text-sm text-white">{{ entry.user.display_name }}</span>
								<UBadge
									v-if="entry.leader_count"
									:label="`${entry.leader_count}× Leitung`"
									icon="i-lucide-crown"
									color="primary"
									variant="subtle"
									size="sm"
								/>
								<span class="w-20 text-right text-sm font-medium tabular-nums text-white">
									{{ entry.events_count }} Event{{ entry.events_count === 1 ? "" : "s" }}
								</span>
							</li>
						</ol>
					</DashboardSectionCard>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
