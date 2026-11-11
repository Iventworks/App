<script setup lang="ts">
/** Kernteam overview: KPIs across all events, running and upcoming events, open finances. */
import type { GetOrgCoreTeamOverviewResponses } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Overview = GetOrgCoreTeamOverviewResponses["200"]["data"];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Kernteam" });

const toast = useToast();
const user = await useUserInfoStore().use();
const isAdmin = computed(() => hasOrgRole(user.value?.role, "admin"));

const {
	data: overview,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-overview", async () => {
	const result = await useAPI((api) => api.getOrgCoreTeamOverview({}));
	if (!result.success) {
		toast.add({
			title: "Übersicht konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data as Overview;
});

const today = toDayString();

function daysUntil(date: string) {
	return Math.round((parseDay(date).getTime() - parseDay(today).getTime()) / 86_400_000);
}

const statusItems = computed(() =>
	overview.value
		? (["planning", "confirmed", "cancelled", "archived"] as const).map((status) => ({
				label: EVENT_STATUS_LABELS[status],
				value: overview.value!.events_by_status[status],
				tone:
					status === "confirmed"
						? ("emerald" as const)
						: status === "planning"
							? ("amber" as const)
							: status === "cancelled"
								? ("error" as const)
								: ("neutral" as const),
			}))
		: [],
);

const unstaffedCount = computed(
	() => overview.value?.upcoming_events.filter((event) => event.unstaffed).length ?? 0,
);
</script>

<template>
	<UDashboardPanel id="core-team-overview">
		<template #header>
			<DashboardPageHeader title="Kernteam" icon="i-lucide-building-2" description="Überblick über alle Freizeiten & Events">
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
				<div v-if="!overview" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else>
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<DashboardStatCard
							label="Events gesamt"
							:value="overview.totals.events"
							:hint="`${overview.running_events.length} laufen gerade`"
							icon="i-lucide-tent"
							to="/core-team/events"
						/>
						<DashboardStatCard
							label="Teilnehmende"
							:value="overview.totals.participants"
							hint="über alle Events (ohne Abmeldungen)"
							icon="i-lucide-users"
							icon-color="emerald"
							to="/core-team/stats"
						/>
						<DashboardStatCard
							label="Mitarbeitende"
							:value="overview.totals.volunteers"
							hint="freigeschaltete Konten"
							icon="i-lucide-contact"
							icon-color="neutral"
							to="/core-team/staff-planning"
						/>
						<DashboardStatCard
							label="Offene Belege"
							:value="formatCents(overview.pending_expenses.amount_cents)"
							:hint="`${overview.pending_expenses.count} Ausgaben warten auf Prüfung`"
							icon="i-lucide-receipt"
							:icon-color="overview.pending_expenses.count ? 'amber' : 'neutral'"
							to="/core-team/finances"
						/>
					</div>

					<UAlert
						v-if="unstaffedCount"
						icon="i-lucide-user-x"
						color="warning"
						variant="subtle"
						:title="`${unstaffedCount} bevorstehende${unstaffedCount === 1 ? 's Event hat' : ' Events haben'} noch keine Leitung`"
						description="Lege in der Personalplanung oder in den Event-Einstellungen eine Leitung fest."
						:actions="[{ label: 'Zur Personalplanung', to: '/core-team/staff-planning', color: 'warning', variant: 'outline' }]"
					/>

					<UAlert
						v-if="overview.unverified_users"
						icon="i-lucide-user-round-search"
						color="neutral"
						variant="subtle"
						:title="`${overview.unverified_users} Konto${overview.unverified_users === 1 ? '' : 'en'} noch nicht freigeschaltet`"
						:description="isAdmin ? 'Vergib eine Rolle in der Benutzerverwaltung.' : 'Das Admin-Team schaltet neue Konten frei.'"
						:actions="isAdmin ? [{ label: 'Benutzer verwalten', to: '/admin/users', color: 'neutral', variant: 'outline' }] : []"
					/>

					<div class="grid gap-6 lg:grid-cols-3">
						<DashboardSectionCard
							title="Läuft gerade"
							icon="i-lucide-radio"
							class="lg:col-span-2"
							flush
						>
							<p v-if="!overview.running_events.length" class="p-6 text-sm text-slate-500">
								Gerade läuft kein Event.
							</p>
							<ul v-else class="divide-y divide-slate-800">
								<li v-for="event in overview.running_events" :key="event.id">
									<NuxtLink
										:to="`/events/${event.id}`"
										class="flex items-center gap-3 px-6 py-3 transition hover:bg-slate-800/40"
									>
										<span
											class="size-2.5 shrink-0 rounded-full"
											:style="{ backgroundColor: event.color ?? 'var(--ui-primary)' }"
										/>
										<UIcon :name="EVENT_TYPE_ICONS[event.type]" class="size-4 shrink-0 text-slate-400" />
										<div class="min-w-0 flex-1">
											<p class="truncate font-medium text-white">{{ event.name }}</p>
											<p class="text-xs text-slate-400">
												{{ event.type === "recurring" ? "Heute ist Termin" : formatDayRange(event.start_date, event.end_date) }}
											</p>
										</div>
										<div class="hidden gap-4 text-xs text-slate-400 sm:flex">
											<span class="flex items-center gap-1">
												<UIcon name="i-lucide-users" class="size-3.5" /> {{ event.participant_count }}
											</span>
											<span class="flex items-center gap-1">
												<UIcon name="i-lucide-contact" class="size-3.5" /> {{ event.staff_count }}
											</span>
										</div>
										<UIcon name="i-lucide-chevron-right" class="size-4 text-slate-600" />
									</NuxtLink>
								</li>
							</ul>
						</DashboardSectionCard>

						<DashboardSectionCard title="Events nach Status" icon="i-lucide-chart-pie">
							<FinanceBarList :items="statusItems" />
						</DashboardSectionCard>
					</div>

					<DashboardSectionCard title="Als Nächstes" description="Die nächsten Events" icon="i-lucide-calendar-clock" flush>
						<template #actions>
							<UButton label="Event anlegen" icon="i-lucide-plus" size="sm" to="/core-team/events?create=1" />
							<UButton
								label="Alle Events"
								to="/core-team/events"
								color="neutral"
								variant="subtle"
								size="sm"
								trailing-icon="i-lucide-arrow-right"
							/>
						</template>

						<p v-if="!overview.upcoming_events.length" class="p-6 text-sm text-slate-500">
							Keine bevorstehenden Events geplant.
						</p>
						<ul v-else class="divide-y divide-slate-800">
							<li
								v-for="event in overview.upcoming_events"
								:key="event.id"
								class="flex flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:gap-4"
							>
								<div class="flex min-w-0 flex-1 items-center gap-3">
									<span
										class="size-2.5 shrink-0 rounded-full"
										:style="{ backgroundColor: event.color ?? 'var(--ui-primary)' }"
									/>
									<div class="min-w-0">
										<NuxtLink :to="`/events/${event.id}`" class="truncate font-medium text-white hover:text-primary-400">
											{{ event.name }}
										</NuxtLink>
										<p class="text-xs text-slate-400">
											<template v-if="event.type === 'recurring'">
												Regeltermin · nächster Termin {{ formatShortDay(event.next_date ?? event.start_date) }}
											</template>
											<template v-else>{{ formatDayRange(event.start_date, event.end_date) }}</template>
											· in {{ daysUntil(event.next_date ?? event.start_date) }}
											Tag{{ daysUntil(event.next_date ?? event.start_date) === 1 ? "" : "en" }}
										</p>
									</div>
								</div>

								<div class="flex flex-wrap items-center gap-2">
									<UBadge
										:label="EVENT_STATUS_LABELS[event.status]"
										:color="EVENT_STATUS_COLORS[event.status]"
										variant="subtle"
										size="sm"
									/>
									<UBadge
										v-if="event.unstaffed"
										label="Keine Leitung"
										icon="i-lucide-user-x"
										color="error"
										variant="subtle"
										size="sm"
									/>
									<UAvatarGroup v-else size="xs" :max="3">
										<UTooltip v-for="leader in event.leaders" :key="leader.id" :text="leader.display_name">
											<UAvatar :text="initials(leader.display_name)" :alt="leader.display_name" />
										</UTooltip>
									</UAvatarGroup>
									<span class="flex items-center gap-1 text-xs text-slate-400">
										<UIcon name="i-lucide-users" class="size-3.5" /> {{ event.participant_count }}
									</span>
									<span class="flex items-center gap-1 text-xs text-slate-400">
										<UIcon name="i-lucide-contact" class="size-3.5" /> {{ event.staff_count }}
									</span>
								</div>
							</li>
						</ul>
					</DashboardSectionCard>

					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<UButton
							v-for="link in [
								{ label: 'Personalplanung', icon: 'i-lucide-calendar-cog', to: '/core-team/staff-planning' },
								{ label: 'Finanzen', icon: 'i-lucide-wallet', to: '/core-team/finances' },
								{ label: 'Material & Ressourcen', icon: 'i-lucide-package', to: '/core-team/resources' },
								{ label: 'Kernteam-Chat', icon: 'i-lucide-messages-square', to: '/messages?channel=core_team' },
							]"
							:key="link.to"
							:label="link.label"
							:icon="link.icon"
							:to="link.to"
							color="neutral"
							variant="subtle"
							size="lg"
							block
							class="justify-start"
						/>
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
