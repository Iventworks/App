import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { EVENT_STATUSES, EVENT_TYPES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace CoreTeamModel {
	export const EventSummary = z.object({
		id: z.number(),
		name: z.string(),
		type: z.enum(EVENT_TYPES),
		status: z.enum(EVENT_STATUSES),
		start_date: z.string(),
		end_date: z.string(),
		color: z.string().nullable(),
		staff_count: z.number(),
		participant_count: z.number(),
	});
	export type EventSummary = z.infer<typeof EventSummary>;

	export const YearQuery = z.object({
		year: z.coerce.number().int().min(2000).max(2100).optional(),
	});
	export type YearQuery = z.infer<typeof YearQuery>;
}

export namespace CoreTeamModel.Overview {
	export const Response = z.object({
		events_by_status: z.object({
			planning: z.number(),
			confirmed: z.number(),
			cancelled: z.number(),
			archived: z.number(),
		}),
		running_events: z.array(CoreTeamModel.EventSummary),
		upcoming_events: z.array(
			CoreTeamModel.EventSummary.extend({
				leaders: z.array(UserSummary.Schema),
				/** No leader assigned yet. */
				unstaffed: z.boolean(),
			}),
		),
		totals: z.object({
			events: z.number(),
			participants: z.number(),
			volunteers: z.number(),
		}),
		pending_expenses: z.object({
			count: z.number(),
			amount_cents: z.number(),
		}),
		unverified_users: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace CoreTeamModel.Finances {
	export const Query = CoreTeamModel.YearQuery;
	export type Query = z.infer<typeof Query>;

	const Amounts = {
		budget_cents: z.number(),
		planned_expense_cents: z.number(),
		planned_income_cents: z.number(),
		/** Participant fee × non-cancelled participants. */
		expected_fees_cents: z.number(),
		/** Approved + reimbursed expenses. */
		actual_expense_cents: z.number(),
		/** Submitted, not yet reviewed. */
		pending_expense_cents: z.number(),
		reimbursed_cents: z.number(),
	};

	export const EventFinances = z.object({
		event: z.object({
			id: z.number(),
			name: z.string(),
			start_date: z.string(),
			status: z.enum(EVENT_STATUSES),
		}),
		...Amounts,
	});
	export type EventFinances = z.infer<typeof EventFinances>;

	export const Response = z.object({
		per_event: z.array(EventFinances),
		totals: z.object(Amounts),
		by_category: z.array(z.object({ category: z.string(), actual_cents: z.number() })),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace CoreTeamModel.Stats {
	export const Query = CoreTeamModel.YearQuery;
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		events_count: z.number(),
		participants_total: z.number(),
		participants_by_event: z.array(
			z.object({
				event_id: z.number(),
				name: z.string(),
				start_date: z.string(),
				count: z.number(),
			}),
		),
		/** Age at the start of each participant's event. */
		age_buckets: z.array(z.object({ label: z.string(), count: z.number() })),
		gender: z.object({
			female: z.number(),
			male: z.number(),
			diverse: z.number(),
			unknown: z.number(),
		}),
		staff_engagement: z.array(
			z.object({
				user: UserSummary.Schema,
				events_count: z.number(),
				leader_count: z.number(),
			}),
		),
		/** Distinct people (first + last name + birth date) who took part in more than one event. */
		returning_participants: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace CoreTeamModel.StaffPlanning {
	const isoDate = z.iso.date("Expected a date in the format YYYY-MM-DD");

	export const Query = z.object({
		from: isoDate.optional(),
		to: isoDate.optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		from: z.string(),
		to: z.string(),
		events: z.array(
			z.object({
				id: z.number(),
				name: z.string(),
				start_date: z.string(),
				end_date: z.string(),
				color: z.string().nullable(),
			}),
		),
		users: z.array(
			z.object({
				user: UserSummary.Schema,
				assignments: z.array(z.object({ event_id: z.number(), role: z.enum(["leader", "staff"]) })),
				/** Pairs of assigned events whose date ranges overlap. */
				conflicts: z.array(z.tuple([z.number(), z.number()])),
			}),
		),
		unassigned_users: z.array(UserSummary.Schema),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace CoreTeamModel.Notes {
	export const Note = createSelectSchema(DB.Tables.notes).omit({ org_id: true }).extend({
		creator: UserSummary.Schema.nullable(),
		updater: UserSummary.Schema.nullable(),
		can_delete: z.boolean(),
	});
	export type Note = z.infer<typeof Note>;

	export const Params = z.object({
		noteId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Fields = {
		title: z.string().trim().min(1).max(200),
		content: z.string().max(100_000),
		pinned: z.boolean(),
	};

	export const GetAllResponse = z.array(Note);
	export type GetAllResponse = z.infer<typeof GetAllResponse>;

	export const CreateBody = z.object({
		title: Fields.title,
		content: Fields.content.default(""),
		pinned: Fields.pinned.default(false),
	});
	export type CreateBody = z.infer<typeof CreateBody>;

	export const UpdateBody = z
		.object(Fields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type UpdateBody = z.infer<typeof UpdateBody>;
}
