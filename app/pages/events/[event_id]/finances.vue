<script setup lang="ts">
/**
 * Event finances: staff submit expenses with receipts ("Meine Ausgaben"); leaders review every
 * expense ("Alle Ausgaben"), plan the budget ("Budget") and see the breakdown ("Auswertung").
 */
import type { TableColumn } from "@nuxt/ui";
import * as z from "zod";
import type {
	GetEventsByEventIdBudgetResponses,
	GetEventsByEventIdExpensesResponses,
	GetEventsByEventIdExpensesSummaryResponses,
} from "~/api-client";
import {
	zPostEventsByEventIdBudgetBody,
	zPostEventsByEventIdExpensesBody,
} from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Expense = GetEventsByEventIdExpensesResponses["200"]["data"][number];
type ExpenseStatus = Expense["status"];
type Budget = GetEventsByEventIdBudgetResponses["200"]["data"];
type BudgetItem = Budget["items"][number];
type Summary = GetEventsByEventIdExpensesSummaryResponses["200"]["data"];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const fileURL = useFileURL();
const route = useRoute();
const router = useRouter();
const userInfo = await useUserInfoStore().use();

useSeoMeta({ title: `Finanzen | ${event.value.name} | CMP` });

// --- tabs -----------------------------------------------------------------------------------

const tabs = computed(() => [
	...(can("expenses:submit")
		? [{ label: "Meine Ausgaben", value: "mine", icon: "i-lucide-receipt" }]
		: []),
	...(can("expenses:view_all")
		? [{ label: "Alle Ausgaben", value: "all", icon: "i-lucide-list-checks" }]
		: []),
	...(can("budget:view") ? [{ label: "Budget", value: "budget", icon: "i-lucide-wallet" }] : []),
	...(can("expenses:view_all")
		? [{ label: "Auswertung", value: "summary", icon: "i-lucide-chart-column" }]
		: []),
]);

const tab = computed<string>({
	get: () => {
		const requested = route.query.tab?.toString();
		return tabs.value.some((t) => t.value === requested)
			? requested!
			: (tabs.value[0]?.value ?? "mine");
	},
	set: (value) => {
		void router.replace({ query: { ...route.query, tab: value } });
	},
});

// --- data -----------------------------------------------------------------------------------

const {
	data: expenses,
	loading: expensesLoading,
	refresh: refreshExpenses,
} = await useAPIAsyncData(`event-${eventId.value}-expenses`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdExpenses({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Ausgaben konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Expense[];
	}
	return result.data;
});

const { data: budget, refresh: refreshBudget } = await useAPIAsyncData(
	`event-${eventId.value}-budget`,
	async () => {
		if (!can("budget:view")) return null;
		const result = await useAPI((api) =>
			api.getEventsByEventIdBudget({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : null;
	},
);

const { data: summary, refresh: refreshSummary } = await useAPIAsyncData(
	`event-${eventId.value}-expenses-summary`,
	async () => {
		if (!can("expenses:view_all")) return null;
		const result = await useAPI((api) =>
			api.getEventsByEventIdExpensesSummary({ path: { eventId: eventId.value } }),
		);
		return result.success ? (result.data as Summary) : null;
	},
);

async function refreshAll() {
	await Promise.all([refreshExpenses(), refreshBudget(), refreshSummary()]);
}

const myExpenses = computed(() =>
	(expenses.value ?? []).filter((expense) => expense.submitted_by === userInfo.value?.id),
);

function sumBy(list: Expense[], statuses: ExpenseStatus[]) {
	return list
		.filter((expense) => statuses.includes(expense.status))
		.reduce((sum, expense) => sum + expense.amount_cents, 0);
}

const customCategories = ref<string[]>([]);
const categoryOptions = computed(() => {
	const used = (expenses.value ?? []).map((expense) => expense.category);
	return [...new Set([...EXPENSE_CATEGORIES, ...used, ...customCategories.value])];
});

function isImage(expense: Expense) {
	return Boolean(expense.receipt?.mime_type?.startsWith("image/"));
}

// --- "Alle Ausgaben" table ----------------------------------------------------------------

type ExpenseRow = Expense & { submitter_name: string };

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
	{ column: "title" as const, type: "text" as const, placeholder: "Suchen …" },
	{
		column: "status" as const,
		type: "select" as const,
		placeholder: "Alle Status",
		options: EXPENSE_STATUS_OPTIONS,
	},
	{
		column: "category" as const,
		type: "select" as const,
		placeholder: "Alle Kategorien",
		options: [...new Set(expenseRows.value.map((row) => row.category))].map((value) => ({
			label: value,
			value,
		})),
	},
	{
		column: "submitter_name" as const,
		type: "select" as const,
		placeholder: "Alle Personen",
		options: [...new Set(expenseRows.value.map((row) => row.submitter_name))].map((value) => ({
			label: value,
			value,
		})),
	},
]);

// --- expense form ---------------------------------------------------------------------------

const expenseSchema = zPostEventsByEventIdExpensesBody.omit({ amount_cents: true }).extend({
	amount: z
		.string()
		.refine((value) => (inputToCents(value) ?? 0) > 0, "Bitte gib einen Betrag größer 0 ein"),
});

const expenseFormOpen = ref(false);
const editingExpense = ref<Expense | null>(null);
const savingExpense = ref(false);
const expenseForm = reactive({
	title: "",
	amount: "",
	spent_on: toDayString(),
	category: "Sonstiges",
	description: "",
});
const receiptFile = ref<File | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

function openCreateExpense() {
	editingExpense.value = null;
	Object.assign(expenseForm, {
		title: "",
		amount: "",
		spent_on: toDayString(),
		category: "Sonstiges",
		description: "",
	});
	receiptFile.value = null;
	expenseFormOpen.value = true;
}

function openEditExpense(expense: Expense) {
	editingExpense.value = expense;
	Object.assign(expenseForm, {
		title: expense.title,
		amount: centsToInput(expense.amount_cents),
		spent_on: expense.spent_on,
		category: expense.category,
		description: expense.description,
	});
	receiptFile.value = null;
	expenseFormOpen.value = true;
}

function onCategoryCreate(item: string) {
	const value = item.trim();
	if (!value) return;
	customCategories.value.push(value);
	expenseForm.category = value;
}

function onReceiptPicked(event: Event) {
	const input = event.target as HTMLInputElement;
	receiptFile.value = input.files?.[0] ?? null;
	input.value = "";
}

async function uploadReceipt(expenseId: number, file: File) {
	const result = await useAPI((api) =>
		api.postEventsByEventIdExpensesByExpenseIdReceipt({
			path: { eventId: eventId.value, expenseId },
			body: { file },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Beleg konnte nicht hochgeladen werden",
			description: result.message,
			color: "error",
		});
	}
	return result.success;
}

async function submitExpense() {
	const amountCents = inputToCents(expenseForm.amount);
	if (!amountCents) return;
	savingExpense.value = true;

	const body = {
		title: expenseForm.title,
		amount_cents: amountCents,
		spent_on: expenseForm.spent_on,
		category: expenseForm.category || "Sonstiges",
		description: expenseForm.description,
	};

	const target = editingExpense.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdExpensesByExpenseId({
					path: { eventId: eventId.value, expenseId: target.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdExpenses({ path: { eventId: eventId.value }, body }),
			);

	if (!result.success) {
		savingExpense.value = false;
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	let receiptOk = true;
	if (receiptFile.value) {
		receiptOk = await uploadReceipt(result.data.id, receiptFile.value);
	}
	savingExpense.value = false;

	toast.add({
		title: target ? "Ausgabe gespeichert" : "Ausgabe eingereicht",
		description: receiptOk
			? target
				? undefined
				: "Die Leitung wurde benachrichtigt."
			: "Die Ausgabe ist gespeichert, aber der Beleg fehlt noch.",
		color: receiptOk ? "success" : "warning",
		icon: "i-lucide-check",
	});
	expenseFormOpen.value = false;
	await refreshAll();
}

// Upload / replace the receipt of an existing expense.
const receiptTarget = ref<Expense | null>(null);
const replaceInput = ref<HTMLInputElement | null>(null);

function pickReceiptFor(expense: Expense) {
	receiptTarget.value = expense;
	replaceInput.value?.click();
}

async function onReplacePicked(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	const target = receiptTarget.value;
	if (!file || !target) return;
	if (await uploadReceipt(target.id, file)) {
		toast.add({ title: "Beleg hochgeladen", color: "success", icon: "i-lucide-check" });
		await refreshExpenses();
	}
}

function canUploadReceipt(expense: Expense) {
	return (
		(expense.submitted_by === userInfo.value?.id && expense.status === "submitted") ||
		can("expenses:review")
	);
}

// --- delete expense -------------------------------------------------------------------------

const deleteExpenseTarget = ref<Expense | null>(null);
const deleteExpenseOpen = ref(false);

function openDeleteExpense(expense: Expense) {
	deleteExpenseTarget.value = expense;
	deleteExpenseOpen.value = true;
}

async function confirmDeleteExpense() {
	const target = deleteExpenseTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdExpensesByExpenseId({
			path: { eventId: eventId.value, expenseId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Ausgabe gelöscht", color: "success" });
	await refreshAll();
}

// --- review ---------------------------------------------------------------------------------

type ReviewStatus = Exclude<ExpenseStatus, "submitted">;

const REVIEW_ACTIONS: { status: ReviewStatus; label: string; icon: string }[] = [
	{ status: "approved", label: "Genehmigen", icon: "i-lucide-check" },
	{ status: "rejected", label: "Ablehnen", icon: "i-lucide-x" },
	{ status: "reimbursed", label: "Als erstattet markieren", icon: "i-lucide-banknote" },
];

const reviewOpen = ref(false);
const reviewTarget = ref<Expense | null>(null);
const reviewing = ref(false);
const reviewForm = reactive({ status: "approved" as ReviewStatus, note: "" });

function openReview(expense: Expense, status: ReviewStatus) {
	reviewTarget.value = expense;
	reviewForm.status = status;
	reviewForm.note = expense.review_note ?? "";
	reviewOpen.value = true;
}

async function submitReview() {
	const target = reviewTarget.value;
	if (!target) return;
	reviewing.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdExpensesByExpenseIdReview({
			path: { eventId: eventId.value, expenseId: target.id },
			body: { status: reviewForm.status, note: reviewForm.note.trim() || null },
		}),
	);
	reviewing.value = false;
	if (!result.success) {
		toast.add({ title: "Prüfung fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: `Ausgabe: ${EXPENSE_STATUS_LABELS[reviewForm.status]}`,
		description: `${target.submitter?.display_name ?? "Die Person"} wurde benachrichtigt.`,
		color: "success",
		icon: "i-lucide-check",
	});
	reviewOpen.value = false;
	await refreshAll();
}

function rowActions(expense: Expense) {
	const groups = [];
	if (can("expenses:review")) {
		groups.push(
			REVIEW_ACTIONS.filter((action) => action.status !== expense.status).map((action) => ({
				label: action.label,
				icon: action.icon,
				onSelect: () => openReview(expense, action.status),
			})),
		);
	}
	const manage = [
		...(expense.can_edit
			? [{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEditExpense(expense) }]
			: []),
		...(canUploadReceipt(expense)
			? [
					{
						label: expense.receipt ? "Beleg ersetzen" : "Beleg hochladen",
						icon: "i-lucide-upload",
						onSelect: () => pickReceiptFor(expense),
					},
				]
			: []),
	];
	if (manage.length) groups.push(manage);
	if (expense.can_delete) {
		groups.push([
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => openDeleteExpense(expense),
			},
		]);
	}
	return groups;
}

// --- budget items ---------------------------------------------------------------------------

const budgetSchema = zPostEventsByEventIdBudgetBody.omit({ planned_cents: true }).extend({
	planned: z
		.string()
		.refine((value) => inputToCents(value) !== null, "Bitte gib einen gültigen Betrag ein"),
});

const budgetFormOpen = ref(false);
const editingBudgetItem = ref<BudgetItem | null>(null);
const savingBudget = ref(false);
const budgetForm = reactive({
	kind: "expense" as BudgetItem["kind"],
	category: "",
	description: "",
	planned: "",
});

function openCreateBudgetItem() {
	editingBudgetItem.value = null;
	Object.assign(budgetForm, { kind: "expense", category: "", description: "", planned: "" });
	budgetFormOpen.value = true;
}

function openEditBudgetItem(item: BudgetItem) {
	editingBudgetItem.value = item;
	Object.assign(budgetForm, {
		kind: item.kind,
		category: item.category,
		description: item.description,
		planned: centsToInput(item.planned_cents),
	});
	budgetFormOpen.value = true;
}

async function submitBudgetItem() {
	const plannedCents = inputToCents(budgetForm.planned);
	if (plannedCents === null) return;
	savingBudget.value = true;
	const body = {
		kind: budgetForm.kind,
		category: budgetForm.category,
		description: budgetForm.description,
		planned_cents: plannedCents,
	};
	const target = editingBudgetItem.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdBudgetByBudgetItemId({
					path: { eventId: eventId.value, budgetItemId: target.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdBudget({ path: { eventId: eventId.value }, body }),
			);
	savingBudget.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Budgetposten gespeichert", color: "success", icon: "i-lucide-check" });
	budgetFormOpen.value = false;
	await refreshBudget();
}

const deleteBudgetTarget = ref<BudgetItem | null>(null);
const deleteBudgetOpen = ref(false);

async function confirmDeleteBudgetItem() {
	const target = deleteBudgetTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdBudgetByBudgetItemId({
			path: { eventId: eventId.value, budgetItemId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Budgetposten gelöscht", color: "success" });
	await refreshBudget();
}

const plannedActualRows = computed(() =>
	(budget.value?.by_category ?? []).map((row) => ({
		label: row.category,
		planned: row.planned_cents,
		actual: row.actual_cents,
	})),
);

const budgetItemsByKind = computed(() => ({
	expense: (budget.value?.items ?? []).filter((item) => item.kind === "expense"),
	income: (budget.value?.items ?? []).filter((item) => item.kind === "income"),
}));

const BUDGET_KIND_OPTIONS = [
	{ label: "Ausgabe", value: "expense" },
	{ label: "Einnahme", value: "income" },
];
</script>

<template>
	<UDashboardPanel id="event-finances">
		<template #header>
			<DashboardPageHeader title="Finanzen" icon="i-lucide-receipt-euro" :description="event.name">
				<template #right>
					<UButton
						v-if="can('expenses:submit') && (tab === 'mine' || tab === 'all')"
						label="Ausgabe einreichen"
						icon="i-lucide-plus"
						@click="openCreateExpense"
					/>
					<UButton
						v-if="tab === 'budget' && can('budget:manage')"
						label="Budgetposten"
						icon="i-lucide-plus"
						@click="openCreateBudgetItem"
					/>
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar v-if="tabs.length > 1">
				<UTabs v-model="tab" :items="tabs" :content="false" size="sm" variant="link" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<UEmpty
					v-if="!tabs.length"
					icon="i-lucide-lock"
					title="Kein Zugriff"
					description="Du hast in diesem Event keinen Zugriff auf die Finanzen."
				/>

				<!-- ===================== Meine Ausgaben ===================== -->
				<template v-else-if="tab === 'mine'">
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

					<div v-if="expensesLoading && !expenses" class="flex justify-center py-12">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
					</div>

					<UEmpty
						v-else-if="!myExpenses.length"
						icon="i-lucide-receipt"
						title="Noch keine Ausgaben"
						description="Hast du etwas für das Event bezahlt? Reiche die Ausgabe mit einem Foto vom Beleg ein, damit die Leitung sie erstatten kann."
					>
						<template v-if="can('expenses:submit')" #actions>
							<UButton label="Ausgabe einreichen" icon="i-lucide-plus" @click="openCreateExpense" />
						</template>
					</UEmpty>

					<div v-else class="grid gap-3 lg:grid-cols-2">
						<UCard
							v-for="expense in myExpenses"
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
				</template>

				<!-- ===================== Alle Ausgaben ===================== -->
				<template v-else-if="tab === 'all'">
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
								:to="fileURL(row.original.receipt.download_token)"
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
							<UTooltip
								:text="row.original.review_note ?? ''"
								:disabled="!row.original.review_note"
							>
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
				</template>

				<!-- ===================== Budget ===================== -->
				<template v-else-if="tab === 'budget'">
					<template v-if="budget">
						<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<DashboardStatCard
								label="Gesamtbudget"
								:value="formatCents(budget.budget_cents)"
								icon="i-lucide-wallet"
							/>
							<DashboardStatCard
								label="Ausgegeben"
								:value="formatCents(budget.actual_expense_cents)"
								hint="genehmigt + erstattet"
								icon="i-lucide-shopping-cart"
								icon-color="amber"
							/>
							<DashboardStatCard
								label="Eingereicht, ungeprüft"
								:value="formatCents(budget.pending_expense_cents)"
								icon="i-lucide-hourglass"
								icon-color="neutral"
							/>
							<DashboardStatCard
								label="Verbleibend"
								:value="formatCents(budget.remaining_cents)"
								:icon="budget.remaining_cents < 0 ? 'i-lucide-triangle-alert' : 'i-lucide-piggy-bank'"
								:icon-color="budget.remaining_cents < 0 ? 'error' : 'emerald'"
							/>
						</div>

						<UAlert
							v-if="budget.budget_cents === 0"
							icon="i-lucide-info"
							color="neutral"
							variant="subtle"
							title="Noch kein Gesamtbudget festgelegt"
							:description="
								can('event:edit')
									? 'Das Gesamtbudget legst du in den Event-Einstellungen fest.'
									: 'Das Gesamtbudget legt die Leitung in den Event-Einstellungen fest.'
							"
							:actions="
								can('event:edit')
									? [{ label: 'Zu den Einstellungen', to: `/events/${eventId}/settings`, color: 'neutral', variant: 'outline' }]
									: []
							"
						/>

						<div class="grid gap-6 lg:grid-cols-2">
							<DashboardSectionCard
								title="Plan vs. Ausgaben"
								description="Je Kategorie: geplante Ausgaben und tatsächlich genehmigte Kosten"
								icon="i-lucide-chart-bar-big"
							>
								<FinancePlannedActualList :rows="plannedActualRows" />
							</DashboardSectionCard>

							<DashboardSectionCard
								title="Planung"
								:description="`Ausgaben ${formatCents(budget.planned_expense_cents)} · Einnahmen ${formatCents(budget.planned_income_cents)}`"
								icon="i-lucide-clipboard-list"
								flush
							>
								<template v-if="can('budget:manage')" #actions>
									<UButton
										label="Posten"
										icon="i-lucide-plus"
										size="sm"
										variant="subtle"
										@click="openCreateBudgetItem"
									/>
								</template>

								<p v-if="!budget.items.length" class="p-6 text-sm text-slate-500">
									Noch keine Budgetposten geplant.
								</p>
								<div v-else class="divide-y divide-slate-800">
									<template v-for="kind in (['expense', 'income'] as const)" :key="kind">
										<div v-if="budgetItemsByKind[kind].length" class="px-6 py-3">
											<p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
												{{ kind === "expense" ? "Geplante Ausgaben" : "Geplante Einnahmen" }}
											</p>
											<ul class="space-y-1">
												<li
													v-for="item in budgetItemsByKind[kind]"
													:key="item.id"
													class="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-800/40"
												>
													<div class="min-w-0 flex-1">
														<p class="text-sm text-white">{{ item.category }}</p>
														<p v-if="item.description" class="truncate text-xs text-slate-500">
															{{ item.description }}
														</p>
													</div>
													<span
														:class="[
															'text-sm font-medium tabular-nums',
															kind === 'income' ? 'text-emerald-400' : 'text-white',
														]"
													>
														{{ kind === "income" ? "+" : "" }}{{ formatCents(item.planned_cents) }}
													</span>
													<div v-if="can('budget:manage')" class="flex gap-1">
														<UButton
															icon="i-lucide-pencil"
															color="neutral"
															variant="ghost"
															size="xs"
															aria-label="Bearbeiten"
															@click="openEditBudgetItem(item)"
														/>
														<UButton
															icon="i-lucide-trash-2"
															color="error"
															variant="ghost"
															size="xs"
															aria-label="Löschen"
															@click="
																deleteBudgetTarget = item;
																deleteBudgetOpen = true;
															"
														/>
													</div>
												</li>
											</ul>
										</div>
									</template>
								</div>
							</DashboardSectionCard>
						</div>
					</template>
					<div v-else class="flex justify-center py-12">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
					</div>
				</template>

				<!-- ===================== Auswertung ===================== -->
				<template v-else-if="tab === 'summary'">
					<template v-if="summary">
						<div class="grid gap-6 lg:grid-cols-2">
							<DashboardSectionCard title="Nach Status" icon="i-lucide-list-checks">
								<FinanceBarList
									:items="
										(['submitted', 'approved', 'reimbursed', 'rejected'] as const).map((status) => ({
											label: EXPENSE_STATUS_LABELS[status],
											value: summary!.totals_by_status[status],
											tone:
												status === 'rejected'
													? 'error'
													: status === 'reimbursed'
														? 'emerald'
														: status === 'submitted'
															? 'amber'
															: 'primary',
										}))
									"
									:format="formatCents"
								/>
							</DashboardSectionCard>

							<DashboardSectionCard title="Nach Kategorie" icon="i-lucide-tags">
								<FinanceBarList
									:items="
										summary.by_category.map((row) => ({
											label: row.category,
											value: row.amount_cents,
											hint: `${row.count}×`,
										}))
									"
									:format="formatCents"
								/>
							</DashboardSectionCard>
						</div>

						<DashboardSectionCard
							title="Nach Person"
							description="Offene Erstattungen = genehmigt, aber noch nicht ausgezahlt"
							icon="i-lucide-users"
							flush
						>
							<p v-if="!summary.by_submitter.length" class="p-6 text-sm text-slate-500">
								Noch keine Ausgaben.
							</p>
							<ul v-else class="divide-y divide-slate-800">
								<li
									v-for="(row, index) in summary.by_submitter"
									:key="row.user?.id ?? `unknown-${index}`"
									class="flex items-center gap-3 px-6 py-3"
								>
									<UAvatar :text="initials(row.user?.display_name)" size="sm" />
									<p class="min-w-0 flex-1 truncate text-sm text-white">
										{{ row.user?.display_name ?? "Gelöschtes Konto" }}
									</p>
									<div class="text-right text-sm">
										<p class="font-medium tabular-nums text-white">{{ formatCents(row.amount_cents) }}</p>
										<p
											:class="[
												'text-xs tabular-nums',
												row.open_reimbursement_cents > 0 ? 'text-amber-400' : 'text-slate-500',
											]"
										>
											offen: {{ formatCents(row.open_reimbursement_cents) }}
										</p>
									</div>
								</li>
							</ul>
						</DashboardSectionCard>
					</template>
					<div v-else class="flex justify-center py-12">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<input
		ref="replaceInput"
		type="file"
		accept="image/*,application/pdf"
		class="hidden"
		@change="onReplacePicked"
	/>

	<!-- Expense form -->
	<DashboardModal
		v-model:open="expenseFormOpen"
		:title="editingExpense ? 'Ausgabe bearbeiten' : 'Ausgabe einreichen'"
		:icon="editingExpense ? 'i-lucide-pencil' : 'i-lucide-receipt'"
	>
		<UForm :schema="expenseSchema" :state="expenseForm" class="space-y-4" @submit="submitExpense">
			<UFormField label="Wofür?" name="title" required>
				<UInput v-model="expenseForm.title" placeholder="z. B. Einkauf Grillabend" class="w-full" autofocus />
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Betrag" name="amount" required>
					<UInput v-model="expenseForm.amount" inputmode="decimal" placeholder="0,00" class="w-full">
						<template #trailing><span class="text-sm text-slate-400">€</span></template>
					</UInput>
				</UFormField>
				<UFormField label="Datum" name="spent_on" required>
					<UInput v-model="expenseForm.spent_on" type="date" class="w-full" />
				</UFormField>
			</div>

			<UFormField label="Kategorie" name="category" description="Wähle eine Kategorie oder tippe eine neue ein.">
				<USelectMenu
					v-model="expenseForm.category"
					:items="categoryOptions"
					create-item
					class="w-full"
					@create="onCategoryCreate"
				/>
			</UFormField>

			<UFormField label="Notiz" name="description">
				<UTextarea
					v-model="expenseForm.description"
					:rows="2"
					autoresize
					placeholder="Optional: Details, Zahlungsweg, IBAN-Hinweis …"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				v-if="!editingExpense || canUploadReceipt(editingExpense)"
				label="Beleg"
				:description="
					editingExpense?.receipt
						? 'Ein Beleg ist vorhanden. Ein neuer Beleg ersetzt ihn.'
						: 'Foto oder PDF des Kassenbons (optional, aber nötig für die Erstattung).'
				"
			>
				<div class="flex flex-wrap items-center gap-2">
					<UButton
						label="Foto aufnehmen"
						icon="i-lucide-camera"
						color="neutral"
						variant="subtle"
						class="sm:hidden"
						@click="cameraInput?.click()"
					/>
					<UButton
						label="Datei wählen"
						icon="i-lucide-paperclip"
						color="neutral"
						variant="subtle"
						@click="fileInput?.click()"
					/>
					<span v-if="receiptFile" class="flex min-w-0 items-center gap-1 text-sm text-slate-300">
						<UIcon name="i-lucide-file-check" class="size-4 text-emerald-400" />
						<span class="truncate">{{ receiptFile.name }}</span>
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Beleg entfernen"
							@click="receiptFile = null"
						/>
					</span>
				</div>
				<input
					ref="cameraInput"
					type="file"
					accept="image/*"
					capture="environment"
					class="hidden"
					@change="onReceiptPicked"
				/>
				<input
					ref="fileInput"
					type="file"
					accept="image/*,application/pdf"
					class="hidden"
					@change="onReceiptPicked"
				/>
			</UFormField>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="expenseFormOpen = false" />
				<UButton type="submit" :label="editingExpense ? 'Speichern' : 'Einreichen'" :loading="savingExpense" />
			</div>
		</UForm>
	</DashboardModal>

	<!-- Review -->
	<DashboardModal v-model:open="reviewOpen" title="Ausgabe prüfen" icon="i-lucide-scan-search">
		<div v-if="reviewTarget" class="space-y-4">
			<div class="flex gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
				<a
					v-if="reviewTarget.receipt"
					:href="fileURL(reviewTarget.receipt.download_token)"
					target="_blank"
					rel="noopener"
					class="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-800"
				>
					<img
						v-if="isImage(reviewTarget)"
						:src="fileURL(reviewTarget.receipt.download_token)"
						alt="Beleg"
						class="size-full object-cover"
					/>
					<UIcon v-else name="i-lucide-file-text" class="size-8 text-slate-400" />
				</a>
				<div class="min-w-0 flex-1 text-sm">
					<p class="font-medium text-white">{{ reviewTarget.title }}</p>
					<p class="text-slate-400">
						{{ reviewTarget.submitter?.display_name ?? "Unbekannt" }} · {{ formatDay(reviewTarget.spent_on) }} ·
						{{ reviewTarget.category }}
					</p>
					<p class="mt-1 text-lg font-semibold tabular-nums text-white">
						{{ formatCents(reviewTarget.amount_cents) }}
					</p>
					<p v-if="reviewTarget.description" class="mt-1 text-slate-400">{{ reviewTarget.description }}</p>
					<p v-if="!reviewTarget.receipt" class="mt-1 text-amber-400">Es wurde kein Beleg hochgeladen.</p>
				</div>
			</div>

			<UFormField label="Entscheidung">
				<div class="grid gap-2 sm:grid-cols-3">
					<UButton
						v-for="action in REVIEW_ACTIONS"
						:key="action.status"
						:label="EXPENSE_STATUS_LABELS[action.status]"
						:icon="action.icon"
						:color="reviewForm.status === action.status ? EXPENSE_STATUS_COLORS[action.status] : 'neutral'"
						:variant="reviewForm.status === action.status ? 'solid' : 'outline'"
						block
						@click="reviewForm.status = action.status"
					/>
				</div>
			</UFormField>

			<UFormField
				label="Notiz an die Person"
				:description="reviewForm.status === 'rejected' ? 'Bitte begründe die Ablehnung.' : 'Optional'"
			>
				<UTextarea v-model="reviewForm.note" :rows="2" autoresize class="w-full" />
			</UFormField>

			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="reviewOpen = false" />
				<UButton label="Speichern" icon="i-lucide-check" :loading="reviewing" @click="submitReview" />
			</div>
		</div>
	</DashboardModal>

	<!-- Budget item form -->
	<DashboardModal
		v-model:open="budgetFormOpen"
		:title="editingBudgetItem ? 'Budgetposten bearbeiten' : 'Neuer Budgetposten'"
		icon="i-lucide-wallet"
	>
		<UForm :schema="budgetSchema" :state="budgetForm" class="space-y-4" @submit="submitBudgetItem">
			<UFormField label="Art" name="kind">
				<USelect v-model="budgetForm.kind" :items="BUDGET_KIND_OPTIONS" class="w-full" />
			</UFormField>
			<UFormField label="Kategorie" name="category" required>
				<UInput
					v-model="budgetForm.category"
					:placeholder="budgetForm.kind === 'income' ? 'z. B. Teilnahmebeiträge' : 'z. B. Lebensmittel'"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Geplanter Betrag" name="planned" required>
				<UInput v-model="budgetForm.planned" inputmode="decimal" placeholder="0,00" class="w-full">
					<template #trailing><span class="text-sm text-slate-400">€</span></template>
				</UInput>
			</UFormField>
			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="budgetForm.description" :rows="2" autoresize class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="budgetFormOpen = false" />
				<UButton type="submit" :label="editingBudgetItem ? 'Speichern' : 'Anlegen'" :loading="savingBudget" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteExpenseOpen"
		title="Ausgabe löschen"
		:warning-text="`Die Ausgabe „${deleteExpenseTarget?.title}“ und ihr Beleg werden gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDeleteExpense"
	/>

	<DashboardDeleteModal
		v-model:open="deleteBudgetOpen"
		title="Budgetposten löschen"
		:warning-text="`Der Posten „${deleteBudgetTarget?.category}“ wird gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDeleteBudgetItem"
	/>
</template>
