<script setup lang="ts">
/**
 * A form to fill in: its sections and questions, shown or hidden by their conditions, checked
 * with the server's rules (`FormAnswers.check`) before `submit` hands over the answers. Used by
 * the public page and the preview.
 */

import type { FormAnswerValue, FormField } from "~/utils/forms";
import { FormAnswers } from "~~/server/lib/forms/fields";

const props = withDefaults(
	defineProps<{
		fields: FormField[];
		submitting?: boolean;
		/** Preview: sending only checks the answers. */
		preview?: boolean;
	}>(),
	{ submitting: false, preview: false },
);

const emit = defineEmits<{ submit: [answers: FormAnswers.Answers] }>();

const answers = ref<Record<string, FormAnswerValue | undefined>>({});
const problems = ref<Record<string, FormAnswers.Problem>>({});
const tried = ref(false);

const given = computed(() => {
	const result: FormAnswers.Answers = {};
	for (const [id, value] of Object.entries(answers.value))
		if (value !== undefined) result[id] = value;
	return result;
});
const visible = computed(() => FormAnswers.visibleIds(props.fields, given.value));
const shown = computed(() => props.fields.filter((field) => visible.value.has(field.id)));

// After the first try, problems update while typing.
watch(given, () => {
	if (tried.value) problems.value = FormAnswers.check(props.fields, given.value).problems;
});

const root = ref<HTMLElement | null>(null);

function submit() {
	tried.value = true;
	const result = FormAnswers.check(props.fields, given.value);
	problems.value = result.problems;
	const first = props.fields.find((field) => result.problems[field.id]);
	if (first) {
		root.value
			?.querySelector(`[data-field="${first.id}"]`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
		return;
	}
	emit("submit", result.answers);
}

function reset() {
	answers.value = {};
	problems.value = {};
	tried.value = false;
}

defineExpose({ reset });
</script>

<template>
	<form ref="root" class="space-y-4" novalidate @submit.prevent="submit">
		<template v-for="field in shown" :key="field.id">
			<div v-if="field.type === 'section'" class="pt-4 first:pt-0">
				<h2 v-if="field.label" class="text-lg font-semibold text-white">{{ field.label }}</h2>
				<p v-if="field.description" class="mt-1 whitespace-pre-line text-sm text-slate-400">
					{{ field.description }}
				</p>
			</div>
			<div
				v-else
				:data-field="field.id"
				class="space-y-3 rounded-lg border bg-slate-900/60 p-4 sm:p-5"
				:class="problems[field.id] ? 'border-red-500/60' : 'border-slate-800'"
			>
				<div>
					<p :id="`question-${field.id}`" class="font-medium text-white">
						{{ field.label }}
						<span v-if="field.required" class="text-red-400" aria-label="Pflichtfrage">*</span>
					</p>
					<p v-if="field.description" class="mt-1 whitespace-pre-line text-sm text-slate-400">
						{{ field.description }}
					</p>
				</div>
				<FormsFieldInput
					v-model="answers[field.id]"
					:field="field"
					:invalid="Boolean(problems[field.id])"
					:aria-labelledby="`question-${field.id}`"
				/>
				<p v-if="problems[field.id]" class="flex items-center gap-1.5 text-sm text-red-400">
					<UIcon name="i-lucide-circle-alert" class="size-4 shrink-0" />
					{{ answerProblemText(field, problems[field.id]!) }}
				</p>
			</div>
		</template>

		<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
			<UButton
				type="submit"
				:label="preview ? 'Antworten prüfen' : 'Absenden'"
				:icon="preview ? 'i-lucide-check-check' : 'i-lucide-send'"
				size="lg"
				:loading="submitting"
				class="justify-center"
			/>
			<p v-if="preview" class="text-sm text-slate-400">In der Vorschau wird nichts gespeichert.</p>
			<p v-else-if="tried && Object.keys(problems).length" class="text-sm text-red-400">
				Bitte prüfe die markierten Fragen.
			</p>
		</div>
	</form>
</template>
