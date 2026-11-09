import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { FileService } from "../../../../../utils/fileService";
import { Notifier } from "../../../../../utils/notifications";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventExpensesModel } from "./model";

type ExpensesEnv = {
	Variables: EventRouterEnv["Variables"] & { expense: DB.Models.Expense };
};

export const router = new Hono<ExpensesEnv>().basePath("/:eventId/expenses");

const STATUS_LABELS: Record<DB.Models.Expense["status"], string> = {
	submitted: "eingereicht",
	approved: "genehmigt",
	rejected: "abgelehnt",
	reimbursed: "erstattet",
};

function formatEuro(cents: number) {
	return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function canModify(c: Context<ExpensesEnv>, expense: DB.Models.Expense) {
	if (EventAccess.can(c, "expenses:review")) return true;
	return (
		expense.submitted_by === c.get("eventAccess").userId &&
		expense.status === "submitted" &&
		EventAccess.can(c, "expenses:submit")
	);
}

async function toResponse(
	c: Context<ExpensesEnv>,
	expenses: DB.Models.Expense[],
): Promise<EventExpensesModel.Expense[]> {
	const users = await UserSummary.fetchMap(
		expenses.flatMap((expense) => [expense.submitted_by, expense.reviewed_by]),
	);
	const receiptIds = expenses
		.map((expense) => expense.receipt_file_id)
		.filter((id): id is number => id !== null);
	const receipts = receiptIds.length
		? await DB.instance()
				.select()
				.from(DB.Tables.files)
				.where(inArray(DB.Tables.files.id, receiptIds))
				.all()
		: [];

	return expenses.map((expense) => {
		const receipt = receipts.find((file) => file.id === expense.receipt_file_id);
		const modifiable = canModify(c, expense);
		return {
			...expense,
			submitter: expense.submitted_by ? (users.get(expense.submitted_by) ?? null) : null,
			reviewer: expense.reviewed_by ? (users.get(expense.reviewed_by) ?? null) : null,
			receipt: receipt ? FileService.toResponse(receipt) : null,
			can_edit: modifiable,
			can_delete: modifiable,
		};
	});
}

async function deleteReceipt(fileId: number | null, tx: DrizzleDB = DB.instance()) {
	if (fileId === null) return;
	const file = await FileService.get(fileId, tx);
	if (file) await FileService.deleteRecursive(file, tx);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event expenses",
		description:
			"List expenses of the event: leaders see all, staff only their own. Each entry carries its receipt with a download token.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Expenses retrieved successfully", EventExpensesModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view expenses"),
		),
	}),

	zValidator("query", EventExpensesModel.GetAll.Query),

	async (c) => {
		if (!EventAccess.can(c, "expenses:submit")) {
			return APIResponse.forbidden(c, "You are not allowed to view expenses");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { status } = c.req.valid("query") as EventExpensesModel.GetAll.Query;

		const conditions = [eq(DB.Tables.expenses.event_id, event.id)];
		if (!EventAccess.can(c, "expenses:view_all")) {
			conditions.push(eq(DB.Tables.expenses.submitted_by, userId));
		}
		if (status) {
			conditions.push(eq(DB.Tables.expenses.status, status));
		}

		const expenses = await DB.instance()
			.select()
			.from(DB.Tables.expenses)
			.where(and(...conditions))
			.orderBy(desc(DB.Tables.expenses.spent_on), desc(DB.Tables.expenses.id))
			.all();

		return APIResponse.success(c, "Expenses retrieved successfully", await toResponse(c, expenses));
	},
);

router.get(
	"/summary",

	APIRouteSpec.authenticated({
		summary: "Get expense summary",
		description:
			"Totals by status, by category and by submitter (incl. approved amounts still to be reimbursed). Leaders only.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Expense summary retrieved successfully",
				EventExpensesModel.Summary.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view all expenses"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "expenses:view_all")) {
			return APIResponse.forbidden(c, "You are not allowed to view all expenses");
		}

		const expenses = await DB.instance()
			.select()
			.from(DB.Tables.expenses)
			.where(eq(DB.Tables.expenses.event_id, c.get("event").id))
			.all();

		const totals = { submitted: 0, approved: 0, rejected: 0, reimbursed: 0 };
		const byCategory = new Map<string, { amount_cents: number; count: number }>();
		const bySubmitter = new Map<
			number | null,
			{ amount_cents: number; open_reimbursement_cents: number }
		>();

		for (const expense of expenses) {
			totals[expense.status] += expense.amount_cents;
			if (expense.status === "rejected") continue;

			const category = byCategory.get(expense.category) ?? { amount_cents: 0, count: 0 };
			category.amount_cents += expense.amount_cents;
			category.count += 1;
			byCategory.set(expense.category, category);

			const submitter = bySubmitter.get(expense.submitted_by) ?? {
				amount_cents: 0,
				open_reimbursement_cents: 0,
			};
			submitter.amount_cents += expense.amount_cents;
			if (expense.status === "approved") {
				submitter.open_reimbursement_cents += expense.amount_cents;
			}
			bySubmitter.set(expense.submitted_by, submitter);
		}

		const users = await UserSummary.fetchMap(bySubmitter.keys());

		return APIResponse.success(c, "Expense summary retrieved successfully", {
			totals_by_status: totals,
			by_category: [...byCategory.entries()]
				.map(([category, value]) => ({ category, ...value }))
				.sort((a, b) => b.amount_cents - a.amount_cents),
			by_submitter: [...bySubmitter.entries()]
				.map(([userId, value]) => ({
					user: userId !== null ? (users.get(userId) ?? null) : null,
					...value,
				}))
				.sort((a, b) => b.amount_cents - a.amount_cents),
		} satisfies EventExpensesModel.Summary.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Submit expense",
		description:
			"Submit an expense for the event. Attach the receipt afterwards with `POST …/expenses/{expenseId}/receipt`. The event's leaders are notified.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Expense submitted successfully", EventExpensesModel.Create.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to submit expenses"),
		),
	}),

	zValidator("json", EventExpensesModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "expenses:submit")) {
			return APIResponse.forbidden(c, "You are not allowed to submit expenses");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventExpensesModel.Create.Body;

		const expense = await DB.instance()
			.insert(DB.Tables.expenses)
			.values({ ...body, event_id: event.id, submitted_by: userId })
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "expense",
			entityId: expense.id,
			summary: `Ausgabe „${expense.title}“ über ${formatEuro(expense.amount_cents)} eingereicht`,
		});

		const leaders = await DB.instance()
			.select({ user_id: DB.Tables.eventMembers.user_id })
			.from(DB.Tables.eventMembers)
			.where(
				and(eq(DB.Tables.eventMembers.event_id, event.id), eq(DB.Tables.eventMembers.role, "leader")),
			)
			.all();

		await Notifier.notify(
			leaders.map((leader) => leader.user_id),
			{
				type: "expense_submitted",
				title: `Neue Ausgabe: ${expense.title} (${formatEuro(expense.amount_cents)})`,
				body: event.name,
				link: `/events/${event.id}/finances/all`,
			},
			{ excludeUserId: userId },
		);

		const [result] = await toResponse(c, [expense]);
		return APIResponse.created(c, "Expense submitted successfully", result!);
	},
);

router.use("/:expenseId/*", zValidator("param", EventExpensesModel.Params), async (c, next) => {
	const event = c.get("event");
	const expenseId = EventExpensesModel.Params.shape.expenseId.safeParse(c.req.param("expenseId"));
	if (!expenseId.success) return APIResponse.badRequest(c, "Invalid expense id");

	const expense = await DB.instance()
		.select()
		.from(DB.Tables.expenses)
		.where(and(eq(DB.Tables.expenses.id, expenseId.data), eq(DB.Tables.expenses.event_id, event.id)))
		.get();

	// Staff only ever see their own expenses.
	if (
		!expense ||
		(!EventAccess.can(c, "expenses:view_all") && expense.submitted_by !== c.get("eventAccess").userId)
	) {
		return APIResponse.notFound(c, "Expense not found");
	}

	c.set("expense", expense);
	await next();
});

router.put(
	"/:expenseId",

	APIRouteSpec.authenticated({
		summary: "Update expense",
		description:
			"Update an expense. The submitter can edit it while it is still `submitted`; leaders at any time.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Expense updated successfully", EventExpensesModel.Update.Response),
			APIResponseSpec.notFound("Expense not found"),
			APIResponseSpec.forbidden("You are not allowed to edit this expense"),
		),
	}),

	zValidator("json", EventExpensesModel.Update.Body),

	async (c) => {
		const expense = c.get("expense");
		if (!canModify(c, expense)) {
			return APIResponse.forbidden(c, "You are not allowed to edit this expense");
		}

		const body = c.req.valid("json") as EventExpensesModel.Update.Body;

		const updated = await DB.instance()
			.update(DB.Tables.expenses)
			.set({ ...body, updated_at: Date.now() })
			.where(eq(DB.Tables.expenses.id, expense.id))
			.returning()
			.get();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "update",
			entityType: "expense",
			entityId: expense.id,
			summary: `Ausgabe „${updated.title}“ bearbeitet`,
		});

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Expense updated successfully", result!);
	},
);

router.delete(
	"/:expenseId",

	APIRouteSpec.authenticated({
		summary: "Delete expense",
		description:
			"Delete an expense and its receipt. The submitter can delete it while it is still `submitted`; leaders at any time.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Expense deleted successfully"),
			APIResponseSpec.notFound("Expense not found"),
			APIResponseSpec.forbidden("You are not allowed to delete this expense"),
		),
	}),

	async (c) => {
		const expense = c.get("expense");
		if (!canModify(c, expense)) {
			return APIResponse.forbidden(c, "You are not allowed to delete this expense");
		}

		try {
			await DB.instance().transaction(async (tx: DrizzleDB) => {
				await tx.delete(DB.Tables.expenses).where(eq(DB.Tables.expenses.id, expense.id)).run();
				await deleteReceipt(expense.receipt_file_id, tx);
			});
		} catch (error: any) {
			Logger.error("Failed to delete expense", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to delete expense");
		}

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "expense",
			entityId: expense.id,
			summary: `Ausgabe „${expense.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Expense deleted successfully");
	},
);

router.post(
	"/:expenseId/receipt",

	APIRouteSpec.authenticated({
		summary: "Upload expense receipt",
		description:
			"Attach a receipt (image or PDF, multipart/form-data field `file`) to an expense. Replaces an existing receipt.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Receipt uploaded successfully",
				EventExpensesModel.UploadReceipt.Response,
			),
			APIResponseSpec.badRequest(
				"Only images and PDF files are accepted / File is too large / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Expense not found"),
			APIResponseSpec.forbidden("You are not allowed to edit this expense"),
		),
	}),

	zValidator("form", EventExpensesModel.UploadReceipt.Form, undefined, {
		media: "multipart/form-data",
	}),

	async (c) => {
		const expense = c.get("expense");
		if (!canModify(c, expense)) {
			return APIResponse.forbidden(c, "You are not allowed to edit this expense");
		}

		const { file } = c.req.valid("form") as EventExpensesModel.UploadReceipt.Form;
		if (!FileService.RECEIPT_MIME_TYPES.has(file.type.toLowerCase())) {
			return APIResponse.badRequest(c, "Only images and PDF files are accepted");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");

		const receipt = await FileService.upload(
			{ scope: "receipt", eventId: event.id },
			null,
			file,
			userId,
		);
		if (!receipt) return APIResponse.badRequest(c, "File is too large");

		const updated = await DB.instance()
			.update(DB.Tables.expenses)
			.set({ receipt_file_id: receipt.id, updated_at: Date.now() })
			.where(eq(DB.Tables.expenses.id, expense.id))
			.returning()
			.get();

		await deleteReceipt(expense.receipt_file_id);

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "expense",
			entityId: expense.id,
			summary: `Beleg für Ausgabe „${expense.title}“ hochgeladen`,
		});

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Receipt uploaded successfully", result!);
	},
);

router.post(
	"/:expenseId/review",

	APIRouteSpec.authenticated({
		summary: "Review expense",
		description:
			"Approve, reject or mark an expense as reimbursed. Leaders only; the submitter is notified.",
		tags: [DOCS_TAGS.EVENTS.EXPENSES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Expense reviewed successfully", EventExpensesModel.Review.Response),
			APIResponseSpec.notFound("Expense not found"),
			APIResponseSpec.forbidden("You are not allowed to review expenses"),
		),
	}),

	zValidator("json", EventExpensesModel.Review.Body),

	async (c) => {
		if (!EventAccess.can(c, "expenses:review")) {
			return APIResponse.forbidden(c, "You are not allowed to review expenses");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const expense = c.get("expense");
		const body = c.req.valid("json") as EventExpensesModel.Review.Body;

		const updated = await DB.instance()
			.update(DB.Tables.expenses)
			.set({
				status: body.status,
				review_note: body.note ?? null,
				reviewed_by: userId,
				reviewed_at: Date.now(),
				updated_at: Date.now(),
			})
			.where(eq(DB.Tables.expenses.id, expense.id))
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "review",
			entityType: "expense",
			entityId: expense.id,
			summary: `Ausgabe „${expense.title}“ (${formatEuro(expense.amount_cents)}) ${STATUS_LABELS[body.status]}`,
			metadata: { from: expense.status, to: body.status },
		});

		await Notifier.notify(
			[expense.submitted_by],
			{
				type: "expense_reviewed",
				title: `Ausgabe „${expense.title}“ ${STATUS_LABELS[body.status]}`,
				body: body.note ? `${event.name}: ${body.note}` : event.name,
				link: `/events/${event.id}/finances`,
			},
			{ excludeUserId: userId },
		);

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Expense reviewed successfully", result!);
	},
);
