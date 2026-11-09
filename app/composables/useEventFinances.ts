/**
 * Shared state of the event finances section (`/events/[event_id]/finances/**`).
 *
 * The parent page (`finances.vue`) loads expenses, budget and summary once with
 * `createEventFinances()` and hands them down with `provideEventFinances()`; `<FinanceDialogs />`
 * renders the dialogs (expense form, review, budget item, deletes). The child pages — "Meine
 * Ausgaben" (index), "Alle Ausgaben" (`/all`), "Budget" (`/budget`), "Auswertung" (`/summary`) —
 * read the data and open the dialogs through `useEventFinances()`.
 */
import type { ComputedRef, InjectionKey } from "vue";
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
import type { EventPermission } from "~/utils/types";

export type EventExpense = GetEventsByEventIdExpensesResponses["200"]["data"][number];
export type EventExpenseStatus = EventExpense["status"];
export type EventBudget = GetEventsByEventIdBudgetResponses["200"]["data"];
export type EventBudgetItem = EventBudget["items"][number];
export type EventExpenseSummary = GetEventsByEventIdExpensesSummaryResponses["200"]["data"];
export type ExpenseReviewStatus = Exclude<EventExpenseStatus, "submitted">;

export const EXPENSE_REVIEW_ACTIONS: { status: ExpenseReviewStatus; label: string; icon: string }[] =
	[
		{ status: "approved", label: "Genehmigen", icon: "i-lucide-check" },
		{ status: "rejected", label: "Ablehnen", icon: "i-lucide-x" },
		{ status: "reimbursed", label: "Als erstattet markieren", icon: "i-lucide-banknote" },
	];

interface FinanceSectionDefinition {
	/** Path below `/events/[event_id]/finances` (`""` = the index route). */
	segment: "" | "/all" | "/budget" | "/summary";
	label: string;
	icon: string;
	permission: EventPermission;
}

/** The sub-routes in toolbar order, each with the permission it needs. */
const FINANCE_SECTIONS: FinanceSectionDefinition[] = [
	{ segment: "", label: "Meine Ausgaben", icon: "i-lucide-receipt", permission: "expenses:submit" },
	{
		segment: "/all",
		label: "Alle Ausgaben",
		icon: "i-lucide-list-checks",
		permission: "expenses:view_all",
	},
	{ segment: "/budget", label: "Budget", icon: "i-lucide-wallet", permission: "budget:view" },
	{
		segment: "/summary",
		label: "Auswertung",
		icon: "i-lucide-chart-column",
		permission: "expenses:view_all",
	},
];

export async function createEventFinances(context: {
	eventId: ComputedRef<number>;
	can: (permission: EventPermission) => boolean;
	userId: () => number | undefined;
}) {
	const { eventId, can } = context;
	const toast = useToast();

	const basePath = computed(() => `/events/${eventId.value}/finances`);

	/** The sections this person may open; the first one is where a forbidden child redirects. */
	const sections = computed(() =>
		FINANCE_SECTIONS.filter((section) => can(section.permission)).map((section) => ({
			...section,
			path: `${basePath.value}${section.segment}`,
		})),
	);

	// --- data ---------------------------------------------------------------------------------

	// Started together (no await in between) so the composable needs no restored setup context.
	const [expensesData, budgetData, summaryData] = await Promise.all([
		useAPIAsyncData(`event-${eventId.value}-expenses`, async () => {
			const result = await useAPI((api) =>
				api.getEventsByEventIdExpenses({ path: { eventId: eventId.value } }),
			);
			if (!result.success) {
				toast.add({
					title: "Ausgaben konnten nicht geladen werden",
					description: result.message,
					color: "error",
				});
				return [] as EventExpense[];
			}
			return result.data;
		}),
		useAPIAsyncData(`event-${eventId.value}-budget`, async () => {
			if (!can("budget:view")) return null;
			const result = await useAPI((api) =>
				api.getEventsByEventIdBudget({ path: { eventId: eventId.value } }),
			);
			return result.success ? result.data : null;
		}),
		useAPIAsyncData(`event-${eventId.value}-expenses-summary`, async () => {
			if (!can("expenses:view_all")) return null;
			const result = await useAPI((api) =>
				api.getEventsByEventIdExpensesSummary({ path: { eventId: eventId.value } }),
			);
			return result.success ? (result.data as EventExpenseSummary) : null;
		}),
	]);

	const { data: expenses, loading: expensesLoading, refresh: refreshExpenses } = expensesData;
	const { data: budget, refresh: refreshBudget } = budgetData;
	const { data: summary, refresh: refreshSummary } = summaryData;

	async function refreshAll() {
		await Promise.all([refreshExpenses(), refreshBudget(), refreshSummary()]);
	}

	const myExpenses = computed(() =>
		(expenses.value ?? []).filter((expense) => expense.submitted_by === context.userId()),
	);

	function sumBy(list: EventExpense[], statuses: EventExpenseStatus[]) {
		return list
			.filter((expense) => statuses.includes(expense.status))
			.reduce((sum, expense) => sum + expense.amount_cents, 0);
	}

	const customCategories = ref<string[]>([]);
	const categoryOptions = computed(() => {
		const used = (expenses.value ?? []).map((expense) => expense.category);
		return [...new Set([...EXPENSE_CATEGORIES, ...used, ...customCategories.value])];
	});

	function isImage(expense: EventExpense) {
		return Boolean(expense.receipt?.mime_type?.startsWith("image/"));
	}

	// --- expense form -------------------------------------------------------------------------

	const expenseSchema = zPostEventsByEventIdExpensesBody.omit({ amount_cents: true }).extend({
		amount: z
			.string()
			.refine((value) => (inputToCents(value) ?? 0) > 0, "Bitte gib einen Betrag größer 0 ein"),
	});

	const expenseFormOpen = ref(false);
	const editingExpense = ref<EventExpense | null>(null);
	const savingExpense = ref(false);
	const expenseForm = reactive({
		title: "",
		amount: "",
		spent_on: toDayString(),
		category: "Sonstiges",
		description: "",
	});
	const receiptFile = ref<File | null>(null);

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

	function openEditExpense(expense: EventExpense) {
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

	// Upload / replace the receipt of an existing expense (`<FinanceDialogs>` renders the input).
	const receiptTarget = ref<EventExpense | null>(null);
	const replaceInput = ref<HTMLInputElement | null>(null);

	function pickReceiptFor(expense: EventExpense) {
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

	function canUploadReceipt(expense: EventExpense) {
		return (
			(expense.submitted_by === context.userId() && expense.status === "submitted") ||
			can("expenses:review")
		);
	}

	// --- delete expense -----------------------------------------------------------------------

	const deleteExpenseTarget = ref<EventExpense | null>(null);
	const deleteExpenseOpen = ref(false);

	function openDeleteExpense(expense: EventExpense) {
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

	// --- review -------------------------------------------------------------------------------

	const reviewOpen = ref(false);
	const reviewTarget = ref<EventExpense | null>(null);
	const reviewing = ref(false);
	const reviewForm = reactive({ status: "approved" as ExpenseReviewStatus, note: "" });

	function openReview(expense: EventExpense, status: ExpenseReviewStatus) {
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

	/** Dropdown items for one expense (review, edit, receipt, delete — as far as allowed). */
	function rowActions(expense: EventExpense) {
		const groups = [];
		if (can("expenses:review")) {
			groups.push(
				EXPENSE_REVIEW_ACTIONS.filter((action) => action.status !== expense.status).map(
					(action) => ({
						label: action.label,
						icon: action.icon,
						onSelect: () => openReview(expense, action.status),
					}),
				),
			);
		}
		const manage = [
			...(expense.can_edit
				? [
						{
							label: "Bearbeiten",
							icon: "i-lucide-pencil",
							onSelect: () => openEditExpense(expense),
						},
					]
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

	// --- budget items -------------------------------------------------------------------------

	const budgetSchema = zPostEventsByEventIdBudgetBody.omit({ planned_cents: true }).extend({
		planned: z
			.string()
			.refine((value) => inputToCents(value) !== null, "Bitte gib einen gültigen Betrag ein"),
	});

	const budgetFormOpen = ref(false);
	const editingBudgetItem = ref<EventBudgetItem | null>(null);
	const savingBudget = ref(false);
	const budgetForm = reactive({
		kind: "expense" as EventBudgetItem["kind"],
		category: "",
		description: "",
		planned: "",
	});

	function openCreateBudgetItem() {
		editingBudgetItem.value = null;
		Object.assign(budgetForm, { kind: "expense", category: "", description: "", planned: "" });
		budgetFormOpen.value = true;
	}

	function openEditBudgetItem(item: EventBudgetItem) {
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

	const deleteBudgetTarget = ref<EventBudgetItem | null>(null);
	const deleteBudgetOpen = ref(false);

	function openDeleteBudgetItem(item: EventBudgetItem) {
		deleteBudgetTarget.value = item;
		deleteBudgetOpen.value = true;
	}

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

	// --- child page guard ---------------------------------------------------------------------

	/**
	 * For child pages: `true` when the person may see the section, otherwise redirect to the first
	 * section they may open (the parent shows "Kein Zugriff" when there is none).
	 */
	async function requireSection(permission: EventPermission) {
		if (can(permission)) return true;
		const fallback = sections.value[0]?.path;
		if (fallback) await navigateTo(fallback, { replace: true });
		return false;
	}

	return {
		eventId,
		can,
		basePath,
		sections,
		requireSection,
		// data
		expenses,
		expensesLoading,
		refreshExpenses,
		budget,
		summary,
		myExpenses,
		sumBy,
		isImage,
		categoryOptions,
		// expenses
		expenseSchema,
		expenseFormOpen,
		editingExpense,
		savingExpense,
		expenseForm,
		receiptFile,
		openCreateExpense,
		openEditExpense,
		onCategoryCreate,
		onReceiptPicked,
		submitExpense,
		replaceInput,
		pickReceiptFor,
		onReplacePicked,
		canUploadReceipt,
		deleteExpenseTarget,
		deleteExpenseOpen,
		openDeleteExpense,
		confirmDeleteExpense,
		// review
		reviewOpen,
		reviewTarget,
		reviewing,
		reviewForm,
		openReview,
		submitReview,
		rowActions,
		// budget
		budgetSchema,
		budgetFormOpen,
		editingBudgetItem,
		savingBudget,
		budgetForm,
		openCreateBudgetItem,
		openEditBudgetItem,
		submitBudgetItem,
		deleteBudgetTarget,
		deleteBudgetOpen,
		openDeleteBudgetItem,
		confirmDeleteBudgetItem,
	};
}

export type EventFinances = Awaited<ReturnType<typeof createEventFinances>>;

const EVENT_FINANCES_KEY: InjectionKey<EventFinances> = Symbol("event-finances");

/** Call in the finances parent page, right after `createEventFinances()`. */
export function provideEventFinances(finances: EventFinances) {
	provide(EVENT_FINANCES_KEY, finances);
}

/** The finances state provided by `/events/[event_id]/finances` (child pages and dialogs). */
export function useEventFinances() {
	const finances = inject(EVENT_FINANCES_KEY);
	if (!finances) {
		throw new Error("useEventFinances() must be used below the event finances page");
	}
	return finances;
}
