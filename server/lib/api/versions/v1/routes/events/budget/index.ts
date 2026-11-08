import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventBudgetModel } from "./model";

type BudgetEnv = {
	Variables: EventRouterEnv["Variables"] & { budgetItem: DB.Models.BudgetItem };
};

export const router = new Hono<BudgetEnv>().basePath("/:eventId/budget");

function formatEuro(cents: number) {
	return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get event budget",
		description:
			"The event's budget plan with planned vs. actual amounts per category (actual = approved + reimbursed expenses). Leaders only.",
		tags: [DOCS_TAGS.EVENTS.BUDGET],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Budget retrieved successfully", EventBudgetModel.Get.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view the budget"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "budget:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view the budget");
		}

		const event = c.get("event");

		const items = await DB.instance()
			.select()
			.from(DB.Tables.budgetItems)
			.where(eq(DB.Tables.budgetItems.event_id, event.id))
			.orderBy(asc(DB.Tables.budgetItems.kind), asc(DB.Tables.budgetItems.category))
			.all();

		const expenses = await DB.instance()
			.select({
				category: DB.Tables.expenses.category,
				amount_cents: DB.Tables.expenses.amount_cents,
				status: DB.Tables.expenses.status,
			})
			.from(DB.Tables.expenses)
			.where(eq(DB.Tables.expenses.event_id, event.id))
			.all();

		let plannedExpense = 0;
		let plannedIncome = 0;
		let actualExpense = 0;
		let pendingExpense = 0;
		const byCategory = new Map<string, { planned_cents: number; actual_cents: number }>();
		const categoryEntry = (category: string) => {
			let entry = byCategory.get(category);
			if (!entry) {
				entry = { planned_cents: 0, actual_cents: 0 };
				byCategory.set(category, entry);
			}
			return entry;
		};

		for (const item of items) {
			if (item.kind === "income") {
				plannedIncome += item.planned_cents;
				continue;
			}
			plannedExpense += item.planned_cents;
			categoryEntry(item.category).planned_cents += item.planned_cents;
		}

		for (const expense of expenses) {
			if (expense.status === "approved" || expense.status === "reimbursed") {
				actualExpense += expense.amount_cents;
				categoryEntry(expense.category).actual_cents += expense.amount_cents;
			} else if (expense.status === "submitted") {
				pendingExpense += expense.amount_cents;
			}
		}

		return APIResponse.success(c, "Budget retrieved successfully", {
			budget_cents: event.budget_cents,
			items,
			planned_expense_cents: plannedExpense,
			planned_income_cents: plannedIncome,
			actual_expense_cents: actualExpense,
			pending_expense_cents: pendingExpense,
			by_category: [...byCategory.entries()]
				.map(([category, value]) => ({ category, ...value }))
				.sort((a, b) => a.category.localeCompare(b.category, "de")),
			remaining_cents: event.budget_cents - actualExpense,
		} satisfies EventBudgetModel.Get.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create budget item",
		description: "Add a planned expense or income line to the event's budget.",
		tags: [DOCS_TAGS.EVENTS.BUDGET],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Budget item created successfully", EventBudgetModel.Create.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the budget"),
		),
	}),

	zValidator("json", EventBudgetModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "budget:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the budget");
		}

		const event = c.get("event");
		const body = c.req.valid("json") as EventBudgetModel.Create.Body;

		const item = await DB.instance()
			.insert(DB.Tables.budgetItems)
			.values({ ...body, event_id: event.id })
			.returning()
			.get();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "create",
			entityType: "budget_item",
			entityId: item.id,
			summary: `Budgetposten „${item.category}“ (${item.kind === "income" ? "Einnahme" : "Ausgabe"}, ${formatEuro(item.planned_cents)}) angelegt`,
		});

		return APIResponse.created(c, "Budget item created successfully", item);
	},
);

router.use("/:budgetItemId/*", zValidator("param", EventBudgetModel.Params), async (c, next) => {
	const event = c.get("event");
	const budgetItemId = EventBudgetModel.Params.shape.budgetItemId.safeParse(
		c.req.param("budgetItemId"),
	);
	if (!budgetItemId.success) return APIResponse.badRequest(c, "Invalid budget item id");

	const item = await DB.instance()
		.select()
		.from(DB.Tables.budgetItems)
		.where(
			and(
				eq(DB.Tables.budgetItems.id, budgetItemId.data),
				eq(DB.Tables.budgetItems.event_id, event.id),
			),
		)
		.get();

	if (!item) return APIResponse.notFound(c, "Budget item not found");

	c.set("budgetItem", item);
	await next();
});

router.put(
	"/:budgetItemId",

	APIRouteSpec.authenticated({
		summary: "Update budget item",
		description: "Update a line of the event's budget plan.",
		tags: [DOCS_TAGS.EVENTS.BUDGET],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Budget item updated successfully", EventBudgetModel.Update.Response),
			APIResponseSpec.notFound("Budget item not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the budget"),
		),
	}),

	zValidator("json", EventBudgetModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "budget:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the budget");
		}

		const item = c.get("budgetItem");
		const body = c.req.valid("json") as EventBudgetModel.Update.Body;

		const updated = await DB.instance()
			.update(DB.Tables.budgetItems)
			.set(body)
			.where(eq(DB.Tables.budgetItems.id, item.id))
			.returning()
			.get();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "update",
			entityType: "budget_item",
			entityId: item.id,
			summary: `Budgetposten „${updated.category}“ geändert`,
		});

		return APIResponse.success(c, "Budget item updated successfully", updated);
	},
);

router.delete(
	"/:budgetItemId",

	APIRouteSpec.authenticated({
		summary: "Delete budget item",
		description: "Remove a line from the event's budget plan.",
		tags: [DOCS_TAGS.EVENTS.BUDGET],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Budget item deleted successfully"),
			APIResponseSpec.notFound("Budget item not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the budget"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "budget:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the budget");
		}

		const item = c.get("budgetItem");

		await DB.instance()
			.delete(DB.Tables.budgetItems)
			.where(eq(DB.Tables.budgetItems.id, item.id))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "budget_item",
			entityId: item.id,
			summary: `Budgetposten „${item.category}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Budget item deleted successfully");
	},
);
