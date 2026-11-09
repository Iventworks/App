<script setup lang="ts">
/** "Alle Ausgaben": every expense of the event, for the leaders to review and reimburse. */
import type { TableColumn } from "@nuxt/ui";
import type { EventExpense } from "~/composables/useEventFinances";

definePageMeta({ layout: "dashboard" });

const finances = useEventFinances();
const allowed = await finances.requireSection("expenses:view_all");
const {
	can,
	expenses,
	expensesLoading,
	refreshExpenses,
	sumBy,
	isImage,
	rowActions,
	openReview,
	openCreateExpense,
} = finances;

const fileURL = useFileURL();

type ExpenseRow = EventExpense & { submitter_name: string };

const expenseRows = computed<ExpenseRow[]>(() =>
	(expenses.value ?? []).map((expense) => ({
		...expense,
		submitter_name: expense.submitter?.display_name ?? "Unbekannt",
	})),
);

const expenseColumns: TableColumn<ExpenseRow>[] = [
	{ accessorKey: "spent_on", header: "Datum" },
	{ accessorKey: "title", header: "Ausgabe" },
	{ accessorKey: "submitter_name", header: "Person" },
	{ accessorKey: "category", header: "Kategorie" },
	{ accessorKey: "amount_cents", header: "Betrag" },
	{ id: "receipt", header: "Beleg" },
	{ accessorKey: "status", header: "Status" },
	{ id: "actions", header: "" },
];

const tableFilters = computed(() => [
	{
		column: "title" as const,
		type: "text" as const,
		placeholder: "Suchen …",
		class: "w-full sm:w-48",
	},
	{
		column: "status" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		class: "w-full sm:w-36",
		options: EXPENSE_STATUS_OPTIONS,
	},
	{
		column: "category" as const,
		type: "multi-select" as const,
		placeholder: "Alle Kategorien",
		class: "w-full sm:w-40",
		options: [...new Set(expenseRows.value.map((row) => row.category))].map((value) => ({
			label: value,
			value,
		})),
	},
	{
		column: "submitter_name" as const,
		type: "multi-select" as const,
		placeholder: "Alle Personen",
		class: "w-full sm:w-40",
		options: [...new Set(expenseRows.value.map((row) => row.submitter_name))].map((value) => ({
			label: value,
			value,
		})),
	},
]);
</script>

<template>
	<div v-if="allowed" class="space-y-6">
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<DashboardStatCard
				label="Zu prüfen"
				:value="formatCents(sumBy(expenses ?? [], ['submitted']))"
				:hint="`${(expenses ?? []).filter((e) => e.status === 'submitted').length} Ausgaben`"
				icon="i-lucide-hourglass"
				icon-color="amber"
			/>
			<DashboardStatCard
				label="Genehmigt, offen zur Erstattung"
				:value="formatCents(sumBy(expenses ?? [], ['approved']))"
				icon="i-lucide-badge-check"
			/>
			<DashboardStatCard
				label="Erstattet"
				:value="formatCents(sumBy(expenses ?? [], ['reimbursed']))"
				icon="i-lucide-banknote"
				icon-color="emerald"
			/>
			<DashboardStatCard
				label="Abgelehnt"
				:value="formatCents(sumBy(expenses ?? [], ['rejected']))"
				icon="i-lucide-ban"
				icon-color="error"
			/>
		</div>

		<DashboardDataTable
			:data="expenseRows"
			:columns="expenseColumns"
			:loading="expensesLoading"
			:filters="tableFilters"
			empty-title="Keine Ausgaben"
			empty-description="Für dieses Event wurden noch keine Ausgaben eingereicht."
			empty-icon="i-lucide-receipt"
			@refresh="refreshExpenses"
		>
			<template v-if="can('expenses:submit')" #header-right>
				<UButton label="Ausgabe einreichen" icon="i-lucide-plus" @click="openCreateExpense" />
			</template>

			<template #spent_on-cell="{ row }">
				<span class="whitespace-nowrap text-slate-300">{{ formatDay(row.original.spent_on) }}</span>
			</template>
			<template #title-cell="{ row }">
				<div class="min-w-40">
					<p class="font-medium text-white">{{ row.original.title }}</p>
					<p v-if="row.original.description" class="line-clamp-1 text-xs text-slate-500">
						{{ row.original.description }}
					</p>
				</div>
			</template>
			<template #amount_cents-cell="{ row }">
				<span class="font-medium tabular-nums text-white">{{ formatCents(row.original.amount_cents) }}</span>
			</template>
			<template #receipt-cell="{ row }">
				<UButton
					v-if="row.original.receipt"
					:to="fileURL(row.original.receipt.content_url)"
					target="_blank"
					:icon="isImage(row.original) ? 'i-lucide-image' : 'i-lucide-file-text'"
					label="Ansehen"
					color="neutral"
					variant="ghost"
					size="xs"
				/>
				<span v-else class="text-xs text-amber-400">fehlt</span>
			</template>
			<template #status-cell="{ row }">
				<UTooltip :text="row.original.review_note ?? ''" :disabled="!row.original.review_note">
					<UBadge
						:label="EXPENSE_STATUS_LABELS[row.original.status]"
						:color="EXPENSE_STATUS_COLORS[row.original.status]"
						variant="subtle"
						size="sm"
					/>
				</UTooltip>
			</template>
			<template #actions-cell="{ row }">
				<div class="flex justify-end gap-1">
					<UButton
						v-if="can('expenses:review') && row.original.status === 'submitted'"
						label="Prüfen"
						icon="i-lucide-scan-search"
						size="xs"
						variant="subtle"
						@click="openReview(row.original, 'approved')"
					/>
					<UDropdownMenu
						v-if="rowActions(row.original).length"
						:items="rowActions(row.original)"
						:ui="{ viewport: 'main-bg-color' }"
					>
						<UButton
							icon="i-lucide-ellipsis-vertical"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Aktionen"
						/>
					</UDropdownMenu>
				</div>
			</template>
		</DashboardDataTable>
	</div>
</template>
