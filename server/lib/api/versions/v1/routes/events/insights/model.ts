import { z } from "zod";
import { AuditLogModel } from "../../../../../utils/shared-models/auditLog";

export namespace EventInsightsModel.Stats {
	const CountByKey = z.record(z.string(), z.number());

	export const Response = z.object({
		participants: z.object({
			/** All non-cancelled participants. */
			total: z.number(),
			by_status: z.object({
				registered: z.number(),
				confirmed: z.number(),
				waitlist: z.number(),
				cancelled: z.number(),
			}),
			/** Keys: female, male, diverse, unknown. */
			by_gender: CountByKey,
			/** Age on the event's start date. */
			age_buckets: z.array(z.object({ label: z.string(), count: z.number() })),
			fee_paid: z.number(),
			fee_open: z.number(),
			with_allergies: z.number(),
			with_medications: z.number(),
			photo_consent: z.number(),
		}),
		staff: z.object({
			total: z.number(),
			leaders: z.number(),
			by_group: z.array(z.object({ group_id: z.number(), name: z.string(), count: z.number() })),
		}),
		rooms: z.object({
			total: z.number(),
			/** Sum of all room capacities (rooms without capacity count as 0). */
			capacity: z.number(),
			assigned_participants: z.number(),
			unassigned_participants: z.number(),
		}),
		tasks: z.object({
			open: z.number(),
			in_progress: z.number(),
			done: z.number(),
			overdue: z.number(),
		}),
		finances: z.object({
			budget_cents: z.number(),
			planned_expenses_cents: z.number(),
			planned_income_cents: z.number(),
			expenses_by_status: z.object({
				submitted: z.number(),
				approved: z.number(),
				rejected: z.number(),
				reimbursed: z.number(),
			}),
			/** Approved + reimbursed expenses per category. */
			expenses_by_category: z.array(z.object({ category: z.string(), amount_cents: z.number() })),
			/** Participant fee × non-cancelled participants. */
			expected_fees_cents: z.number(),
		}),
		program: z.object({
			items: z.number(),
			hours_scheduled: z.number(),
		}),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace EventInsightsModel.AuditLog {
	export const Query = AuditLogModel.Filters;
	export type Query = AuditLogModel.Filters;

	export const Response = AuditLogModel.Page;
	export type Response = AuditLogModel.Page;
}
