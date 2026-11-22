<script setup lang="ts">
/**
 * "Antworten": the statistics ("Auswertung") or the single answers ("Einzelne Antworten") of a
 * form, both for the same filter — period, an answer to a choice question, text — and the CSV
 * export of what the filter shows. Answers can be deleted one by one or all at once.
 */
import type { TableColumn } from "@nuxt/ui";
import type { FormResponse } from "~/utils/forms";
import { FormFields } from "~~/server/lib/forms/fields";

const detail = useFormDetail();
const { form } = detail;
const toast = useToast();
const ask = useConfirmDialog();

const { value: view, items: viewItems } = useQueryFilter("view", [
	{ value: "summary", label: "Auswertung", icon: "i-lucide-chart-column" },
	{ value: "list", label: "Einzelne Antworten", icon: "i-lucide-rows-3" },
]);

const {
	data: responses,
	loading,
	refresh,
} = await useAPIAsyncData(`form-${detail.formId}-responses`, async () => {
	const result = await useAPI((api) =>
		api.getFormsByFormIdResponses({ path: { formId: detail.formId } }),
	);
	if (!result.success) {
		toast.add({
			title: "Antworten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as FormResponse[];
	}
	return result.data;
});

async function reload() {
	await Promise.all([refresh(), detail.refresh()]);
}

// --- filter ------------------------------------------------------------------------------------

const filter = reactive(emptyResponseFilter());
const period = ref<{ start: Date | null; end: Date | null }>({ start: null, end: null });
watch(period, (range) => {
	filter.from = range.start ? toDayString(range.start) : null;
	filter.to = range.end ? toDayString(range.end) : range.start ? toDayString(range.start) : null;
});

const choiceQuestions = computed(() => form.value.fields.filter(FormFields.isChoice));
const filterQuestionItems = computed(() =>
	choiceQuestions.value.map((field) => ({ label: field.label, value: field.id })),
);
const filterOptionItems = computed(() =>
	(choiceQuestions.value.find((field) => field.id === filter.fieldId)?.options ?? []).map(
		(option) => ({
			label: option.label,
			value: option.id,
		}),
	),
);
watch(
	() => filter.fieldId,
	() => {
		filter.optionIds = [];
	},
);

const filtered = computed(() => filterResponses(form.value.fields, responses.value ?? [], filter));
const filtering = computed(() =>
	Boolean(filter.from || filter.to || filter.search.trim() || filter.optionIds.length),
);

function resetFilter() {
	Object.assign(filter, emptyResponseFilter());
	period.value = { start: null, end: null };
}

// --- single answers --------------------------------------------------------------------------

const questions = computed(() => FormFields.questionsOf(form.value.fields));
const shownQuestions = computed(() => questions.value.slice(0, 3));

const columns = computed<TableColumn<FormResponse>[]>(() => [
	{ accessorKey: "number", header: "Nr." },
	{ accessorKey: "created_at", header: "Eingegangen" },
	...shownQuestions.value.map((field) => ({
		id: `q_${field.id}`,
		header: field.label,
		accessorFn: (row: FormResponse) => answerText(field, row.answers[field.id]),
	})),
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
]);

const openNumber = ref<number | null>(null);

async function removeOne(response: FormResponse) {
	const choice = await ask({
		title: `Antwort Nr. ${response.number} löschen?`,
		description: "Sie fehlt danach auch in der Auswertung und im Export.",
		icon: "i-lucide-trash-2",
		iconColor: "error",
		confirmLabel: "Löschen",
		confirmColor: "error",
	});
	if (choice !== "confirm") return;
	const result = await useAPI((api) =>
		api.deleteFormsByFormIdResponsesByResponseId({
			path: { formId: detail.formId, responseId: response.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	// Show the next one instead of closing.
	const list = filtered.value;
	const position = list.findIndex((entry) => entry.number === response.number);
	const next = list[position + 1] ?? list[position - 1];
	toast.add({ title: "Antwort gelöscht", color: "success" });
	await reload();
	if (openNumber.value !== null)
		openNumber.value = next && next.number !== response.number ? next.number : null;
}

const deleteAllOpen = ref(false);

async function removeAll() {
	const result = await useAPI((api) =>
		api.deleteFormsByFormIdResponses({ path: { formId: detail.formId } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Alle Antworten gelöscht", color: "success" });
	await reload();
}

// --- export -------------------------------------------------------------------------------------

function exportCsv() {
	const csv = responsesCsv(form.value.fields, filtered.value);
	downloadBlob(
		new Blob([csv], { type: "text/csv;charset=utf-8" }),
		`antworten-${fileSlug(form.value.title, "formular")}.csv`,
	);
}

const moreItems = computed(() => [
	[
		{
			label: "Alle Antworten löschen",
			icon: "i-lucide-trash-2",
			color: "error" as const,
			disabled: !(responses.value ?? []).length,
			onSelect: () => (deleteAllOpen.value = true),
		},
	],
]);
</script>

<template>
	<div class="space-y-6">
		<div class="grid gap-4 sm:grid-cols-3">
			<DashboardStatCard
				label="Antworten"
				:value="filtering ? `${filtered.length} von ${(responses ?? []).length}` : (responses ?? []).length"
				:hint="filtering ? 'mit Filter' : undefined"
				icon="i-lucide-inbox"
				:loading="loading"
			/>
			<DashboardStatCard
				label="Letzte Antwort"
				:value="form.last_response_at ? formatRelative(form.last_response_at) : '–'"
				icon="i-lucide-clock"
				icon-color="info"
			/>
			<DashboardStatCard
				label="Status"
				:value="FORM_STATES[formStateOf(form)].short"
				:icon="FORM_STATES[formStateOf(form)].icon"
				:icon-color="form.accepting ? 'emerald' : 'amber'"
			/>
		</div>

		<DashboardFilterBar>
			<template #left>
				<USelect v-model="view" :items="viewItems" class="w-full sm:w-52" />
				<FormDateRangePicker v-model="period" class="w-full sm:w-auto" />
				<template v-if="choiceQuestions.length">
					<USelect
						v-model="filter.fieldId"
						:items="filterQuestionItems"
						placeholder="Nach Antwort filtern"
						icon="i-lucide-filter"
						class="w-full sm:w-56"
					/>
					<USelectMenu
						v-if="filter.fieldId"
						v-model="filter.optionIds"
						:items="filterOptionItems"
						value-key="value"
						multiple
						placeholder="Antwort wählen"
						class="w-full sm:w-48"
					/>
				</template>
				<UInput v-model="filter.search" icon="i-lucide-search" placeholder="In Antworten suchen …" class="w-full sm:w-56" />
				<UButton v-if="filtering || filter.fieldId" label="Zurücksetzen" icon="i-lucide-x" color="neutral" variant="ghost" @click="resetFilter" />
			</template>
			<template #right>
				<UButton
					label="CSV exportieren"
					icon="i-lucide-download"
					color="neutral"
					variant="outline"
					:disabled="!filtered.length"
					@click="exportCsv"
				/>
				<UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
					<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" aria-label="Weitere Aktionen" />
				</UDropdownMenu>
			</template>
		</DashboardFilterBar>

		<UEmpty
			v-if="!loading && !(responses ?? []).length"
			icon="i-lucide-inbox"
			title="Noch keine Antworten"
			:description="
				form.status === 'draft'
					? 'Veröffentliche das Formular, damit Menschen antworten können.'
					: 'Sobald jemand das Formular abschickt, erscheint die Antwort hier.'
			"
		/>

		<template v-else-if="view === 'summary'">
			<FormsResults :fields="form.fields" :responses="filtered" @open="openNumber = $event" />
		</template>

		<DashboardDataTable
			v-else
			:data="filtered"
			:columns="columns"
			:loading="loading"
			:show-refresh="true"
			empty-title="Keine Antworten"
			empty-description="Keine Antwort passt zu diesem Filter."
			empty-icon="i-lucide-inbox"
			@refresh="reload"
			@row-click="openNumber = $event.number"
		>
			<template #number-cell="{ row }">
				<span class="font-medium text-white tabular-nums">#{{ row.original.number }}</span>
			</template>
			<template #created_at-cell="{ row }">
				<span class="flex flex-col text-sm leading-tight">
					{{ formatDate(row.original.created_at) }}
					<span class="text-xs text-slate-500">{{ formatRelative(row.original.created_at) }}</span>
				</span>
			</template>
			<template #actions-cell="{ row }">
				<div class="flex justify-end gap-1">
					<UButton
						icon="i-lucide-eye"
						size="sm"
						color="neutral"
						variant="ghost"
						aria-label="Antwort ansehen"
						@click.stop="openNumber = row.original.number"
					/>
					<UButton
						icon="i-lucide-trash-2"
						size="sm"
						color="error"
						variant="ghost"
						aria-label="Antwort löschen"
						@click.stop="removeOne(row.original)"
					/>
				</div>
			</template>
		</DashboardDataTable>

		<FormsResponseModal v-model="openNumber" :fields="form.fields" :responses="filtered" @delete="removeOne" />

		<DashboardDeleteModal
			v-model:open="deleteAllOpen"
			title="Alle Antworten löschen"
			:warning-text="`Alle ${(responses ?? []).length} Antworten auf „${form.title}“ werden gelöscht. Die Nummerierung beginnt danach wieder bei 1.`"
			:on-delete="removeAll"
		/>
	</div>
</template>
