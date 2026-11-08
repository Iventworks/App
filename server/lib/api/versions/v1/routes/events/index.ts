import { and, asc, count, desc, eq, gte, inArray, lt, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import type { DrizzleDB } from "../../../../../db/utils";
import { Logger } from "../../../../../utils/logger";
import { TimeUtils } from "../../../../../utils/time";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { EventAccess, type EventRouterEnv } from "../../../../utils/eventAccess";
import { FileService } from "../../../../utils/fileService";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { Notifier } from "../../../../utils/notifications";
import { PermissionHelper } from "../../../../utils/permissions";
import { UserSummary } from "../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { EventsModel } from "./model";

export const router = new Hono<EventRouterEnv>().basePath("/events");

router.use("*", requireOrgRole("volunteer"));

/** Build the caller-specific view of events with leaders and head counts in a few queries. */
async function withAccess(
	events: DB.Models.Event[],
	authContext: AuthHandler.AuthenticatedAuthContext,
	tx: DrizzleDB = DB.instance(),
): Promise<EventsModel.EventWithAccess[]> {
	if (events.length === 0) return [];
	const eventIds = events.map((event) => event.id);

	const members = await tx
		.select()
		.from(DB.Tables.eventMembers)
		.where(inArray(DB.Tables.eventMembers.event_id, eventIds))
		.all();

	const participantCounts = await tx
		.select({ event_id: DB.Tables.participants.event_id, value: count() })
		.from(DB.Tables.participants)
		.where(
			and(
				inArray(DB.Tables.participants.event_id, eventIds),
				ne(DB.Tables.participants.status, "cancelled"),
			),
		)
		.groupBy(DB.Tables.participants.event_id)
		.all();

	const users = await UserSummary.fetchMap(
		members.filter((member) => member.role === "leader").map((member) => member.user_id),
		tx,
	);

	return events.map((event) => {
		const eventMembers = members.filter((member) => member.event_id === event.id);
		const membership = eventMembers.find((member) => member.user_id === authContext.user_id);
		const role = PermissionHelper.getEffectiveEventRole(authContext.user_role, membership);

		return {
			...event,
			my_role: role,
			is_member: Boolean(membership),
			permissions: PermissionHelper.listEventPermissions(role, membership ?? null),
			leaders: eventMembers
				.filter((member) => member.role === "leader")
				.map((member) => users.get(member.user_id))
				.filter((user): user is UserSummary.Schema => Boolean(user)),
			staff_count: eventMembers.length,
			participant_count: participantCounts.find((entry) => entry.event_id === event.id)?.value ?? 0,
		};
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List events",
		description:
			"List camps and events. `scope=mine` returns the events the caller is staff of; `scope=all` (core team) returns every event.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Events retrieved successfully", EventsModel.GetAll.Response),
			APIResponseSpec.forbidden("You do not have permission to list all events"),
		),
	}),

	zValidator("query", EventsModel.GetAll.Query),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const query = c.req.valid("query") as EventsModel.GetAll.Query;

		if (
			query.scope === "all" &&
			!PermissionHelper.can({ authContext, permission: "events:view_all" })
		) {
			return APIResponse.forbidden(c, "You do not have permission to list all events");
		}

		const archivedFilter = query.include_archived
			? undefined
			: ne(DB.Tables.events.status, "archived");

		let events: DB.Models.Event[];
		if (query.scope === "all") {
			events = await DB.instance()
				.select()
				.from(DB.Tables.events)
				.where(archivedFilter)
				.orderBy(desc(DB.Tables.events.start_date))
				.all();
		} else {
			const memberships = await DB.instance()
				.select({ event_id: DB.Tables.eventMembers.event_id })
				.from(DB.Tables.eventMembers)
				.where(eq(DB.Tables.eventMembers.user_id, authContext.user_id))
				.all();
			const ids = memberships.map((membership) => membership.event_id);

			events =
				ids.length === 0
					? []
					: await DB.instance()
							.select()
							.from(DB.Tables.events)
							.where(and(inArray(DB.Tables.events.id, ids), archivedFilter))
							.orderBy(desc(DB.Tables.events.start_date))
							.all();
		}

		return APIResponse.success(
			c,
			"Events retrieved successfully",
			await withAccess(events, authContext),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event",
		description:
			"Create a camp or event and optionally assign its leaders. Requires the core team role.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Event created successfully", EventsModel.Create.Response),
			APIResponseSpec.forbidden("Only the core team can create events"),
		),
	}),

	zValidator("json", EventsModel.Create.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		if (!PermissionHelper.can({ authContext, permission: "events:create" })) {
			return APIResponse.forbidden(c, "Only the core team can create events");
		}

		const { leader_ids, ...body } = c.req.valid("json") as EventsModel.Create.Body;

		try {
			let leaderIds: number[] = [];
			const event = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const created = await tx
					.insert(DB.Tables.events)
					.values({ ...body, created_by: authContext.user_id })
					.returning()
					.get();

				const validLeaders = leader_ids.length
					? await tx
							.select({ id: DB.Tables.users.id })
							.from(DB.Tables.users)
							.where(and(inArray(DB.Tables.users.id, leader_ids), ne(DB.Tables.users.role, "unverified")))
							.all()
					: [];
				leaderIds = validLeaders.map((leader) => leader.id);

				if (validLeaders.length > 0) {
					await tx
						.insert(DB.Tables.eventMembers)
						.values(
							validLeaders.map((leader) => ({
								event_id: created.id,
								user_id: leader.id,
								role: "leader" as const,
							})),
						)
						.run();
				}

				return created;
			});

			await AuditLog.record({
				userId: authContext.user_id,
				eventId: event.id,
				action: "create",
				entityType: "event",
				entityId: event.id,
				summary: `${event.type === "camp" ? "Freizeit" : "Event"} „${event.name}“ angelegt`,
			});

			await Notifier.notify(
				leaderIds,
				{
					type: "event_added",
					title: `Du leitest „${event.name}“`,
					body: "Du wurdest als Leitung eingetragen.",
					link: `/events/${event.id}`,
				},
				{ excludeUserId: authContext.user_id },
			);

			const [result] = await withAccess([event], authContext);
			return APIResponse.created(c, "Event created successfully", result!);
		} catch (error: any) {
			Logger.error("Failed to create event", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create event");
		}
	},
);

router.use("/:eventId/*", ...EventAccess.loader);

router.get(
	"/:eventId",

	APIRouteSpec.authenticated({
		summary: "Get event",
		description: "Retrieve an event together with the caller's role and permissions in it.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Event retrieved successfully", EventsModel.EventWithAccess),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const [result] = await withAccess([c.get("event")], authContext);
		return APIResponse.success(c, "Event retrieved successfully", result!);
	},
);

router.put(
	"/:eventId",

	APIRouteSpec.authenticated({
		summary: "Update event",
		description: "Update an event's details, dates, budget or status. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Event updated successfully", EventsModel.Update.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to edit this event"),
		),
	}),

	zValidator("json", EventsModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "event:edit")) {
			return APIResponse.forbidden(c, "You are not allowed to edit this event");
		}

		const event = c.get("event");
		const body = c.req.valid("json") as EventsModel.Update.Body;

		const startDate = body.start_date ?? event.start_date;
		const endDate = body.end_date ?? event.end_date;
		if (startDate > endDate) {
			return APIResponse.badRequest(c, "end_date must not be before start_date");
		}

		const updated = await DB.instance()
			.update(DB.Tables.events)
			.set({ ...body, updated_at: Date.now() })
			.where(eq(DB.Tables.events.id, event.id))
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: event.id,
			action: "update",
			entityType: "event",
			entityId: event.id,
			summary: `Stammdaten von „${updated.name}“ geändert`,
			metadata: { fields: Object.keys(body) },
		});

		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const [result] = await withAccess([updated], authContext);
		return APIResponse.success(c, "Event updated successfully", result!);
	},
);

router.delete(
	"/:eventId",

	APIRouteSpec.authenticated({
		summary: "Delete event",
		description:
			"Permanently delete an event with all its participants, program, documents and finances. Requires the core team role.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Event deleted successfully"),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("Only the core team can delete events"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		if (!PermissionHelper.can({ authContext, permission: "events:delete" })) {
			return APIResponse.forbidden(c, "Only the core team can delete events");
		}

		const event = c.get("event");

		try {
			await DB.instance().transaction(async (tx: DrizzleDB) => {
				// Blobs on disk first; every other row goes via ON DELETE CASCADE.
				await FileService.deleteAllForEvent(event.id, tx);
				await tx.delete(DB.Tables.events).where(eq(DB.Tables.events.id, event.id)).run();
			});
		} catch (error: any) {
			Logger.error("Failed to delete event", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to delete event");
		}

		await AuditLog.record({
			userId: authContext.user_id,
			eventId: null,
			action: "delete",
			entityType: "event",
			entityId: event.id,
			summary: `${event.type === "camp" ? "Freizeit" : "Event"} „${event.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Event deleted successfully");
	},
);

router.get(
	"/:eventId/overview",

	APIRouteSpec.authenticated({
		summary: "Get event overview",
		description:
			"Everything the caller needs at a glance: today's and upcoming program, news, their tasks, responsibilities, room and groups.",
		tags: [DOCS_TAGS.EVENTS.EVENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Event overview retrieved successfully", EventsModel.Overview.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const event = c.get("event");
		const access = c.get("eventAccess");
		const userId = access.userId;
		const db = DB.instance();

		const today = TimeUtils.today();
		const { start: dayStart, end: dayEnd } = TimeUtils.dayBounds(today);
		const isRunning = event.start_date <= today && today <= event.end_date;

		const [eventWithAccess] = await withAccess([event], authContext);

		const todayItems = await db
			.select()
			.from(DB.Tables.programItems)
			.where(
				and(
					eq(DB.Tables.programItems.event_id, event.id),
					lt(DB.Tables.programItems.start_at, dayEnd),
					gte(DB.Tables.programItems.end_at, dayStart),
				),
			)
			.orderBy(asc(DB.Tables.programItems.start_at))
			.all();

		const nextItems = await db
			.select()
			.from(DB.Tables.programItems)
			.where(
				and(
					eq(DB.Tables.programItems.event_id, event.id),
					gte(DB.Tables.programItems.start_at, Math.max(Date.now(), dayEnd)),
				),
			)
			.orderBy(asc(DB.Tables.programItems.start_at))
			.limit(5)
			.all();

		const programIds = [...todayItems, ...nextItems].map((item) => item.id);
		const responsibles = programIds.length
			? await db
					.select()
					.from(DB.Tables.programItemResponsibles)
					.where(inArray(DB.Tables.programItemResponsibles.program_item_id, programIds))
					.all()
			: [];

		const announcements = await db
			.select()
			.from(DB.Tables.announcements)
			.where(eq(DB.Tables.announcements.event_id, event.id))
			.orderBy(desc(DB.Tables.announcements.pinned), desc(DB.Tables.announcements.created_at))
			.limit(5)
			.all();

		const myGroups = await db
			.select({
				id: DB.Tables.eventGroups.id,
				name: DB.Tables.eventGroups.name,
				color: DB.Tables.eventGroups.color,
			})
			.from(DB.Tables.eventGroupMembers)
			.innerJoin(
				DB.Tables.eventGroups,
				eq(DB.Tables.eventGroups.id, DB.Tables.eventGroupMembers.group_id),
			)
			.where(
				and(
					eq(DB.Tables.eventGroups.event_id, event.id),
					eq(DB.Tables.eventGroupMembers.user_id, userId),
				),
			)
			.all();

		const myGroupIds = myGroups.map((group) => group.id);

		const myTasks = await db
			.select()
			.from(DB.Tables.tasks)
			.where(
				and(
					eq(DB.Tables.tasks.event_id, event.id),
					ne(DB.Tables.tasks.status, "done"),
					myGroupIds.length
						? or(eq(DB.Tables.tasks.assignee_id, userId), inArray(DB.Tables.tasks.group_id, myGroupIds))
						: eq(DB.Tables.tasks.assignee_id, userId),
				),
			)
			.orderBy(asc(DB.Tables.tasks.due_at))
			.limit(10)
			.all();

		const myResponsibilities = await db
			.select({
				id: DB.Tables.responsibilities.id,
				title: DB.Tables.responsibilities.title,
				location: DB.Tables.responsibilities.location,
			})
			.from(DB.Tables.responsibilityAssignees)
			.innerJoin(
				DB.Tables.responsibilities,
				eq(DB.Tables.responsibilities.id, DB.Tables.responsibilityAssignees.responsibility_id),
			)
			.where(
				and(
					eq(DB.Tables.responsibilities.event_id, event.id),
					eq(DB.Tables.responsibilityAssignees.user_id, userId),
				),
			)
			.all();

		const myRoom = access.membership?.room_id
			? ((await db
					.select({ id: DB.Tables.rooms.id, name: DB.Tables.rooms.name })
					.from(DB.Tables.rooms)
					.where(eq(DB.Tables.rooms.id, access.membership.room_id))
					.get()) ?? null)
			: null;

		const openTasks = await db
			.select({ value: count() })
			.from(DB.Tables.tasks)
			.where(and(eq(DB.Tables.tasks.event_id, event.id), ne(DB.Tables.tasks.status, "done")))
			.get();

		const pendingExpenses = EventAccess.can(c, "expenses:view_all")
			? ((
					await db
						.select({ value: count() })
						.from(DB.Tables.expenses)
						.where(
							and(eq(DB.Tables.expenses.event_id, event.id), eq(DB.Tables.expenses.status, "submitted")),
						)
						.get()
				)?.value ?? 0)
			: null;

		const users = await UserSummary.fetchMap([
			...responsibles.map((entry) => entry.user_id),
			...announcements.map((entry) => entry.created_by),
		]);

		const toProgramSummary = (item: DB.Models.ProgramItem) => {
			const responsibleIds = responsibles
				.filter((entry) => entry.program_item_id === item.id)
				.map((entry) => entry.user_id);
			return {
				id: item.id,
				title: item.title,
				location: item.location,
				start_at: item.start_at,
				end_at: item.end_at,
				color: item.color,
				category: item.category,
				responsible: responsibleIds
					.map((id) => users.get(id))
					.filter((user): user is UserSummary.Schema => Boolean(user)),
				is_mine: responsibleIds.includes(userId),
			};
		};

		return APIResponse.success(c, "Event overview retrieved successfully", {
			event: eventWithAccess!,
			today,
			is_running: isRunning,
			today_program: todayItems.map(toProgramSummary),
			next_program: nextItems.map(toProgramSummary),
			announcements: announcements.map((announcement) => ({
				id: announcement.id,
				title: announcement.title,
				content: announcement.content,
				priority: announcement.priority,
				pinned: announcement.pinned,
				created_at: announcement.created_at,
				created_by: announcement.created_by ? (users.get(announcement.created_by) ?? null) : null,
			})),
			my_tasks: myTasks.map((task) => ({
				id: task.id,
				title: task.title,
				status: task.status,
				priority: task.priority,
				due_at: task.due_at,
			})),
			my_responsibilities: myResponsibilities,
			my_room: myRoom,
			my_groups: myGroups,
			counts: {
				participants: eventWithAccess!.participant_count,
				staff: eventWithAccess!.staff_count,
				open_tasks: openTasks?.value ?? 0,
				pending_expenses: pendingExpenses,
			},
		} satisfies EventsModel.Overview.Response);
	},
);

// Event sub-resources. Every one of them runs behind the `/:eventId/*` loader above.
router.route("/", (await import("./members")).router);
router.route("/", (await import("./groups")).router);
router.route("/", (await import("./rooms")).router);
router.route("/", (await import("./participants")).router);
router.route("/", (await import("./program")).router);
router.route("/", (await import("./responsibilities")).router);
router.route("/", (await import("./tasks")).router);
router.route("/", (await import("./notes")).router);
router.route("/", (await import("./announcements")).router);
router.route("/", (await import("./files")).router);
router.route("/", (await import("./expenses")).router);
router.route("/", (await import("./budget")).router);
router.route("/", (await import("./insights")).router);
