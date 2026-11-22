<script setup lang="ts">
/**
 * One question (or section) in the form editor: its type, text, help text, options or range,
 * whether it must be answered, and the condition that shows it only for an earlier answer.
 */

import type { FormField } from "~/utils/forms";
import { FormFields } from "~~/server/lib/forms/fields";

const props = defineProps<{
	index: number;
	count: number;
	/** The questions before this one (conditions may only name those). */
	earlier: FormField[];
	problem?: string | null;
	/**
	 * The saved type of a question that already has answers: it may only change to a type its
	 * answers still fit (`FormFields.canChangeType`). Null: any type.
	 */
	answeredType?: FormFields.Type | null;
}>();

const emit = defineEmits<{
	move: [delta: -1 | 1];
	duplicate: [];
	remove: [];
}>();

const field = defineModel<FormField>({ required: true });

const typeItems = computed(() =>
	FORM_FIELD_GROUPS.flat().map((type) => ({
		label: FORM_FIELD_TYPES[type].label,
		value: type,
		icon: FORM_FIELD_TYPES[type].icon,
		disabled: Boolean(props.answeredType && !FormFields.canChangeType(props.answeredType, type)),
	})),
);

/**
 * Another type keeps text, help text, condition — and the options between choice types. Copied
 * as plain data: the new question must not hold the old one's reactive objects.
 */
function changeType(type: FormFields.Type) {
	const current = cloneFormFields(field.value);
	if (type === current.type) return;
	const next = newFormField(type);
	next.id = current.id;
	next.label = current.label;
	next.description = current.description;
	next.required = type === "section" ? false : current.required;
	next.condition = current.condition;
	if (FormFields.isChoice(next) && FormFields.isChoice(current)) next.options = current.options;
	field.value = next;
}

// --- options -----------------------------------------------------------------------------------

const optionList = ref<HTMLElement | null>(null);

async function addOption(at?: number) {
	if (!FormFields.isChoice(field.value)) return;
	const options = field.value.options;
	const index = at ?? options.length;
	options.splice(index, 0, { id: newFormId(), label: `Option ${options.length + 1}` });
	await nextTick();
	const input = optionList.value?.querySelectorAll("input")[index];
	input?.focus();
	input?.select();
}

function removeOption(index: number) {
	if (FormFields.isChoice(field.value)) field.value.options.splice(index, 1);
}

const optionIcon = computed(() =>
	field.value.type === "multiple_choice"
		? "i-lucide-square"
		: field.value.type === "dropdown"
			? "i-lucide-chevron-right"
			: "i-lucide-circle",
);

// --- number, rating, scale ---------------------------------------------------------------------

function numberOrNull(value: string | number | null | undefined) {
	if (value === "" || value === null || value === undefined) return null;
	const parsed = typeof value === "number" ? value : parseGermanNumber(value);
	return Number.isFinite(parsed) ? parsed : null;
}

const ratingItems = Array.from({ length: 8 }, (_, i) => ({
	label: `${i + 3} Sterne`,
	value: i + 3,
}));
const scaleMinItems = [0, 1].map((value) => ({ label: String(value), value }));
const scaleMaxItems = Array.from({ length: 9 }, (_, i) => ({ label: String(i + 2), value: i + 2 }));

// --- condition ---------------------------------------------------------------------------------

const choiceBefore = computed(() => props.earlier.filter(FormFields.isChoice));

const conditionTarget = computed(() =>
	choiceBefore.value.find((candidate) => candidate.id === field.value.condition?.field_id),
);

const conditionOptions = computed(() =>
	(conditionTarget.value?.options ?? []).map((option) => ({
		label: option.label,
		value: option.id,
	})),
);

function toggleCondition(on: boolean) {
	const first = choiceBefore.value.at(-1);
	field.value.condition = on && first ? { field_id: first.id, option_ids: [] } : null;
}

function setConditionField(fieldId: string) {
	field.value.condition = { field_id: fieldId, option_ids: [] };
}
</script>

<template>
	<div
		:data-question="field.id"
		class="rounded-lg border bg-slate-900/60"
		:class="problem ? 'border-red-500/60' : field.type === 'section' ? 'border-primary-500/30' : 'border-slate-800'"
	>
		<div class="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2 sm:px-4">
			<span class="text-xs font-medium text-slate-500 tabular-nums">{{ index + 1 }}</span>
			<USelect
				:model-value="field.type"
				:items="typeItems"
				:icon="FORM_FIELD_TYPES[field.type].icon"
				size="sm"
				variant="ghost"
				class="w-48"
				aria-label="Art der Frage"
				@update:model-value="changeType($event as FormFields.Type)"
			/>
			<UBadge
				v-if="field.condition"
				label="mit Bedingung"
				icon="i-lucide-git-branch"
				color="info"
				variant="subtle"
				size="sm"
			/>
			<div class="ml-auto flex items-center gap-0.5">
				<UButton
					icon="i-lucide-arrow-up"
					size="sm"
					color="neutral"
					variant="ghost"
					aria-label="Nach oben"
					:disabled="index === 0"
					@click="emit('move', -1)"
				/>
				<UButton
					icon="i-lucide-arrow-down"
					size="sm"
					color="neutral"
					variant="ghost"
					aria-label="Nach unten"
					:disabled="index === count - 1"
					@click="emit('move', 1)"
				/>
				<UButton
					icon="i-lucide-copy"
					size="sm"
					color="neutral"
					variant="ghost"
					aria-label="Duplizieren"
					@click="emit('duplicate')"
				/>
				<UButton
					icon="i-lucide-trash-2"
					size="sm"
					color="error"
					variant="ghost"
					aria-label="Löschen"
					@click="emit('remove')"
				/>
			</div>
		</div>

		<div class="space-y-4 p-3 sm:p-4">
			<UInput
				v-model="field.label"
				:placeholder="field.type === 'section' ? 'Überschrift' : 'Frage'"
				:maxlength="500"
				size="lg"
				class="w-full"
				:ui="{ base: field.type === 'section' ? 'font-semibold' : 'font-medium' }"
			/>
			<UTextarea
				v-model="field.description"
				:placeholder="field.type === 'section' ? 'Text (optional)' : 'Hinweis zur Frage (optional)'"
				:rows="1"
				:maxlength="2000"
				autoresize
				class="w-full"
			/>

			<div v-if="FormFields.isChoice(field)" ref="optionList" class="space-y-2">
				<div v-for="(option, optionIndex) in field.options" :key="option.id" class="flex items-center gap-2">
					<UIcon :name="optionIcon" class="size-4 shrink-0 text-slate-500" />
					<UInput
						v-model="option.label"
						placeholder="Option"
						:maxlength="200"
						class="min-w-0 flex-1"
						@keydown.enter.prevent="addOption(optionIndex + 1)"
					/>
					<UButton
						icon="i-lucide-x"
						size="sm"
						color="neutral"
						variant="ghost"
						aria-label="Option entfernen"
						:disabled="field.options.length <= 1"
						@click="removeOption(optionIndex)"
					/>
				</div>
				<UButton
					v-if="field.options.length < FormFields.MAX_OPTIONS"
					label="Option hinzufügen"
					icon="i-lucide-plus"
					size="sm"
					color="neutral"
					variant="ghost"
					@click="addOption()"
				/>
			</div>

			<div v-else-if="field.type === 'number'" class="grid gap-3 sm:grid-cols-3">
				<UFormField label="Mindestens">
					<UInput
						:model-value="numberInputText(field.min)"
						inputmode="decimal"
						placeholder="beliebig"
						class="w-full"
						@update:model-value="field.min = numberOrNull($event)"
					/>
				</UFormField>
				<UFormField label="Höchstens">
					<UInput
						:model-value="numberInputText(field.max)"
						inputmode="decimal"
						placeholder="beliebig"
						class="w-full"
						@update:model-value="field.max = numberOrNull($event)"
					/>
				</UFormField>
				<UFormField label="Nur ganze Zahlen" class="sm:pt-6">
					<USwitch v-model="field.integer" />
				</UFormField>
			</div>

			<UFormField v-else-if="field.type === 'rating'" label="Höchstwertung">
				<USelect v-model="field.max" :items="ratingItems" class="w-40" />
			</UFormField>

			<div v-else-if="field.type === 'scale'" class="grid gap-3 sm:grid-cols-2">
				<UFormField label="Von">
					<div class="flex gap-2">
						<USelect v-model="field.min" :items="scaleMinItems" class="w-20" />
						<UInput v-model="field.min_label" placeholder="Beschriftung, z. B. „gar nicht“" :maxlength="100" class="min-w-0 flex-1" />
					</div>
				</UFormField>
				<UFormField label="Bis">
					<div class="flex gap-2">
						<USelect v-model="field.max" :items="scaleMaxItems" class="w-20" />
						<UInput v-model="field.max_label" placeholder="Beschriftung, z. B. „sehr“" :maxlength="100" class="min-w-0 flex-1" />
					</div>
				</UFormField>
			</div>

			<div class="flex flex-col gap-3 border-t border-slate-800 pt-3">
				<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
					<USwitch v-if="field.type !== 'section'" v-model="field.required" label="Pflichtfrage" />
					<USwitch
						v-if="choiceBefore.length"
						:model-value="Boolean(field.condition)"
						:label="field.type === 'section' ? 'Abschnitt nur bei bestimmter Antwort zeigen' : 'Nur bei bestimmter Antwort zeigen'"
						@update:model-value="toggleCondition"
					/>
				</div>
				<div v-if="field.condition" class="flex flex-col gap-2 rounded-md bg-slate-800/50 p-3 sm:flex-row sm:items-center">
					<span class="shrink-0 text-sm text-slate-400">Wenn bei</span>
					<USelect
						:model-value="field.condition.field_id"
						:items="choiceBefore.map((candidate) => ({ label: candidate.label || 'Frage ohne Text', value: candidate.id }))"
						class="w-full sm:w-56"
						aria-label="Frage"
						@update:model-value="setConditionField($event as string)"
					/>
					<span class="shrink-0 text-sm text-slate-400">gewählt ist:</span>
					<USelectMenu
						v-model="field.condition.option_ids"
						:items="conditionOptions"
						value-key="value"
						multiple
						placeholder="Antwort wählen"
						class="w-full sm:w-56"
						aria-label="Antworten"
					/>
				</div>
				<p v-if="field.type === 'section' && field.condition" class="text-xs text-slate-500">
					Gilt für alle Fragen bis zum nächsten Abschnitt.
				</p>
			</div>

			<p v-if="problem" class="flex items-center gap-1.5 text-sm text-red-400">
				<UIcon name="i-lucide-circle-alert" class="size-4 shrink-0" />
				{{ problem }}
			</p>
		</div>
	</div>
</template>
