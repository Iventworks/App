<script setup lang="ts">
/**
 * Date field with Nuxt UI's calendar: type the date (segmented `UInputDate`) or pick it from a
 * `UCalendar` popover. The model is the app's date format, `YYYY-MM-DD` ("" when empty), so forms
 * and API payloads don't change.
 */
import { type CalendarDate, parseDate } from "@internationalized/date";

const props = withDefaults(
	defineProps<{
		/** Earliest selectable day, `YYYY-MM-DD`. */
		min?: string;
		/** Latest selectable day, `YYYY-MM-DD`. */
		max?: string;
		/** Show a button that empties the field (for optional dates). */
		clearable?: boolean;
		disabled?: boolean;
	}>(),
	{ min: undefined, max: undefined, clearable: false, disabled: false },
);

const model = defineModel<string | null>({ default: "" });

const open = ref(false);

function toCalendarDate(value: string | null | undefined): CalendarDate | undefined {
	if (!value) return undefined;
	try {
		return parseDate(value.slice(0, 10));
	} catch {
		return undefined;
	}
}

const value = computed({
	get: () => toCalendarDate(model.value),
	set: (date: CalendarDate | undefined | null) => {
		model.value = date ? date.toString() : "";
	},
});

function pick(date: unknown) {
	value.value = (date as CalendarDate | undefined) ?? undefined;
	open.value = false;
}

const minValue = computed(() => toCalendarDate(props.min));
const maxValue = computed(() => toCalendarDate(props.max));
</script>

<template>
	<UInputDate
		v-model="value"
		:min-value="minValue"
		:max-value="maxValue"
		:disabled="disabled"
		class="w-full"
	>
		<template #trailing>
			<div class="flex items-center gap-0.5">
				<UButton
					v-if="clearable && value"
					color="neutral"
					variant="link"
					size="sm"
					icon="i-lucide-x"
					aria-label="Datum leeren"
					class="px-0"
					:disabled="disabled"
					@click="value = undefined"
				/>
				<UPopover v-model:open="open">
					<UButton
						color="neutral"
						variant="link"
						size="sm"
						icon="i-lucide-calendar"
						aria-label="Datum im Kalender wählen"
						class="px-0"
						:disabled="disabled"
					/>
					<template #content>
						<UCalendar
							:model-value="value"
							:min-value="minValue"
							:max-value="maxValue"
							:week-starts-on="1"
							class="p-2"
							@update:model-value="pick"
						/>
					</template>
				</UPopover>
			</div>
		</template>
	</UInputDate>
</template>
