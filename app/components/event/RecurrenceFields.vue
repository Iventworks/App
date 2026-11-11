<script setup lang="ts">
/**
 * The rule of a recurring event: every n weeks on some weekdays, or every n months on a day or a
 * weekday of the month, with the usual time. Used when creating one and in its settings.
 */
import type { EventRecurrence } from "~/utils/events";

const props = defineProps<{
	/** First date of the series (`YYYY-MM-DD`): names the monthly options and the default weekday. */
	startDate: string;
	/** Last day of the series, to preview how many dates the rule gives. */
	endDate?: string;
}>();

const model = defineModel<EventRecurrence>({ required: true });

function patch(changes: Partial<EventRecurrence>) {
	model.value = { ...model.value, ...changes };
}

const FREQUENCY_OPTIONS = [
	{ label: "Wöchentlich", value: "weekly" as const },
	{ label: "Monatlich", value: "monthly" as const },
];

const monthlyModes = computed(() => [
	{ label: monthlyModeLabel("day_of_month", props.startDate), value: "day_of_month" as const },
	{
		label: monthlyModeLabel("weekday_of_month", props.startDate),
		value: "weekday_of_month" as const,
	},
]);

/** The weekdays in effect: the chosen ones, or the weekday of the first date. */
const weekdays = computed(() =>
	model.value.weekdays.length
		? model.value.weekdays
		: props.startDate
			? [isoWeekday(props.startDate)]
			: [],
);

function toggleWeekday(day: number) {
	const current = new Set(weekdays.value);
	if (current.has(day)) current.delete(day);
	else current.add(day);
	// At least one day stays.
	if (current.size === 0) return;
	patch({ weekdays: [...current].sort((a, b) => a - b) });
}

function setStartTime(value: string | null) {
	// Without a start there is no end either.
	patch(value ? { start_time: value } : { start_time: null, end_time: null });
}

const summary = computed(() =>
	props.startDate ? describeRecurrence(model.value, props.startDate) : null,
);

/** How many dates the rule gives between the first and the last day (weekly: exact, monthly: one per step). */
const dateCount = computed(() => {
	const { startDate, endDate } = props;
	if (!startDate || !endDate || endDate < startDate) return null;
	const rule = model.value;
	const start = parseDay(startDate);
	const end = parseDay(endDate);
	const interval = Math.max(1, rule.interval);

	if (rule.frequency === "weekly") {
		const days = new Set(weekdays.value);
		const firstMonday = new Date(start);
		firstMonday.setDate(start.getDate() - (isoWeekday(startDate) - 1));
		let count = 0;
		for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
			const week = Math.floor((day.getTime() - firstMonday.getTime()) / (7 * 86_400_000) + 1e-6);
			if (week % interval === 0 && days.has(day.getDay() || 7)) count++;
		}
		return count;
	}
	const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
	return Math.floor(months / interval) + 1;
});
</script>

<template>
	<div class="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
		<div class="flex flex-wrap items-end gap-3">
			<UFormField label="Wiederholung" class="w-full sm:w-44">
				<USelect
					:model-value="model.frequency"
					:items="FREQUENCY_OPTIONS"
					class="w-full"
					@update:model-value="patch({ frequency: $event })"
				/>
			</UFormField>
			<UFormField :label="model.frequency === 'weekly' ? 'Alle … Wochen' : 'Alle … Monate'" class="w-32">
				<UInputNumber
					:model-value="model.interval"
					:min="1"
					:max="12"
					class="w-full"
					@update:model-value="patch({ interval: Math.min(12, Math.max(1, Number($event) || 1)) })"
				/>
			</UFormField>
		</div>

		<UFormField v-if="model.frequency === 'weekly'" label="An diesen Wochentagen">
			<div class="flex flex-wrap gap-1.5">
				<UButton
					v-for="day in WEEKDAY_OPTIONS"
					:key="day.value"
					:label="day.short"
					:color="weekdays.includes(day.value) ? 'primary' : 'neutral'"
					:variant="weekdays.includes(day.value) ? 'solid' : 'outline'"
					size="sm"
					class="w-11 justify-center"
					:aria-label="day.label"
					:aria-pressed="weekdays.includes(day.value)"
					@click="toggleWeekday(day.value)"
				/>
			</div>
		</UFormField>

		<UFormField v-else label="An welchem Tag">
			<URadioGroup
				:model-value="model.monthly_mode"
				:items="monthlyModes"
				value-key="value"
				@update:model-value="patch({ monthly_mode: $event })"
			/>
		</UFormField>

		<div class="grid gap-3 sm:grid-cols-2">
			<UFormField label="Beginn (Uhrzeit)" hint="optional">
				<FormTimePicker :model-value="model.start_time" clearable @update:model-value="setStartTime" />
			</UFormField>
			<UFormField label="Ende (Uhrzeit)" hint="optional">
				<FormTimePicker
					:model-value="model.end_time"
					clearable
					:disabled="!model.start_time"
					@update:model-value="patch({ end_time: $event })"
				/>
			</UFormField>
		</div>

		<p v-if="summary" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-300">
			<UIcon name="i-lucide-repeat" class="size-4 shrink-0 text-primary-400" />
			<span>{{ summary }}</span>
			<span v-if="dateCount !== null" class="text-slate-500">
				· {{ dateCount }} {{ dateCount === 1 ? "Termin" : "Termine" }}
			</span>
		</p>
	</div>
</template>
