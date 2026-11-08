import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { EXPENSE_STATUSES } from "../../../../../../db/schema";
import { FileService } from "../../../../../utils/fileService";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventExpensesModel {
	export const Status = z.enum(EXPENSE_STATUSES);
	export type Status = z.infer<typeof Status>;

	export const Expense = createSelectSchema(DB.Tables.expenses).extend({
		submitter: UserSummary.Schema.nullable(),
		reviewer: UserSummary.Schema.nullable(),
		receipt: FileService.ItemSchema.nullable(),
		/** Owner while still `submitted`, or a leader. */
		can_edit: z.boolean(),
		can_delete: z.boolean(),
	});
	export type Expense = z.infer<typeof Expense>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		expenseId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const ExpenseFields = {
		title: z.string().trim().min(1).max(200),
		description: z.string().max(5_000),
		category: z.string().trim().min(1).max(60),
		amount_cents: z.number().int().positive().max(100_000_000),
		spent_on: z.iso.date("Expected a date in the format YYYY-MM-DD"),
	};
}

export namespace EventExpensesModel.GetAll {
	export const Query = z.object({
		status: EventExpensesModel.Status.optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(EventExpensesModel.Expense);
	export type Response = z.infer<typeof Response>;
}

export namespace EventExpensesModel.Create {
	export const Body = z.object({
		title: EventExpensesModel.ExpenseFields.title,
		description: EventExpensesModel.ExpenseFields.description.default(""),
		category: EventExpensesModel.ExpenseFields.category.default("Sonstiges"),
		amount_cents: EventExpensesModel.ExpenseFields.amount_cents,
		spent_on: EventExpensesModel.ExpenseFields.spent_on,
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventExpensesModel.Expense;
	export type Response = z.infer<typeof Response>;
}

export namespace EventExpensesModel.Update {
	export const Body = z
		.object(EventExpensesModel.ExpenseFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventExpensesModel.Expense;
	export type Response = z.infer<typeof Response>;
}

export namespace EventExpensesModel.UploadReceipt {
	export const Form = z.object({
		file: z.file().describe("Receipt image or PDF"),
	});
	export type Form = z.infer<typeof Form>;

	export const Response = EventExpensesModel.Expense;
	export type Response = z.infer<typeof Response>;
}

export namespace EventExpensesModel.Review {
	export const Body = z.object({
		status: z.enum(["approved", "rejected", "reimbursed"]),
		note: z.string().trim().max(2_000).nullable().optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventExpensesModel.Expense;
	export type Response = z.infer<typeof Response>;
}

export namespace EventExpensesModel.Summary {
	export const Response = z.object({
		totals_by_status: z.object({
			submitted: z.number(),
			approved: z.number(),
			rejected: z.number(),
			reimbursed: z.number(),
		}),
		/** Approved + reimbursed + submitted (everything not rejected). */
		by_category: z.array(
			z.object({ category: z.string(), amount_cents: z.number(), count: z.number() }),
		),
		by_submitter: z.array(
			z.object({
				user: UserSummary.Schema.nullable(),
				amount_cents: z.number(),
				/** Approved but not yet reimbursed. */
				open_reimbursement_cents: z.number(),
			}),
		),
	});
	export type Response = z.infer<typeof Response>;
}
