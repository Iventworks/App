<script setup lang="ts">
/**
 * Date + time field: the calendar date picker (`FormDatePicker`) next to Nuxt UI's `UInputTime`
 * (24 h). The model is a local `YYYY-MM-DDTHH:mm` string ("" when empty) — the same format as a
 * `datetime-local` input, so `toDateTimeInput` / `fromDateTimeInput` keep working.
 */
import { Time } from "@internationalized/date";

const props = withDefaults(
	defineProps<{
		/** Earliest selectable day, `YYYY-MM-DD`. */
		min?: string;
		max?: string;
		clearable?: boolean;
		/** Time used when a date is picked before a time, `HH:mm`. */
		defaultTime?: string;
		disabled?: boolean;
	}>(),
	{ min: undefined, max: undefined, clearable: false, defaultTime: "09:00", disabled: false },
);

const model = defineModel<string | null>({ default: "" });

const pad = (value: number) => String(value).padStart(2, "0");

const datePart = computed({
	get: () => (model.value ? model.value.slice(0, 10) : ""),
	set: (date: string | null) => {
		if (!date) {
			model.value = "";
			return;
		}
		const time = model.value ? model.value.slice(11, 16) : props.defaultTime;
		model.value = `${date}T${time || props.defaultTime}`;
	},
});

const timeValue = computed({
	get: () => {
		const time = model.value?.slice(11, 16);
		if (!time) return undefined;
		const [hour, minute] = time.split(":").map(Number);
		return new Time(hour ?? 0, minute ?? 0);
	},
	set: (time: Time | undefined | null) => {
		if (!time) return;
		const date = datePart.value || toDayString();
		model.value = `${date}T${pad(time.hour)}:${pad(time.minute)}`;
	},
});
</script>

<template>
	<div class="flex w-full gap-2">
		<FormDatePicker
			v-model="datePart"
			:min="min"
			:max="max"
			:clearable="clearable"
			:disabled="disabled"
			class="min-w-0 flex-1"
		/>
		<UInputTime
			v-model="timeValue"
			:hour-cycle="24"
			:disabled="disabled"
			icon="i-lucide-clock"
			class="w-28 shrink-0"
			aria-label="Uhrzeit"
		/>
	</div>
</template>
