<script setup lang="ts">
/**
 * Horizontal CSS bar list for small distributions (categories, age buckets, per-event counts).
 * No chart library: each row is a label, a value and a proportional bar.
 */
interface BarItem {
	label: string;
	value: number;
	hint?: string;
	/** Bar tone; defaults to `primary`. */
	tone?: "primary" | "emerald" | "amber" | "error" | "neutral" | "info";
	to?: string;
}

const props = withDefaults(
	defineProps<{
		items: BarItem[];
		format?: (value: number) => string;
		/** Scale maximum; defaults to the largest value. */
		max?: number;
		emptyText?: string;
	}>(),
	{
		format: (value: number) => value.toLocaleString("de-DE"),
		max: undefined,
		emptyText: "Keine Daten vorhanden.",
	},
);

const toneClasses: Record<NonNullable<BarItem["tone"]>, string> = {
	primary: "bg-primary-500",
	emerald: "bg-emerald-500",
	amber: "bg-amber-500",
	error: "bg-red-500",
	neutral: "bg-slate-500",
	info: "bg-blue-500",
};

const scaleMax = computed(() => props.max ?? Math.max(0, ...props.items.map((item) => item.value)));

function width(value: number) {
	if (scaleMax.value <= 0 || value <= 0) return "0%";
	return `${Math.max(2, Math.min(100, (value / scaleMax.value) * 100))}%`;
}
</script>

<template>
	<p v-if="!items.length" class="text-sm text-slate-500">{{ emptyText }}</p>
	<ul v-else class="space-y-3">
		<li v-for="item in items" :key="item.label" class="space-y-1">
			<div class="flex items-baseline justify-between gap-3 text-sm">
				<component
					:is="item.to ? 'NuxtLink' : 'span'"
					:to="item.to"
					:class="['min-w-0 truncate text-slate-300', item.to ? 'hover:text-primary-400' : '']"
				>
					{{ item.label }}
				</component>
				<span class="shrink-0 font-medium text-white tabular-nums">
					{{ format(item.value) }}
					<span v-if="item.hint" class="ml-1 text-xs font-normal text-slate-500">{{ item.hint }}</span>
				</span>
			</div>
			<div class="h-2 overflow-hidden rounded-full bg-slate-800">
				<div
					:class="['h-full rounded-full transition-all', toneClasses[item.tone ?? 'primary']]"
					:style="{ width: width(item.value) }"
				/>
			</div>
		</li>
	</ul>
</template>
