import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { BUDGET_ITEM_KINDS } from "../../../../../../db/schema";

export namespace EventBudgetModel {
	export const BudgetItem = createSelectSchema(DB.Tables.budgetItems).omit({ org_id: true });
	export type BudgetItem = z.infer<typeof BudgetItem>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		budgetItemId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const BudgetItemFields = {
		kind: z.enum(BUDGET_ITEM_KINDS),
		category: z.string().trim().min(1).max(60),
		description: z.string().max(2_000),
		planned_cents: z.number().int().min(0).max(100_000_000),
	};
}

export namespace EventBudgetModel.Get {
	export const Response = z.object({
		/** Total budget of the event (`events.budget_cents`, edited via `PUT /events/{eventId}`). */
		budget_cents: z.number(),
		items: z.array(EventBudgetModel.BudgetItem),
		planned_expense_cents: z.number(),
		planned_income_cents: z.number(),
		/** Approved + reimbursed expenses. */
		actual_expense_cents: z.number(),
		/** Submitted, not yet reviewed expenses. */
		pending_expense_cents: z.number(),
		by_category: z.array(
			z.object({
				category: z.string(),
				planned_cents: z.number(),
				actual_cents: z.number(),
			}),
		),
		/** `budget_cents - actual_expense_cents`. */
		remaining_cents: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace EventBudgetModel.Create {
	export const Body = z.object({
		kind: EventBudgetModel.BudgetItemFields.kind.default("expense"),
		category: EventBudgetModel.BudgetItemFields.category,
		description: EventBudgetModel.BudgetItemFields.description.default(""),
		planned_cents: EventBudgetModel.BudgetItemFields.planned_cents,
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventBudgetModel.BudgetItem;
	export type Response = z.infer<typeof Response>;
}

export namespace EventBudgetModel.Update {
	export const Body = z
		.object(EventBudgetModel.BudgetItemFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventBudgetModel.BudgetItem;
	export type Response = z.infer<typeof Response>;
}
