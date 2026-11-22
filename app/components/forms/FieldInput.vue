<script setup lang="ts">
/**
 * The input for one question of a form being filled in. Choice answers are arrays of option ids
 * (one for single choice and dropdown), as `FormAnswers` expects.
 */

import type { FormAnswerValue, FormField } from "~/utils/forms";
import { FormFields } from "~~/server/lib/forms/fields";

const props = defineProps<{
	field: FormField;
	invalid?: boolean;
}>();

const model = defineModel<FormAnswerValue | undefined>();

const options = computed(() =>
	FormFields.isChoice(props.field)
		? props.field.options.map((option) => ({ label: option.label, value: option.id }))
		: [],
);

const text = computed({
	get: () => (typeof model.value === "string" ? model.value : ""),
	set: (value: string) => {
		model.value = value;
	},
});

const single = computed({
	get: () => (Array.isArray(model.value) ? model.value[0] : undefined),
	set: (id: string | undefined) => {
		model.value = id ? [id] : [];
	},
});

const multiple = computed({
	get: () => (Array.isArray(model.value) ? model.value : []),
	set: (ids: string[]) => {
		model.value = ids;
	},
});

// Numbers are typed as text, the German way ("1,5", "1.000"); what isn't a number stays text and
// is reported.
const numberText = ref(typeof model.value === "number" ? numberInputText(model.value) : "");
watch(numberText, (value) => {
	const trimmed = value.trim();
	const parsed = parseGermanNumber(trimmed);
	model.value = trimmed === "" ? undefined : Number.isFinite(parsed) ? parsed : trimmed;
});

const steps = computed(() => {
	const field = props.field;
	if (field.type === "rating") return Array.from({ length: field.max }, (_, i) => i + 1);
	if (field.type === "scale") {
		return Array.from({ length: field.max - field.min + 1 }, (_, i) => i + field.min);
	}
	return [];
});

function pick(step: number) {
	// Clicking the chosen step again takes the answer back.
	model.value = model.value === step ? undefined : step;
}

const STAR =
	"M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z";
</script>

<template>
	<UInput
		v-if="field.type === 'short_text'"
		v-model="text"
		:color="invalid ? 'error' : undefined"
		:maxlength="FormFields.MAX_SHORT_TEXT"
		class="w-full"
	/>
	<UTextarea
		v-else-if="field.type === 'long_text'"
		v-model="text"
		:color="invalid ? 'error' : undefined"
		:maxlength="FormFields.MAX_LONG_TEXT"
		:rows="3"
		autoresize
		class="w-full"
	/>
	<UInput
		v-else-if="field.type === 'email'"
		v-model="text"
		type="email"
		autocomplete="email"
		:color="invalid ? 'error' : undefined"
		class="w-full sm:max-w-sm"
	/>
	<UInput
		v-else-if="field.type === 'number'"
		v-model="numberText"
		inputmode="decimal"
		:color="invalid ? 'error' : undefined"
		class="w-full sm:max-w-48"
	/>
	<FormDatePicker v-else-if="field.type === 'date'" v-model="text" :clearable="!field.required" class="w-full sm:max-w-56" />
	<URadioGroup
		v-else-if="field.type === 'single_choice'"
		v-model="single"
		:items="options"
		:color="invalid ? 'error' : 'primary'"
	/>
	<UCheckboxGroup
		v-else-if="field.type === 'multiple_choice'"
		v-model="multiple"
		:items="options"
		:color="invalid ? 'error' : 'primary'"
	/>
	<USelect
		v-else-if="field.type === 'dropdown'"
		v-model="single"
		:items="options"
		placeholder="Bitte auswählen"
		:color="invalid ? 'error' : undefined"
		class="w-full sm:max-w-sm"
	/>
	<div v-else-if="field.type === 'rating'" class="flex gap-1" role="radiogroup" :aria-label="field.label">
		<button
			v-for="step in steps"
			:key="step"
			type="button"
			role="radio"
			:aria-checked="model === step"
			:aria-label="`${step} von ${field.max}`"
			class="rounded p-0.5 focus-visible:outline-2 focus-visible:outline-primary-400"
			@click="pick(step)"
		>
			<svg viewBox="0 0 24 24" class="size-8" aria-hidden="true">
				<path
					:d="STAR"
					stroke-width="1.5"
					stroke-linejoin="round"
					:class="
						typeof model === 'number' && model >= step
							? 'fill-amber-400 stroke-amber-400'
							: 'fill-transparent stroke-slate-500'
					"
				/>
			</svg>
		</button>
	</div>
	<div v-else-if="field.type === 'scale'" class="space-y-1.5">
		<div class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="field.label">
			<UButton
				v-for="step in steps"
				:key="step"
				:label="String(step)"
				role="radio"
				:aria-checked="model === step"
				:color="model === step ? 'primary' : 'neutral'"
				:variant="model === step ? 'solid' : 'outline'"
				class="min-w-10 justify-center tabular-nums"
				@click="pick(step)"
			/>
		</div>
		<div v-if="field.min_label || field.max_label" class="flex justify-between gap-4 text-xs text-slate-400">
			<span>{{ field.min }} = {{ field.min_label || "–" }}</span>
			<span>{{ field.max }} = {{ field.max_label || "–" }}</span>
		</div>
	</div>
</template>
