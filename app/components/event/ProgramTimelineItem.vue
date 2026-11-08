<script setup lang="ts">
/** One program item ("Programmpunkt") in a compact timeline row. */
import type { GetEventsByEventIdOverviewResponses } from "~/api-client";

type ProgramSummary = GetEventsByEventIdOverviewResponses["200"]["data"]["today_program"][number];

const props = defineProps<{
	item: ProgramSummary;
	/** Show the weekday/date as well (items that are not today). */
	showDay?: boolean;
}>();

const isNow = computed(() => {
	const now = Date.now();
	return props.item.start_at <= now && now < props.item.end_at;
});

const isPast = computed(() => props.item.end_at <= Date.now());
</script>

<template>
	<div
		:class="[
			'flex gap-3 rounded-lg px-3 py-2.5',
			isNow ? 'bg-primary/10 ring-1 ring-primary/40' : '',
			isPast && !isNow ? 'opacity-60' : '',
		]"
	>
		<div class="w-20 shrink-0 text-xs text-slate-400 sm:w-24">
			<p v-if="showDay" class="font-medium text-slate-300">{{ formatShortDay(item.start_at) }}</p>
			<p>{{ formatTime(item.start_at) }} – {{ formatTime(item.end_at) }}</p>
		</div>
		<div
			class="w-1 shrink-0 rounded-full bg-slate-700"
			:style="item.color ? { backgroundColor: item.color } : undefined"
		/>
		<div class="min-w-0 flex-1 space-y-1">
			<div class="flex flex-wrap items-center gap-2">
				<p class="font-medium text-white">{{ item.title }}</p>
				<UBadge v-if="isNow" label="Jetzt" color="primary" size="sm" />
				<UBadge v-if="item.is_mine" label="Du bist zuständig" color="success" variant="subtle" size="sm" />
				<UBadge v-if="item.category" :label="item.category" color="neutral" variant="outline" size="sm" />
			</div>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
				<span v-if="item.location" class="flex items-center gap-1">
					<UIcon name="i-lucide-map-pin" class="size-3.5" /> {{ item.location }}
				</span>
				<span v-if="item.responsible.length" class="flex items-center gap-1">
					<UIcon name="i-lucide-user-check" class="size-3.5" />
					{{ item.responsible.map((person) => person.display_name).join(", ") }}
				</span>
			</div>
		</div>
	</div>
</template>
