<script setup lang="ts">
/**
 * The statistics of the (filtered) answers, question by question: bars for choices, ratings and
 * scales, average and range for numbers, the latest answers for text.
 */

import type { FormField, FormResponse } from "~/utils/forms";
import { FormFields } from "~~/server/lib/forms/fields";

const props = defineProps<{
	fields: FormField[];
	responses: FormResponse[];
}>();

const emit = defineEmits<{ open: [number: number] }>();

const TEXT_PREVIEW = 5;
const expanded = ref(new Set<string>());

const questions = computed(() =>
	FormFields.questionsOf(props.fields).map((field) => ({
		field,
		stats: fieldStats(field, props.responses),
	})),
);

function format(value: number | null, digits = 1) {
	return value === null ? "–" : value.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

function bars(rows: { label: string; count: number }[], answered: number) {
	return rows.map((row) => ({
		label: row.label,
		value: row.count,
		hint: answered ? `${Math.round((row.count / answered) * 100)} %` : undefined,
	}));
}

function toggle(id: string) {
	const next = new Set(expanded.value);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	expanded.value = next;
}
</script>

<template>
	<div class="space-y-4">
		<UEmpty
			v-if="!questions.length"
			icon="i-lucide-list-plus"
			title="Keine Fragen"
			description="Das Formular hat keine Fragen, die man beantworten kann."
		/>
		<DashboardSectionCard
			v-for="{ field, stats } in questions"
			:key="field.id"
			:title="field.label"
			:description="`${stats.answered} von ${responses.length} ${responses.length === 1 ? 'Antwort' : 'Antworten'}${field.type === 'multiple_choice' ? ' · Mehrfachauswahl' : ''}`"
			:icon="FORM_FIELD_TYPES[field.type].icon"
		>
			<template v-if="stats.kind === 'choice'">
				<FinanceBarList :items="bars(stats.rows, stats.answered)" empty-text="Noch keine Antworten." />
			</template>

			<template v-else-if="stats.kind === 'numbers'">
				<div class="space-y-4">
					<div class="grid grid-cols-3 gap-3 text-center">
						<div class="rounded-md bg-slate-800/50 p-3">
							<p class="text-xs text-slate-400">Durchschnitt</p>
							<p class="text-xl font-semibold text-white tabular-nums">
								{{ format(stats.average) }}
								<span v-if="field.type === 'rating'" class="text-sm font-normal text-slate-400">/ {{ field.max }}</span>
							</p>
						</div>
						<div class="rounded-md bg-slate-800/50 p-3">
							<p class="text-xs text-slate-400">Niedrigste</p>
							<p class="text-xl font-semibold text-white tabular-nums">{{ format(stats.min, 2) }}</p>
						</div>
						<div class="rounded-md bg-slate-800/50 p-3">
							<p class="text-xs text-slate-400">Höchste</p>
							<p class="text-xl font-semibold text-white tabular-nums">{{ format(stats.max, 2) }}</p>
						</div>
					</div>
					<FinanceBarList v-if="stats.rows.length" :items="bars(stats.rows, stats.answered)" />
				</div>
			</template>

			<template v-else>
				<p v-if="!stats.latest.length" class="text-sm text-slate-500">Noch keine Antworten.</p>
				<ul v-else class="divide-y divide-slate-800">
					<li
						v-for="entry in expanded.has(field.id) ? stats.latest : stats.latest.slice(0, TEXT_PREVIEW)"
						:key="entry.number"
						class="flex gap-3 py-2 first:pt-0"
					>
						<button
							type="button"
							class="shrink-0 text-xs text-slate-500 tabular-nums hover:text-primary-400"
							:aria-label="`Antwort Nr. ${entry.number} öffnen`"
							@click="emit('open', entry.number)"
						>
							#{{ entry.number }}
						</button>
						<span class="min-w-0 whitespace-pre-line break-words text-sm text-slate-200">{{ entry.text }}</span>
					</li>
				</ul>
				<UButton
					v-if="stats.latest.length > TEXT_PREVIEW"
					:label="expanded.has(field.id) ? 'Weniger anzeigen' : `Alle ${stats.latest.length} anzeigen`"
					:icon="expanded.has(field.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
					size="sm"
					color="neutral"
					variant="ghost"
					class="mt-2"
					@click="toggle(field.id)"
				/>
			</template>
		</DashboardSectionCard>
	</div>
</template>
