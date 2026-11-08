import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { TimeUtils } from "../../../../../utils/time";
import { APIResponse } from "../../../../utils/api-res";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PersonalScope } from "../tasks/aggregate";
import { CalendarModel } from "./model";

type CalendarEnv = { Variables: { entry: DB.Models.CalendarEntry } };

export const router = new Hono<CalendarEnv>().basePath("/calendar");

router.use("*", requireOrgRole("volunteer"));

router.get(
	"/feed",

	APIRouteSpec.authenticated({
		summary: "Get calendar feed",
		description:
			"Everything relevant to the caller in a time range: own calendar entries, the program of their events, their events as all-day spans, and due dates of their tasks.",
		tags: [DOCS_TAGS.PERSONAL.CALENDAR],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Calendar feed retrieved successfully", CalendarModel.Feed.Response),
			APIResponseSpec.badRequest(
				"The range must be at most 120 days long and end after it starts / Syntax or validation error in request",
			),
		),
	}),

	zValidator("query", CalendarModel.Feed.Query),

	async (c) => {
		const { from, to } = c.req.valid("query") as CalendarModel.Feed.Query;
		if (to <= from || to - from > CalendarModel.MAX_FEED_SPAN_MS) {
			return APIResponse.badRequest(
				c,
				"The range must be at most 120 days long and end after it starts",
			);
		}

		const userId = getAuthUserId(c);
		const db = DB.instance();
		const items: CalendarModel.Feed.Item[] = [];

		const entries = await db
			.select()
			.from(DB.Tables.calendarEntries)
			.where(
				and(
					eq(DB.Tables.calendarEntries.user_id, userId),
					lt(DB.Tables.calendarEntries.start_at, to),
					gte(DB.Tables.calendarEntries.end_at, from),
				),
			)
			.all();
		for (const entry of entries) {
			items.push({
				id: `entry-${entry.id}`,
				source: "entry",
				source_id: entry.id,
				title: entry.title,
				start_at: entry.start_at,
				end_at: entry.end_at,
				all_day: entry.all_day,
				color: entry.color,
				location: entry.location,
				link: "/calendar",
				event: null,
				is_mine: true,
			});
		}

		const memberships = await PersonalScope.getMemberships(userId);
		const events = memberships.map((membership) => membership.event);
		const eventIds = events.map((event) => event.id);

		for (const event of events) {
			const start = TimeUtils.startOfDay(event.start_date);
			const end = TimeUtils.startOfDay(TimeUtils.addDays(event.end_date, 1));
			if (start >= to || end <= from) continue;
			items.push({
				id: `event-${event.id}`,
				source: "event",
				source_id: event.id,
				title: event.name,
				start_at: start,
				end_at: end,
				all_day: true,
				color: event.color,
				location: event.location,
				link: `/events/${event.id}`,
				event: { id: event.id, name: event.name },
				is_mine: true,
			});
		}

		if (eventIds.length > 0) {
			const programItems = await db
				.select()
				.from(DB.Tables.programItems)
				.where(
					and(
						inArray(DB.Tables.programItems.event_id, eventIds),
						lt(DB.Tables.programItems.start_at, to),
						gte(DB.Tables.programItems.end_at, from),
					),
				)
				.orderBy(asc(DB.Tables.programItems.start_at))
				.all();

			const mine = new Set(
				programItems.length
					? (
							await db
								.select({ id: DB.Tables.programItemResponsibles.program_item_id })
								.from(DB.Tables.programItemResponsibles)
								.where(
									and(
										eq(DB.Tables.programItemResponsibles.user_id, userId),
										inArray(
											DB.Tables.programItemResponsibles.program_item_id,
											programItems.map((item) => item.id),
										),
									),
								)
								.all()
						).map((row) => row.id)
					: [],
			);

			for (const item of programItems) {
				const event = events.find((entry) => entry.id === item.event_id);
				items.push({
					id: `program-${item.id}`,
					source: "program",
					source_id: item.id,
					title: item.title,
					start_at: item.start_at,
					end_at: item.end_at,
					all_day: false,
					color: item.color ?? event?.color ?? null,
					location: item.location,
					link: `/events/${item.event_id}/program`,
					event: event ? { id: event.id, name: event.name } : null,
					is_mine: mine.has(item.id),
				});
			}
		}

		const tasks = await PersonalScope.getTasks(userId);
		for (const { task, event } of tasks) {
			if (task.due_at === null || task.due_at < from || task.due_at >= to) continue;
			items.push({
				id: `task-${task.id}`,
				source: "task",
				source_id: task.id,
				title: task.title,
				start_at: task.due_at,
				end_at: task.due_at,
				all_day: false,
				color: null,
				location: null,
				link: event ? `/events/${event.id}/tasks` : "/tasks",
				event,
				is_mine: true,
			});
		}

		items.sort((a, b) => a.start_at - b.start_at || a.id.localeCompare(b.id));

		return APIResponse.success(c, "Calendar feed retrieved successfully", items);
	},
);

router.get(
	"/entries",

	APIRouteSpec.authenticated({
		summary: "List calendar entries",
		description: "List the caller's own calendar entries, optionally limited to a time range.",
		tags: [DOCS_TAGS.PERSONAL.CALENDAR],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Calendar entries retrieved successfully",
				CalendarModel.GetEntries.Response,
			),
		),
	}),

	zValidator("query", CalendarModel.GetEntries.Query),

	async (c) => {
		const { from, to } = c.req.valid("query") as CalendarModel.GetEntries.Query;

		const entries = await DB.instance()
			.select()
			.from(DB.Tables.calendarEntries)
			.where(
				and(
					eq(DB.Tables.calendarEntries.user_id, getAuthUserId(c)),
					to !== undefined ? lt(DB.Tables.calendarEntries.start_at, to) : undefined,
					from !== undefined ? gte(DB.Tables.calendarEntries.end_at, from) : undefined,
				),
			)
			.orderBy(asc(DB.Tables.calendarEntries.start_at))
			.all();

		return APIResponse.success(c, "Calendar entries retrieved successfully", entries);
	},
);

router.post(
	"/entries",

	APIRouteSpec.authenticated({
		summary: "Create calendar entry",
		description: "Add an entry to the caller's personal calendar.",
		tags: [DOCS_TAGS.PERSONAL.CALENDAR],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Calendar entry created successfully",
				CalendarModel.CreateEntry.Response,
			),
		),
	}),

	zValidator("json", CalendarModel.CreateEntry.Body),

	async (c) => {
		const body = c.req.valid("json") as CalendarModel.CreateEntry.Body;

		const entry = await DB.instance()
			.insert(DB.Tables.calendarEntries)
			.values({ ...body, user_id: getAuthUserId(c) })
			.returning()
			.get();

		return APIResponse.created(c, "Calendar entry created successfully", entry);
	},
);

router.use("/entries/:entryId/*", zValidator("param", CalendarModel.Params), async (c, next) => {
	const entryId = CalendarModel.Params.shape.entryId.safeParse(c.req.param("entryId"));
	if (!entryId.success) return APIResponse.badRequest(c, "Invalid entry id");

	const entry = await DB.instance()
		.select()
		.from(DB.Tables.calendarEntries)
		.where(
			and(
				eq(DB.Tables.calendarEntries.id, entryId.data),
				eq(DB.Tables.calendarEntries.user_id, getAuthUserId(c)),
			),
		)
		.get();

	if (!entry) return APIResponse.notFound(c, "Calendar entry not found");

	c.set("entry", entry);
	await next();
});

router.put(
	"/entries/:entryId",

	APIRouteSpec.authenticated({
		summary: "Update calendar entry",
		description: "Update one of the caller's calendar entries.",
		tags: [DOCS_TAGS.PERSONAL.CALENDAR],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Calendar entry updated successfully",
				CalendarModel.UpdateEntry.Response,
			),
			APIResponseSpec.badRequest(
				"end_at must not be before start_at / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Calendar entry not found"),
		),
	}),

	zValidator("json", CalendarModel.UpdateEntry.Body),

	async (c) => {
		const entry = c.get("entry");
		const body = c.req.valid("json") as CalendarModel.UpdateEntry.Body;

		if ((body.end_at ?? entry.end_at) < (body.start_at ?? entry.start_at)) {
			return APIResponse.badRequest(c, "end_at must not be before start_at");
		}

		const updated = await DB.instance()
			.update(DB.Tables.calendarEntries)
			.set(body)
			.where(eq(DB.Tables.calendarEntries.id, entry.id))
			.returning()
			.get();

		return APIResponse.success(c, "Calendar entry updated successfully", updated);
	},
);

router.delete(
	"/entries/:entryId",

	APIRouteSpec.authenticated({
		summary: "Delete calendar entry",
		description: "Delete one of the caller's calendar entries.",
		tags: [DOCS_TAGS.PERSONAL.CALENDAR],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Calendar entry deleted successfully"),
			APIResponseSpec.notFound("Calendar entry not found"),
		),
	}),

	async (c) => {
		await DB.instance()
			.delete(DB.Tables.calendarEntries)
			.where(eq(DB.Tables.calendarEntries.id, c.get("entry").id))
			.run();
		return APIResponse.successNoData(c, "Calendar entry deleted successfully");
	},
);
