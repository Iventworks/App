<script setup lang="ts">
/** "Nach Person": per team member their responsibilities and the program items they lead. */
import type { GetEventsByEventIdProgramResponses } from "~/api-client";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { eventId } = await useCurrentEvent();
const { responsibilities, members, term, onlyMine, userId } = useEventResponsibilitiesView();

const { data: program } = await useAPIAsyncData(
	`event-${eventId.value}-program-by-person`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdProgram({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as ProgramItem[]);
	},
);

const people = computed(() => {
	const list = [...(members.value ?? [])]
		.sort((a, b) => {
			if (a.user_id === userId.value) return -1;
			if (b.user_id === userId.value) return 1;
			if (a.role !== b.role) return a.role === "leader" ? -1 : 1;
			return a.user.display_name.localeCompare(b.user.display_name, "de");
		})
		.map((member) => ({
			member,
			responsibilities: (responsibilities.value ?? []).filter((entry) =>
				entry.assignees.some((user) => user.id === member.user_id),
			),
			programItems: (program.value ?? [])
				.filter((item) => item.responsible.some((user) => user.id === member.user_id))
				.sort((a, b) => a.start_at - b.start_at),
		}));

	return list.filter((entry) => {
		if (onlyMine.value && entry.member.user_id !== userId.value) return false;
		if (!term.value) return true;
		return [
			entry.member.user.display_name,
			entry.member.position ?? "",
			...entry.responsibilities.map((r) => r.title),
			...entry.programItems.map((p) => p.title),
		]
			.join(" ")
			.toLowerCase()
			.includes(term.value);
	});
});

function isPast(item: ProgramItem) {
	return item.end_at < Date.now();
}
</script>

<template>
	<div class="space-y-6">
		<UEmpty
			v-if="!people.length"
			icon="i-lucide-users"
			title="Niemand gefunden"
			description="Passe Suche oder Filter an."
		/>

		<div v-else class="grid gap-4 lg:grid-cols-2">
			<DashboardSectionCard
				v-for="entry in people"
				:key="entry.member.id"
				:title="entry.member.user_id === userId ? `${entry.member.user.display_name} (du)` : entry.member.user.display_name"
				:description="entry.member.position ?? EVENT_ROLE_LABELS[entry.member.role]"
				:icon="entry.member.role === 'leader' ? 'i-lucide-crown' : 'i-lucide-user'"
			>
				<div class="space-y-4">
					<div>
						<p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Zuständigkeiten</p>
						<ul v-if="entry.responsibilities.length" class="space-y-1 text-sm">
							<li v-for="responsibility in entry.responsibilities" :key="responsibility.id" class="flex items-center gap-2">
								<UIcon name="i-lucide-badge-check" class="size-4 shrink-0 text-primary-400" />
								<span class="text-slate-200">{{ responsibility.title }}</span>
								<span v-if="responsibility.location" class="truncate text-slate-500">· {{ responsibility.location }}</span>
							</li>
						</ul>
						<p v-else class="text-sm text-slate-500">Keine festen Zuständigkeiten.</p>
					</div>

					<div>
						<p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Programmpunkte</p>
						<ul v-if="entry.programItems.length" class="space-y-1.5 text-sm">
							<li
								v-for="item in entry.programItems"
								:key="item.id"
								:class="['flex items-start gap-2', isPast(item) ? 'opacity-50' : '']"
							>
								<span class="mt-1.5 size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.color ?? '#64748b' }" />
								<span class="min-w-0">
									<NuxtLink :to="`/events/${eventId}/program`" class="text-slate-200 hover:text-primary-300">
										{{ item.title }}
									</NuxtLink>
									<span class="block text-xs text-slate-500">
										{{ formatShortDay(item.start_at) }}, {{ formatTimeRange(item.start_at, item.end_at) }}
										<template v-if="item.location"> · {{ item.location }}</template>
									</span>
								</span>
							</li>
						</ul>
						<p v-else class="text-sm text-slate-500">Für keinen Programmpunkt eingeteilt.</p>
					</div>
				</div>
			</DashboardSectionCard>
		</div>
	</div>
</template>
