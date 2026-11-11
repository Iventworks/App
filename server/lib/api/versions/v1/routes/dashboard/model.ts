import { z } from "zod";
import {
	ANNOUNCEMENT_PRIORITIES,
	CONVERSATION_TYPES,
	EVENT_MEMBER_ROLES,
	EVENT_TYPES,
	TASK_PRIORITIES,
	TASK_STATUSES,
} from "../../../../../db/schema";
import { Occurrences } from "../../../../utils/occurrences";
import { UserSummary } from "../../../../utils/shared-models/userSummary";

export namespace DashboardModel {
	const EventRef = z.object({ id: z.number(), name: z.string() });

	export const ProgramItem = z.object({
		id: z.number(),
		title: z.string(),
		location: z.string().nullable(),
		start_at: z.number(),
		end_at: z.number(),
		color: z.string().nullable(),
		/** The caller is responsible for this program item. */
		is_mine: z.boolean(),
	});
	export type ProgramItem = z.infer<typeof ProgramItem>;

	export const CurrentEvent = z.object({
		id: z.number(),
		name: z.string(),
		type: z.enum(EVENT_TYPES),
		location: z.string().nullable(),
		start_date: z.string(),
		end_date: z.string(),
		color: z.string().nullable(),
		my_role: z.enum(EVENT_MEMBER_ROLES),
		/** 1-based day of the event ("Tag 3 von 9"); 1 of 1 for a date of a recurring event. */
		day_number: z.number(),
		total_days: z.number(),
		/** Recurring events: today's date (time, place, topic). */
		occurrence: Occurrences.SummarySchema.nullable(),
		today_program: z.array(ProgramItem),
		latest_announcements: z.array(
			z.object({
				id: z.number(),
				title: z.string(),
				priority: z.enum(ANNOUNCEMENT_PRIORITIES),
				created_at: z.number(),
			}),
		),
	});
	export type CurrentEvent = z.infer<typeof CurrentEvent>;

	export const UpcomingEvent = z.object({
		id: z.number(),
		name: z.string(),
		type: z.enum(EVENT_TYPES),
		start_date: z.string(),
		end_date: z.string(),
		location: z.string().nullable(),
		color: z.string().nullable(),
		my_role: z.enum(EVENT_MEMBER_ROLES),
		/** Days until the event starts — for a recurring event until its next date. */
		days_until: z.number(),
		/** Recurring events: the next date (time, place, topic). */
		occurrence: Occurrences.SummarySchema.nullable(),
	});
	export type UpcomingEvent = z.infer<typeof UpcomingEvent>;

	export const TaskItem = z.object({
		id: z.number(),
		title: z.string(),
		status: z.enum(TASK_STATUSES),
		priority: z.enum(TASK_PRIORITIES),
		due_at: z.number().nullable(),
		/** Null for personal tasks. */
		event: EventRef.nullable(),
	});
	export type TaskItem = z.infer<typeof TaskItem>;

	export const Response = z.object({
		/** Organisation-local date (YYYY-MM-DD). */
		today: z.string(),
		/** Events the caller works on that are running today. */
		current_events: z.array(CurrentEvent),
		upcoming_events: z.array(UpcomingEvent),
		tasks: z.object({
			overdue: z.array(TaskItem),
			/** Due within the next 7 days. */
			due_soon: z.array(TaskItem),
			open_count: z.number(),
		}),
		/** Next program items the caller is responsible for. */
		my_next_program_items: z.array(ProgramItem.extend({ event: EventRef })),
		unread_messages: z.number(),
		recent_conversations: z.array(
			z.object({
				id: z.number(),
				title: z.string(),
				type: z.enum(CONVERSATION_TYPES),
				unread_count: z.number(),
				last_message_preview: z.string().nullable(),
				last_message_at: z.number().nullable(),
			}),
		),
		unread_notifications: z.number(),
		org_announcements: z.array(
			z.object({
				id: z.number(),
				title: z.string(),
				content: z.string(),
				priority: z.enum(ANNOUNCEMENT_PRIORITIES),
				pinned: z.boolean(),
				created_at: z.number(),
				created_by: UserSummary.Schema.nullable(),
			}),
		),
		calendar_today: z.array(
			z.object({
				id: z.number(),
				title: z.string(),
				location: z.string().nullable(),
				start_at: z.number(),
				end_at: z.number(),
				all_day: z.boolean(),
				color: z.string().nullable(),
			}),
		),
	});
	export type Response = z.infer<typeof Response>;
}
