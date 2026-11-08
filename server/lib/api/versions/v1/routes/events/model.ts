import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../db";
import { EVENT_MEMBER_ROLES, EVENT_STATUSES, EVENT_TYPES } from "../../../../../db/schema";
import { PermissionHelper } from "../../../../utils/permissions";
import { UserSummary } from "../../../../utils/shared-models/userSummary";

export namespace EventsModel {
	export const Event = createSelectSchema(DB.Tables.events);
	export type Event = z.infer<typeof Event>;

	export const EventRole = z.enum(EVENT_MEMBER_ROLES);
	export type EventRole = z.infer<typeof EventRole>;

	export const EventPermission = z.enum(
		Object.keys(PermissionHelper.EVENT_PERMISSIONS) as [
			PermissionHelper.EventPermission,
			...PermissionHelper.EventPermission[],
		],
	);
	export type EventPermission = z.infer<typeof EventPermission>;

	/** An event as seen by the caller: their effective role and what they may do. */
	export const EventWithAccess = Event.extend({
		my_role: EventRole.nullable(),
		/** True when the caller is staff of the event (core team may have access without it). */
		is_member: z.boolean(),
		permissions: z.array(EventPermission),
		leaders: z.array(UserSummary.Schema),
		staff_count: z.number(),
		participant_count: z.number(),
	});
	export type EventWithAccess = z.infer<typeof EventWithAccess>;

	const isoDate = z.iso.date("Expected a date in the format YYYY-MM-DD");
	const color = z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #f97316")
		.nullable();

	/** Field rules shared by create and update (request bodies are explicit `z.object`s:
	 * drizzle-zod's insert schemas drop optionality when a column gets a refinement). */
	export const EventFields = {
		name: z.string().trim().min(1).max(120),
		type: z.enum(EVENT_TYPES),
		status: z.enum(EVENT_STATUSES),
		description: z.string().max(10_000),
		location: z.string().trim().max(200).nullable(),
		start_date: isoDate,
		end_date: isoDate,
		color,
		max_participants: z.number().int().min(0).nullable(),
		participant_fee_cents: z.number().int().min(0).nullable(),
		budget_cents: z.number().int().min(0),
	};
}

export namespace EventsModel.GetAll {
	export const Query = z.object({
		/** `mine` = events the caller is staff of; `all` (core team) = every event. */
		scope: z.enum(["mine", "all"]).default("mine"),
		include_archived: z
			.enum(["true", "false"])
			.default("false")
			.transform((value) => value === "true"),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(EventWithAccess);
	export type Response = z.infer<typeof Response>;
}

export namespace EventsModel.Create {
	const F = EventsModel.EventFields;

	export const Body = z
		.object({
			name: F.name,
			type: F.type.default("camp"),
			status: F.status.default("planning"),
			description: F.description.default(""),
			location: F.location.default(null),
			start_date: F.start_date,
			end_date: F.end_date,
			color: F.color.default(null),
			max_participants: F.max_participants.default(null),
			participant_fee_cents: F.participant_fee_cents.default(null),
			budget_cents: F.budget_cents.default(0),
			/** Users to add as leaders ("Leiter der Freizeit") right away. */
			leader_ids: z.array(z.number().int().positive()).max(50).default([]),
		})
		.refine((data) => data.start_date <= data.end_date, {
			message: "end_date must not be before start_date",
			path: ["end_date"],
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventWithAccess;
	export type Response = z.infer<typeof Response>;
}

export namespace EventsModel.Update {
	export const Body = z
		.object(EventsModel.EventFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventWithAccess;
	export type Response = z.infer<typeof Response>;
}

export namespace EventsModel.Overview {
	const ProgramItemSummary = z.object({
		id: z.number(),
		title: z.string(),
		location: z.string().nullable(),
		start_at: z.number(),
		end_at: z.number(),
		color: z.string().nullable(),
		category: z.string().nullable(),
		responsible: z.array(UserSummary.Schema),
		is_mine: z.boolean(),
	});

	const AnnouncementSummary = z.object({
		id: z.number(),
		title: z.string(),
		content: z.string(),
		priority: z.enum(["normal", "important"]),
		pinned: z.boolean(),
		created_at: z.number(),
		created_by: UserSummary.Schema.nullable(),
	});

	const TaskSummary = z.object({
		id: z.number(),
		title: z.string(),
		status: z.enum(["open", "in_progress", "done"]),
		priority: z.enum(["low", "normal", "high", "urgent"]),
		due_at: z.number().nullable(),
	});

	const ResponsibilitySummary = z.object({
		id: z.number(),
		title: z.string(),
		location: z.string().nullable(),
	});

	export const Response = z.object({
		event: EventWithAccess,
		/** Server "today" (YYYY-MM-DD) used for `today_program`. */
		today: z.string(),
		is_running: z.boolean(),
		today_program: z.array(ProgramItemSummary),
		next_program: z.array(ProgramItemSummary),
		announcements: z.array(AnnouncementSummary),
		my_tasks: z.array(TaskSummary),
		my_responsibilities: z.array(ResponsibilitySummary),
		my_room: z.object({ id: z.number(), name: z.string() }).nullable(),
		my_groups: z.array(z.object({ id: z.number(), name: z.string(), color: z.string().nullable() })),
		counts: z.object({
			participants: z.number(),
			staff: z.number(),
			open_tasks: z.number(),
			/** Only filled for callers with `expenses:view_all`. */
			pending_expenses: z.number().nullable(),
		}),
	});
	export type Response = z.infer<typeof Response>;
}
