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

// A cleared start leaves the end alone: the send path drops an end without a start anyway
// (`normalizeRecurrence`), and clearing it here would eat the end on the transient empty
// state while someone corrects the time.
function setStartTime(value: string | null) {
	patch(value !== null ? { start_time: value } : { start_time: null });
}

const summary = computed(() =>
	props.startDate ? describeRecurrence(model.value, props.startDate) : null,
);

/** How many dates the rule gives — the same math the server applies on saving. */
const dateCount = computed(() => {
	const { startDate, endDate } = props;
	if (!startDate || !endDate || endDate < startDate) return null;
	return recurrenceDates(model.value, startDate, endDate).length;
});

const dateProblem = computed(() => {
	const count = dateCount.value;
	if (count === null) return undefined;
	if (count === 0) return "Mit dieser Regel liegt kein Termin zwischen erstem Termin und Ende.";
	if (count > 400) return `Das wären ${count} Termine — eine Serie darf höchstens 400 haben.`;
	return undefined;
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
		<p v-if="dateProblem" class="flex items-center gap-2 text-sm text-amber-400">
			<UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
			{{ dateProblem }}
		</p>
	</div>
</template>
