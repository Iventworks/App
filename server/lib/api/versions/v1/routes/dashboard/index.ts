import { and, asc, count, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { Hono } from "hono";
import { DB } from "../../../../../db";
import { inOrg } from "../../../../../orgs/context";
import { TimeUtils } from "../../../../../utils/time";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { ConversationAccess } from "../../../../utils/conversations";
import { EventSchedule } from "../../../../utils/eventSchedule";
import { requireOrgRole } from "../../../../utils/guards";
import { Occurrences } from "../../../../utils/occurrences";
import { PersonalScope } from "../../../../utils/personalScope";
import { UserSummary } from "../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { DashboardModel } from "./model";

export const router = new Hono().basePath("/dashboard");

router.use("*", requireOrgRole("volunteer"));

const INACTIVE_STATUSES = new Set(["cancelled", "archived"]);
const DAY_MS = 24 * 60 * 60 * 1000;

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get personal dashboard",
		description:
			"The caller's start page: running events with today's program, upcoming events, overdue and upcoming tasks from everywhere, own program duties, unread messages and notifications, organisation news and today's calendar.",
		tags: [DOCS_TAGS.PERSONAL.DASHBOARD],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Dashboard retrieved successfully", DashboardModel.Response),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const userId = authContext.user_id;
		const db = DB.instance();

		const now = Date.now();
		const today = TimeUtils.today();
		const { start: dayStart, end: dayEnd } = TimeUtils.dayBounds(today);

		const memberships = (await PersonalScope.getMemberships(userId)).filter(
			(membership) => !INACTIVE_STATUSES.has(membership.event.status),
		);

		// --- running & upcoming events -------------------------------------------------------
		// A recurring event runs on the days of its dates and is "upcoming" until its next one.
		const memberEvents = memberships.map(({ event }) => event);
		const schedule = await EventSchedule.load(memberEvents);
		const nextOccurrences = await Occurrences.nextByEvent(memberEvents);

		const running = memberships.filter(({ event }) => schedule.takesPlaceOn(event, today));
		const runningIds = running.map(({ event }) => event.id);

		const todayItems = runningIds.length
			? await db
					.select()
					.from(DB.Tables.programItems)
					.where(
						and(
							inOrg(DB.Tables.programItems),
							inArray(DB.Tables.programItems.event_id, runningIds),
							lt(DB.Tables.programItems.start_at, dayEnd),
							gte(DB.Tables.programItems.end_at, dayStart),
						),
					)
					.orderBy(asc(DB.Tables.programItems.start_at))
					.all()
			: [];

		const memberEventIds = memberships.map(({ event }) => event.id);

		// Program items the caller is responsible for (today's + upcoming).
		const myResponsibleIds = new Set(
			(
				await db
					.select({ id: DB.Tables.programItemResponsibles.program_item_id })
					.from(DB.Tables.programItemResponsibles)
					.where(
						and(
							inOrg(DB.Tables.programItemResponsibles),
							eq(DB.Tables.programItemResponsibles.user_id, userId),
						),
					)
					.all()
			).map((row) => row.id),
		);

		const runningAnnouncements = runningIds.length
			? await db
					.select()
					.from(DB.Tables.announcements)
					.where(
						and(inOrg(DB.Tables.announcements), inArray(DB.Tables.announcements.event_id, runningIds)),
					)
					.orderBy(desc(DB.Tables.announcements.pinned), desc(DB.Tables.announcements.created_at))
					.all()
			: [];

		const toProgram = (item: DB.Models.ProgramItem): DashboardModel.ProgramItem => ({
			id: item.id,
			title: item.title,
			location: item.location,
			start_at: item.start_at,
			end_at: item.end_at,
			color: item.color,
			is_mine: myResponsibleIds.has(item.id),
		});

		const currentEvents: DashboardModel.CurrentEvent[] = running
			.sort((a, b) => a.event.start_date.localeCompare(b.event.start_date))
			.map(({ event, role }) => ({
				id: event.id,
				name: event.name,
				type: event.type,
				location: event.location,
				start_date: event.start_date,
				end_date: event.end_date,
				color: event.color,
				my_role: role,
				// A date of a recurring event is one day of its own, not "day 37 of 365".
				day_number: event.type === "recurring" ? 1 : TimeUtils.diffDays(event.start_date, today) + 1,
				total_days:
					event.type === "recurring" ? 1 : TimeUtils.diffDays(event.start_date, event.end_date) + 1,
				occurrence: nextOccurrences.get(event.id) ?? null,
				today_program: todayItems.filter((item) => item.event_id === event.id).map(toProgram),
				latest_announcements: runningAnnouncements
					.filter((announcement) => announcement.event_id === event.id)
					.slice(0, 3)
					.map((announcement) => ({
						id: announcement.id,
						title: announcement.title,
						priority: announcement.priority,
						created_at: announcement.created_at,
					})),
			}));

		const upcomingEvents: DashboardModel.UpcomingEvent[] = memberships
			.filter(({ event }) => !runningIds.includes(event.id))
			.map((membership) => ({ ...membership, next: schedule.nextDay(membership.event, today) }))
			.filter((entry): entry is typeof entry & { next: string } => entry.next !== null)
			.sort((a, b) => a.next.localeCompare(b.next))
			.slice(0, 5)
			.map(({ event, role, next }) => ({
				id: event.id,
				name: event.name,
				type: event.type,
				start_date: event.start_date,
				end_date: event.end_date,
				location: event.location,
				color: event.color,
				my_role: role,
				days_until: TimeUtils.diffDays(today, next),
				occurrence: nextOccurrences.get(event.id) ?? null,
			}));

		// --- tasks from everywhere -----------------------------------------------------------
		const openTasks = await PersonalScope.getTasks(userId);
		const toTask = (entry: PersonalScope.AggregatedTask): DashboardModel.TaskItem => ({
			id: entry.task.id,
			title: entry.task.title,
			status: entry.task.status,
			priority: entry.task.priority,
			due_at: entry.task.due_at,
			event: entry.event,
		});
		const overdue = openTasks.filter(({ task }) => task.due_at !== null && task.due_at < now);
		const dueSoon = openTasks.filter(
			({ task }) => task.due_at !== null && task.due_at >= now && task.due_at < now + 7 * DAY_MS,
		);

		// --- my next program duties ----------------------------------------------------------
		const myNextItems =
			memberEventIds.length && myResponsibleIds.size
				? await db
						.select()
						.from(DB.Tables.programItems)
						.where(
							and(
								inOrg(DB.Tables.programItems),
								inArray(DB.Tables.programItems.id, [...myResponsibleIds]),
								inArray(DB.Tables.programItems.event_id, memberEventIds),
								gte(DB.Tables.programItems.end_at, now),
							),
						)
						.orderBy(asc(DB.Tables.programItems.start_at))
						.limit(5)
						.all()
				: [];

		// --- messages & notifications --------------------------------------------------------
		const conversationIds = ConversationAccess.getAccessibleConversationIds(
			userId,
			authContext.user_role,
		);
		const conversationItems = await ConversationAccess.buildItems(
			ConversationAccess.loadConversations(conversationIds),
			userId,
		);
		// Like the sidebar badge: muted chats don't count.
		const unreadMessages = conversationItems.reduce(
			(sum, item) => sum + (item.muted ? 0 : item.unread_count),
			0,
		);
		const previewText = (last: NonNullable<(typeof conversationItems)[number]["last_message"]>) => {
			if (last.content) return last.content;
			if (last.attachment_is_image) {
				return last.attachment_count === 1 ? "Foto" : `${last.attachment_count} Fotos`;
			}
			return last.attachment_count === 1
				? (last.attachment_name ?? "Datei")
				: `${last.attachment_count} Dateien`;
		};
		const recentConversations = [
			...conversationItems.filter((item) => item.unread_count > 0),
			...conversationItems.filter((item) => item.unread_count === 0 && item.last_message_at),
		]
			.slice(0, 3)
			.map((item) => ({
				id: item.id,
				title: item.title,
				type: item.type,
				unread_count: item.unread_count,
				last_message_preview: item.last_message
					? `${item.last_message.sender_name ? `${item.last_message.sender_name}: ` : ""}${previewText(item.last_message)}`
					: null,
				last_message_at: item.last_message_at,
			}));

		const unreadNotifications = await db
			.select({ value: count() })
			.from(DB.Tables.notifications)
			.where(
				and(
					inOrg(DB.Tables.notifications),
					eq(DB.Tables.notifications.user_id, userId),
					isNull(DB.Tables.notifications.read_at),
				),
			)
			.get();

		// --- organisation news & personal calendar -------------------------------------------
		const orgAnnouncements = await db
			.select()
			.from(DB.Tables.announcements)
			.where(and(inOrg(DB.Tables.announcements), isNull(DB.Tables.announcements.event_id)))
			.orderBy(desc(DB.Tables.announcements.pinned), desc(DB.Tables.announcements.created_at))
			.limit(3)
			.all();
		const authors = await UserSummary.fetchMap(orgAnnouncements.map((entry) => entry.created_by));

		const calendarToday = await db
			.select()
			.from(DB.Tables.calendarEntries)
			.where(
				and(
					inOrg(DB.Tables.calendarEntries),
					eq(DB.Tables.calendarEntries.user_id, userId),
					lt(DB.Tables.calendarEntries.start_at, dayEnd),
					gte(DB.Tables.calendarEntries.end_at, dayStart),
				),
			)
			.orderBy(asc(DB.Tables.calendarEntries.start_at))
			.all();

		return APIResponse.success(c, "Dashboard retrieved successfully", {
			today,
			current_events: currentEvents,
			upcoming_events: upcomingEvents,
			tasks: {
				overdue: overdue.slice(0, 10).map(toTask),
				due_soon: dueSoon.slice(0, 10).map(toTask),
				open_count: openTasks.length,
			},
			my_next_program_items: myNextItems.map((item) => {
				const event = memberships.find((membership) => membership.event.id === item.event_id)!.event;
				return { ...toProgram(item), event: { id: event.id, name: event.name } };
			}),
			unread_messages: unreadMessages,
			recent_conversations: recentConversations,
			unread_notifications: unreadNotifications?.value ?? 0,
			org_announcements: orgAnnouncements.map((announcement) => ({
				id: announcement.id,
				title: announcement.title,
				content: announcement.content,
				priority: announcement.priority,
				pinned: announcement.pinned,
				created_at: announcement.created_at,
				created_by: announcement.created_by ? (authors.get(announcement.created_by) ?? null) : null,
			})),
			calendar_today: calendarToday.map((entry) => ({
				id: entry.id,
				title: entry.title,
				location: entry.location,
				start_at: entry.start_at,
				end_at: entry.end_at,
				all_day: entry.all_day,
				color: entry.color,
			})),
		} satisfies DashboardModel.Response);
	},
);
