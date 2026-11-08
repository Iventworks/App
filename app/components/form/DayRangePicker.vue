<script setup lang="ts">
/**
 * From–to date range with Nuxt UI's calendar: two segmented date fields (`UInputDate range`) plus
 * a range `UCalendar` popover (two months on wider screens). Models are `YYYY-MM-DD` strings, so
 * event dates and filters keep their format. Emits `change` once both ends are set.
 */
import { type CalendarDate, parseDate } from "@internationalized/date";
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";

const props = withDefaults(
	defineProps<{
		min?: string;
		max?: string;
		disabled?: boolean;
	}>(),
	{ min: undefined, max: undefined, disabled: false },
);

const start = defineModel<string>("start", { default: "" });
const end = defineModel<string>("end", { default: "" });

const emit = defineEmits<{ change: [range: { start: string; end: string }] }>();

const open = ref(false);
const isMobile = useBreakpoints(breakpointsTailwind).smaller("sm");

function toCalendarDate(value: string | null | undefined): CalendarDate | undefined {
	if (!value) return undefined;
	try {
		return parseDate(value.slice(0, 10));
	} catch {
		return undefined;
	}
}

type Range = { start: CalendarDate | undefined; end: CalendarDate | undefined };

const range = computed<Range>(() => ({
	start: toCalendarDate(start.value),
	end: toCalendarDate(end.value),
}));

function apply(value: Partial<Range> | null | undefined) {
	start.value = value?.start ? value.start.toString() : "";
	end.value = value?.end ? value.end.toString() : "";
	if (start.value && end.value) emit("change", { start: start.value, end: end.value });
}

function pick(value: unknown) {
	const next = value as Partial<Range> | null;
	apply(next);
	if (next?.start && next?.end) open.value = false;
}

const minValue = computed(() => toCalendarDate(props.min));
const maxValue = computed(() => toCalendarDate(props.max));
</script>

<template>
	<UInputDate
		:model-value="range as any"
		range
		:min-value="minValue"
		:max-value="maxValue"
		:disabled="disabled"
		class="w-full"
		@update:model-value="apply($event as any)"
	>
		<template #trailing>
			<UPopover v-model:open="open">
				<UButton
					color="neutral"
					variant="link"
					size="sm"
					icon="i-lucide-calendar-range"
					aria-label="Zeitraum im Kalender wählen"
					class="px-0"
					:disabled="disabled"
				/>
				<template #content>
					<UCalendar
						:model-value="range as any"
						range
						:min-value="minValue"
						:max-value="maxValue"
						:number-of-months="isMobile ? 1 : 2"
						:week-starts-on="1"
						class="p-2"
						@update:model-value="pick"
					/>
				</template>
			</UPopover>
		</template>
	</UInputDate>
</template>
