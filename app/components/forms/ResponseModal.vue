<script setup lang="ts">
/** One answer with every question, paged through the (filtered) list; deleting it, e.g. spam. */

import type { FormField, FormResponse } from "~/utils/forms";
import { FormAnswers, FormFields } from "~~/server/lib/forms/fields";

const props = defineProps<{
	fields: FormField[];
	/** The list to page through, newest first. */
	responses: FormResponse[];
}>();

const emit = defineEmits<{ delete: [response: FormResponse] }>();

/** The number of the answer shown; null closes the dialog. */
const number = defineModel<number | null>({ required: true });

const index = computed(() =>
	props.responses.findIndex((response) => response.number === number.value),
);
const response = computed(() => props.responses[index.value] ?? null);

const open = computed({
	get: () => number.value !== null && response.value !== null,
	set: (value) => {
		if (!value) number.value = null;
	},
});

/** Questions shown for this answer (conditions), others greyed out. */
const rows = computed(() => {
	const current = response.value;
	if (!current) return [];
	const visible = FormAnswers.visibleIds(props.fields, current.answers);
	return props.fields.map((field) => ({
		field,
		shown: visible.has(field.id),
		text: field.type === "section" ? "" : answerText(field, current.answers[field.id]),
	}));
});

const unknownCount = computed(() => {
	const current = response.value;
	if (!current) return 0;
	const known = new Set(FormFields.questionsOf(props.fields).map((field) => field.id));
	return Object.keys(current.answers).filter((id) => !known.has(id)).length;
});

function go(delta: number) {
	const next = props.responses[index.value + delta];
	if (next) number.value = next.number;
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="response ? `Antwort Nr. ${response.number}` : 'Antwort'"
		:description="response ? `Eingegangen ${formatDate(response.created_at)}` : undefined"
		icon="i-lucide-inbox"
		width="sm:max-w-2xl"
	>
		<div v-if="response" class="space-y-4">
			<dl class="space-y-3">
				<template v-for="row in rows" :key="row.field.id">
					<dt
						v-if="row.field.type === 'section'"
						class="border-b border-slate-800 pt-2 text-sm font-semibold"
						:class="row.shown ? 'text-white' : 'text-slate-600'"
					>
						{{ row.field.label || "Abschnitt" }}
					</dt>
					<div v-else :class="row.shown ? '' : 'opacity-50'">
						<dt class="text-sm text-slate-400">{{ row.field.label }}</dt>
						<dd class="whitespace-pre-line break-words text-white">
							<template v-if="row.text">{{ row.text }}</template>
							<span v-else class="text-slate-600">{{ row.shown ? "–" : "nicht gefragt" }}</span>
						</dd>
					</div>
				</template>
			</dl>
			<p v-if="unknownCount" class="text-xs text-slate-500">
				Dazu {{ unknownCount === 1 ? "eine Antwort" : `${unknownCount} Antworten` }} auf inzwischen gelöschte Fragen.
			</p>
		</div>

		<template #footer>
			<div class="flex w-full items-center justify-between gap-2">
				<UButton
					icon="i-lucide-trash-2"
					label="Löschen"
					color="error"
					variant="ghost"
					:disabled="!response"
					@click="response && emit('delete', response)"
				/>
				<div class="flex items-center gap-1">
					<span class="mr-2 text-sm text-slate-400 tabular-nums">{{ index + 1 }} / {{ responses.length }}</span>
					<UButton
						icon="i-lucide-chevron-left"
						color="neutral"
						variant="outline"
						aria-label="Neuere Antwort"
						:disabled="index <= 0"
						@click="go(-1)"
					/>
					<UButton
						icon="i-lucide-chevron-right"
						color="neutral"
						variant="outline"
						aria-label="Ältere Antwort"
						:disabled="index >= responses.length - 1"
						@click="go(1)"
					/>
				</div>
			</div>
		</template>
	</DashboardModal>
</template>
