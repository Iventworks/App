<script setup lang="ts">
/** All camps/events of the caller (core team: optionally every event), grouped by timing. */
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { EventWithAccess } from "~/utils/types";

definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Freizeiten & Events | CMP" });

const toast = useToast();
const user = await useUserInfoStore().use();
const isCoreTeam = computed(() => hasOrgRole(user.value?.role, "core_team"));

const { value: scope, items: scopeItems } = useQueryFilter("scope", [
	{ value: "mine", label: "Meine Events", icon: "i-lucide-user-check" },
	{ value: "all", label: "Alle Events", icon: "i-lucide-tent" },
]);
const showArchived = ref(false);

const {
	data: events,
	loading,
	refresh,
} = await useAPIAsyncData("events-list", async () => {
	const result = await useAPI((api) =>
		api.getEvents({
			query: {
				scope: isCoreTeam.value ? scope.value : "mine",
				include_archived: showArchived.value ? "true" : "false",
			},
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

watch([scope, showArchived], () => void refresh());

const today = toDayString();

const sections = computed(() => {
	const list = events.value ?? [];
	return [
		{
			key: "running",
			label: "Läuft gerade",
			icon: "i-lucide-radio",
			items: list.filter((event) => event.start_date <= today && today <= event.end_date),
		},
		{
			key: "upcoming",
			label: "Bevorstehend",
			icon: "i-lucide-calendar-clock",
			items: list
				.filter((event) => event.start_date > today)
				.sort((a, b) => a.start_date.localeCompare(b.start_date)),
		},
		{
			key: "past",
			label: "Vergangen",
			icon: "i-lucide-history",
			items: list
				.filter((event) => event.end_date < today)
				.sort((a, b) => b.end_date.localeCompare(a.end_date)),
		},
	].filter((section) => section.items.length > 0);
});
</script>

<template>
	<UDashboardPanel id="events">
		<template #header>
			<DashboardPageHeader
				title="Freizeiten & Events"
				icon="i-lucide-tent"
				:description="isCoreTeam ? undefined : 'Events, in denen du mitarbeitest'"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<USelect
							v-if="isCoreTeam"
							v-model="scope"
							:items="scopeItems"
							:icon="scopeItems.find((item) => item.value === scope)?.icon"
							class="w-full sm:w-44"
							aria-label="Events filtern"
						/>
						<USwitch v-model="showArchived" label="Archivierte anzeigen" />
					</template>
					<template v-if="isCoreTeam" #right>
						<UButton to="/core-team/events?create=1" label="Freizeit / Event anlegen" icon="i-lucide-plus" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !events" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!sections.length"
					icon="i-lucide-tent"
					title="Keine Events"
					:description="
						scope === 'all'
							? 'Es wurden noch keine Freizeiten oder Events angelegt.'
							: 'Du bist noch keiner Freizeit und keinem Event zugeteilt. Sobald dich eine Leitung einträgt, erscheint es hier.'
					"
				/>

				<template v-else>
					<section v-for="section in sections" :key="section.key" class="space-y-3">
						<h2 class="flex items-center gap-2 text-sm font-semibold text-slate-300">
							<UIcon :name="section.icon" class="size-4 text-primary-400" />
							{{ section.label }}
							<UBadge :label="String(section.items.length)" color="neutral" variant="subtle" size="sm" />
						</h2>
						<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							<EventCard v-for="event in section.items" :key="event.id" :event="event" />
						</div>
					</section>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
