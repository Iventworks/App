<script setup lang="ts">
import type { Period, Range } from "~/utils/types";

const model = defineModel<Period>({ required: true });

const props = defineProps<{
	range: Range;
}>();

const days = computed(() => [
	...Array(
		Math.ceil((props.range.end.getTime() - props.range.start.getTime()) / (1000 * 60 * 60 * 24)),
	).keys(),
]);

const periods = computed<Period[]>(() => {
	if (days.value.length <= 8) {
		return ["daily"];
	}

	if (days.value.length <= 31) {
		return ["daily", "weekly"];
	}

	return ["weekly", "monthly"];
});

// Ensure the model value is always a valid period
watch(periods, () => {
	if (!periods.value.includes(model.value)) {
		model.value = periods.value[0]!;
	}
});
</script>

<template>
  <USelect
    v-model="model"
    :items="periods"
    variant="ghost"
    class="data-[state=open]:bg-elevated"
    :ui="{ value: 'capitalize', itemLabel: 'capitalize', trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
  />
</template>
