<script setup lang="ts">
/**
 * Planned vs. actual amounts per category: a slate bar for the plan, a coloured bar for the
 * actual spending (red when it exceeds the plan). Amounts in cents.
 */
interface Row {
	label: string;
	planned: number;
	actual: number;
}

const props = withDefaults(
	defineProps<{
		rows: Row[];
		emptyText?: string;
	}>(),
	{
		emptyText: "Noch keine Planung oder Ausgaben.",
	},
);

const scaleMax = computed(() =>
	Math.max(0, ...props.rows.flatMap((row) => [row.planned, row.actual])),
);

function width(value: number) {
	if (scaleMax.value <= 0 || value <= 0) return "0%";
	return `${Math.max(2, Math.min(100, (value / scaleMax.value) * 100))}%`;
}
</script>

<template>
	<p v-if="!rows.length" class="text-sm text-slate-500">{{ emptyText }}</p>
	<div v-else class="space-y-4">
		<div class="flex gap-4 text-xs text-slate-400">
			<span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-slate-500" /> Geplant</span>
			<span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-primary-500" /> Ausgegeben</span>
			<span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm bg-red-500" /> Über Plan</span>
		</div>
		<ul class="space-y-4">
			<li v-for="row in rows" :key="row.label" class="space-y-1.5">
				<div class="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
					<span class="text-slate-300">{{ row.label }}</span>
					<span class="tabular-nums text-slate-400">
						<span :class="row.planned > 0 && row.actual > row.planned ? 'text-red-400' : 'text-white'">
							{{ formatCents(row.actual) }}
						</span>
						/ {{ formatCents(row.planned) }}
					</span>
				</div>
				<div class="h-1.5 overflow-hidden rounded-full bg-slate-800">
					<div class="h-full rounded-full bg-slate-500" :style="{ width: width(row.planned) }" />
				</div>
				<div class="h-1.5 overflow-hidden rounded-full bg-slate-800">
					<div
						:class="[
							'h-full rounded-full',
							row.planned > 0 && row.actual > row.planned ? 'bg-red-500' : 'bg-primary-500',
						]"
						:style="{ width: width(row.actual) }"
					/>
				</div>
			</li>
		</ul>
	</div>
</template>
