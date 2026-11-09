<script setup lang="ts">
/** "Nach Bereich": one card per responsibility with the people in charge. */
definePageMeta({ layout: "dashboard" });

const { responsibilities, term, onlyMine, userId, canManage, entryMenu } =
	useEventResponsibilitiesView();

const areaCards = computed(() =>
	[...(responsibilities.value ?? [])]
		.filter((entry) => !onlyMine.value || entry.assignees.some((user) => user.id === userId.value))
		.filter(
			(entry) =>
				!term.value ||
				[
					entry.title,
					entry.location ?? "",
					entry.description,
					...entry.assignees.map((user) => user.display_name),
				]
					.join(" ")
					.toLowerCase()
					.includes(term.value),
		)
		.sort((a, b) => a.title.localeCompare(b.title, "de")),
);

const unassignedCount = computed(
	() => (responsibilities.value ?? []).filter((entry) => !entry.assignees.length).length,
);
</script>

<template>
	<div class="space-y-6">
		<UAlert
			v-if="unassignedCount && canManage"
			icon="i-lucide-triangle-alert"
			color="warning"
			variant="subtle"
			:title="`${unassignedCount} Zuständigkeit${unassignedCount === 1 ? '' : 'en'} ohne verantwortliche Person`"
		/>

		<UEmpty
			v-if="!areaCards.length"
			icon="i-lucide-badge-check"
			:title="responsibilities?.length ? 'Nichts gefunden' : 'Noch keine Zuständigkeiten'"
			:description="
				responsibilities?.length
					? 'Passe Suche oder Filter an.'
					: 'Lege fest, wer sich um Erste Hilfe, Getränke, Material, Haus 2 … kümmert.'
			"
		/>

		<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			<UCard
				v-for="entry in areaCards"
				:key="entry.id"
				class="border-slate-800 bg-slate-900/60"
				:ui="{ body: 'space-y-3 p-4 sm:p-4' }"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<p class="font-medium text-white">{{ entry.title }}</p>
						<p v-if="entry.location" class="flex items-center gap-1 text-sm text-slate-400">
							<UIcon name="i-lucide-map-pin" class="size-3.5" /> {{ entry.location }}
						</p>
					</div>
					<UDropdownMenu
						v-if="canManage"
						:items="entryMenu(entry)"
						:ui="{ viewport: 'main-bg-color' }"
					>
						<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
					</UDropdownMenu>
				</div>
				<p v-if="entry.description" class="whitespace-pre-line text-sm text-slate-300">{{ entry.description }}</p>
				<div v-if="entry.assignees.length" class="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-800 pt-3">
					<StaffUserChip
						v-for="user in entry.assignees"
						:key="user.id"
						:user="user"
						size="xs"
						:highlight="user.id === userId"
					/>
				</div>
				<UBadge v-else label="Niemand zuständig" color="warning" variant="subtle" size="sm" />
			</UCard>
		</div>
	</div>
</template>
