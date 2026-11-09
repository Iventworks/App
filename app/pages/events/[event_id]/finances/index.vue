<script setup lang="ts">
/** "Meine Ausgaben": what the signed-in person paid for the event, with receipt and review state. */
import type { EventExpenseStatus } from "~/composables/useEventFinances";

definePageMeta({ layout: "dashboard" });

const finances = useEventFinances();
const allowed = await finances.requireSection("expenses:submit");
const {
	expenses,
	expensesLoading,
	myExpenses,
	sumBy,
	isImage,
	canUploadReceipt,
	pickReceiptFor,
	rowActions,
	openCreateExpense,
} = finances;

const fileURL = useFileURL();

const { value: status, items: statusItems } = useQueryFilter<EventExpenseStatus | "all">(
	"status",
	() => [
		{ value: "all", label: "Alle Status", icon: "i-lucide-list" },
		...EXPENSE_STATUS_OPTIONS.map((option) => ({
			value: option.value,
			label: option.label,
			count: myExpenses.value.filter((expense) => expense.status === option.value).length,
		})),
	],
);

const visibleExpenses = computed(() =>
	status.value === "all"
		? myExpenses.value
		: myExpenses.value.filter((expense) => expense.status === status.value),
);
</script>

<template>
	<div v-if="allowed" class="space-y-6">
		<div class="grid gap-4 sm:grid-cols-3">
			<DashboardStatCard
				label="Eingereicht (in Prüfung)"
				:value="formatCents(sumBy(myExpenses, ['submitted']))"
				icon="i-lucide-hourglass"
				icon-color="amber"
			/>
			<DashboardStatCard
				label="Genehmigt, noch nicht erstattet"
				:value="formatCents(sumBy(myExpenses, ['approved']))"
				icon="i-lucide-badge-check"
				icon-color="primary"
			/>
			<DashboardStatCard
				label="Erstattet"
				:value="formatCents(sumBy(myExpenses, ['reimbursed']))"
				icon="i-lucide-banknote"
				icon-color="emerald"
			/>
		</div>

		<DashboardFilterBar>
			<template #left>
				<USelect v-model="status" :items="statusItems" class="w-full sm:w-52" />
			</template>
			<template #right>
				<UButton label="Ausgabe einreichen" icon="i-lucide-plus" @click="openCreateExpense" />
			</template>
		</DashboardFilterBar>

		<div v-if="expensesLoading && !expenses" class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
		</div>

		<UEmpty
			v-else-if="!myExpenses.length"
			icon="i-lucide-receipt"
			title="Noch keine Ausgaben"
			description="Hast du etwas für das Event bezahlt? Reiche die Ausgabe mit einem Foto vom Beleg ein, damit die Leitung sie erstatten kann."
		/>

		<UEmpty
			v-else-if="!visibleExpenses.length"
			icon="i-lucide-search-x"
			title="Nichts gefunden"
			description="Keine deiner Ausgaben hat diesen Status."
		/>

		<div v-else class="grid gap-3 lg:grid-cols-2">
			<UCard
				v-for="expense in visibleExpenses"
				:key="expense.id"
				class="border-slate-800 bg-slate-900/60"
				:ui="{ body: 'p-4 sm:p-4' }"
			>
				<div class="flex gap-4">
					<a
						v-if="expense.receipt"
						:href="fileURL(expense.receipt.download_token)"
						target="_blank"
						rel="noopener"
						class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-800"
						aria-label="Beleg öffnen"
					>
						<img
							v-if="isImage(expense)"
							:src="fileURL(expense.receipt.download_token)"
							:alt="`Beleg ${expense.title}`"
							class="size-full object-cover"
						/>
						<UIcon v-else name="i-lucide-file-text" class="size-7 text-slate-400" />
					</a>
					<button
						v-else
						type="button"
						:disabled="!canUploadReceipt(expense)"
						class="flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-700 text-xs text-slate-500 enabled:hover:border-primary enabled:hover:text-primary-400"
						@click="pickReceiptFor(expense)"
					>
						<UIcon name="i-lucide-camera" class="size-5" />
						Beleg
					</button>

					<div class="min-w-0 flex-1 space-y-1">
						<div class="flex items-start justify-between gap-2">
							<p class="truncate font-medium text-white">{{ expense.title }}</p>
							<p class="shrink-0 font-semibold tabular-nums text-white">
								{{ formatCents(expense.amount_cents) }}
							</p>
						</div>
						<p class="text-xs text-slate-400">
							{{ formatDay(expense.spent_on) }} · {{ expense.category }}
						</p>
						<div class="flex flex-wrap items-center gap-2 pt-1">
							<UBadge
								:label="EXPENSE_STATUS_LABELS[expense.status]"
								:color="EXPENSE_STATUS_COLORS[expense.status]"
								variant="subtle"
								size="sm"
							/>
							<span v-if="expense.reviewer && expense.reviewed_at" class="text-xs text-slate-500">
								von {{ expense.reviewer.display_name }} · {{ formatRelative(expense.reviewed_at) }}
							</span>
						</div>
						<p
							v-if="expense.review_note"
							class="mt-2 rounded-md bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
						>
							<UIcon name="i-lucide-message-square" class="mr-1 size-3.5 align-[-2px] text-slate-500" />
							{{ expense.review_note }}
						</p>
					</div>

					<UDropdownMenu
						v-if="rowActions(expense).length"
						:items="rowActions(expense)"
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
			</UCard>
		</div>
	</div>
</template>
