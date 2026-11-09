import { and, asc, eq, inArray, ne, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { Notifier } from "../../../../../utils/notifications";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventTasksModel } from "./model";

type TasksEnv = {
	Variables: EventRouterEnv["Variables"] & { task: DB.Models.Task };
};

export const router = new Hono<TasksEnv>().basePath("/:eventId/tasks");

const STATUS_LABELS: Record<DB.Models.Task["status"], string> = {
	open: "offen",
	in_progress: "in Arbeit",
	done: "erledigt",
};

/** Group ids of the caller inside this event. */
async function getMyGroupIds(eventId: number, userId: number) {
	const rows = await DB.instance()
		.select({ id: DB.Tables.eventGroups.id })
		.from(DB.Tables.eventGroupMembers)
		.innerJoin(
			DB.Tables.eventGroups,
			and(
				inOrg(DB.Tables.eventGroups),
				eq(DB.Tables.eventGroups.id, DB.Tables.eventGroupMembers.group_id),
			),
		)
		.where(
			and(
				inOrg(DB.Tables.eventGroupMembers),
				eq(DB.Tables.eventGroups.event_id, eventId),
				eq(DB.Tables.eventGroupMembers.user_id, userId),
			),
		)
		.all();
	return rows.map((row) => row.id);
}

/** Validate that an assignee is staff of the event and a group belongs to it. */
async function validateRefs(
	eventId: number,
	refs: { assignee_id?: number | null; group_id?: number | null },
): Promise<string | null> {
	if (refs.assignee_id) {
		const member = await DB.instance()
			.select({ id: DB.Tables.eventMembers.id })
			.from(DB.Tables.eventMembers)
			.where(
				and(
					inOrg(DB.Tables.eventMembers),
					eq(DB.Tables.eventMembers.event_id, eventId),
					eq(DB.Tables.eventMembers.user_id, refs.assignee_id),
				),
			)
			.get();
		if (!member) return "The assignee is not a staff member of this event";
	}
	if (refs.group_id) {
		const group = await DB.instance()
			.select({ id: DB.Tables.eventGroups.id })
			.from(DB.Tables.eventGroups)
			.where(
				and(
					inOrg(DB.Tables.eventGroups),
					eq(DB.Tables.eventGroups.event_id, eventId),
					eq(DB.Tables.eventGroups.id, refs.group_id),
				),
			)
			.get();
		if (!group) return "The group does not belong to this event";
	}
	return null;
}

function canEditFully(c: Context<TasksEnv>, task: DB.Models.Task) {
	return EventAccess.can(c, "tasks:manage_all") || task.created_by === c.get("eventAccess").userId;
}

async function toResponse(
	c: Context<TasksEnv>,
	tasks: DB.Models.Task[],
): Promise<EventTasksModel.Task[]> {
	const users = await UserSummary.fetchMap(
		tasks.flatMap((task) => [task.assignee_id, task.created_by]),
	);
	const groupIds = [
		...new Set(tasks.map((task) => task.group_id).filter((id): id is number => id !== null)),
	];
	const groups = groupIds.length
		? await DB.instance()
				.select({
					id: DB.Tables.eventGroups.id,
					name: DB.Tables.eventGroups.name,
					color: DB.Tables.eventGroups.color,
				})
				.from(DB.Tables.eventGroups)
				.where(and(inOrg(DB.Tables.eventGroups), inArray(DB.Tables.eventGroups.id, groupIds)))
				.all()
		: [];

	return tasks.map((task) => {
		const fullEdit = canEditFully(c, task);
		return {
			...task,
			assignee: task.assignee_id ? (users.get(task.assignee_id) ?? null) : null,
			creator: task.created_by ? (users.get(task.created_by) ?? null) : null,
			group: groups.find((group) => group.id === task.group_id) ?? null,
			can_edit: fullEdit,
			can_delete: fullEdit,
		};
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event tasks",
		description:
			"List the tasks of an event. `filter=mine` returns tasks assigned to the caller or one of their groups.",
		tags: [DOCS_TAGS.EVENTS.TASKS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Tasks retrieved successfully", EventTasksModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not a member of this event"),
		),
	}),

	zValidator("query", EventTasksModel.GetAll.Query),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { filter } = c.req.valid("query") as EventTasksModel.GetAll.Query;

		const conditions = [inOrg(DB.Tables.tasks), eq(DB.Tables.tasks.event_id, event.id)];
		if (filter === "open") {
			conditions.push(ne(DB.Tables.tasks.status, "done"));
		}
		if (filter === "mine") {
			const groupIds = await getMyGroupIds(event.id, userId);
			const mine = groupIds.length
				? or(eq(DB.Tables.tasks.assignee_id, userId), inArray(DB.Tables.tasks.group_id, groupIds))
				: eq(DB.Tables.tasks.assignee_id, userId);
			if (mine) conditions.push(mine);
		}

		const tasks = await DB.instance()
			.select()
			.from(DB.Tables.tasks)
			.where(and(...conditions))
			.orderBy(asc(DB.Tables.tasks.status), asc(DB.Tables.tasks.due_at), asc(DB.Tables.tasks.id))
			.all();

		return APIResponse.success(c, "Tasks retrieved successfully", await toResponse(c, tasks));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event task",
		description: "Create a task in the event, optionally assigned to a staff member and/or a group.",
		tags: [DOCS_TAGS.EVENTS.TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Task created successfully", EventTasksModel.Create.Response),
			APIResponseSpec.badRequest(
				"The assignee is not a staff member of this event / The group does not belong to this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to create tasks in this event"),
		),
	}),

	zValidator("json", EventTasksModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "tasks:create")) {
			return APIResponse.forbidden(c, "You are not allowed to create tasks in this event");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventTasksModel.Create.Body;

		const refError = await validateRefs(event.id, body);
		if (refError) return APIResponse.badRequest(c, refError);

		const task = await DB.instance()
			.insert(DB.Tables.tasks)
			.values({
				...body,
				event_id: event.id,
				created_by: userId,
				completed_at: body.status === "done" ? Date.now() : null,
				org_id: OrgContext.id(),
			})
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "task",
			entityId: task.id,
			summary: `Aufgabe „${task.title}“ angelegt`,
		});

		await Notifier.notify(
			[task.assignee_id],
			{
				type: "task_assigned",
				title: `Neue Aufgabe: ${task.title}`,
				body: event.name,
				link: `/events/${event.id}/tasks`,
			},
			{ excludeUserId: userId },
		);

		const [result] = await toResponse(c, [task]);
		return APIResponse.created(c, "Task created successfully", result!);
	},
);

router.use("/:taskId/*", zValidator("param", EventTasksModel.Params), async (c, next) => {
	const event = c.get("event");
	const taskId = EventTasksModel.Params.shape.taskId.safeParse(c.req.param("taskId"));
	if (!taskId.success) return APIResponse.badRequest(c, "Invalid task id");

	const task = await DB.instance()
		.select()
		.from(DB.Tables.tasks)
		.where(
			and(
				inOrg(DB.Tables.tasks),
				eq(DB.Tables.tasks.id, taskId.data),
				eq(DB.Tables.tasks.event_id, event.id),
			),
		)
		.get();

	if (!task) return APIResponse.notFound(c, "Task not found");

	c.set("task", task);
	await next();
});

router.put(
	"/:taskId",

	APIRouteSpec.authenticated({
		summary: "Update event task",
		description:
			"Update a task. Leaders and the task's creator may change everything; the assignee and members of the assigned group may change the status.",
		tags: [DOCS_TAGS.EVENTS.TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Task updated successfully", EventTasksModel.Update.Response),
			APIResponseSpec.badRequest(
				"The assignee is not a staff member of this event / The group does not belong to this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Task not found"),
			APIResponseSpec.forbidden("You are not allowed to edit this task"),
		),
	}),

	zValidator("json", EventTasksModel.Update.Body),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const task = c.get("task");
		const body = c.req.valid("json") as EventTasksModel.Update.Body;

		if (!canEditFully(c, task)) {
			const groupIds = await getMyGroupIds(event.id, userId);
			const involved =
				task.assignee_id === userId || (task.group_id !== null && groupIds.includes(task.group_id));
			const onlyStatus = Object.entries(body).every(
				([key, value]) => key === "status" || value === undefined,
			);
			if (!involved || !onlyStatus) {
				return APIResponse.forbidden(c, "You are not allowed to edit this task");
			}
		}

		const refError = await validateRefs(event.id, body);
		if (refError) return APIResponse.badRequest(c, refError);

		const completedAt =
			body.status === undefined
				? task.completed_at
				: body.status === "done"
					? (task.completed_at ?? Date.now())
					: null;

		const updated = await DB.instance()
			.update(DB.Tables.tasks)
			.set({ ...body, completed_at: completedAt, updated_at: Date.now() })
			.where(and(inOrg(DB.Tables.tasks), eq(DB.Tables.tasks.id, task.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "task",
			entityId: task.id,
			summary:
				body.status && body.status !== task.status
					? `Aufgabe „${updated.title}“ auf „${STATUS_LABELS[body.status]}“ gesetzt`
					: `Aufgabe „${updated.title}“ bearbeitet`,
		});

		if (body.assignee_id && body.assignee_id !== task.assignee_id) {
			await Notifier.notify(
				[body.assignee_id],
				{
					type: "task_assigned",
					title: `Neue Aufgabe: ${updated.title}`,
					body: event.name,
					link: `/events/${event.id}/tasks`,
				},
				{ excludeUserId: userId },
			);
		}

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Task updated successfully", result!);
	},
);

router.delete(
	"/:taskId",

	APIRouteSpec.authenticated({
		summary: "Delete event task",
		description: "Delete a task. Allowed for leaders and the task's creator.",
		tags: [DOCS_TAGS.EVENTS.TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Task deleted successfully"),
			APIResponseSpec.notFound("Task not found"),
			APIResponseSpec.forbidden("You are not allowed to delete this task"),
		),
	}),

	async (c) => {
		const task = c.get("task");
		if (!canEditFully(c, task)) {
			return APIResponse.forbidden(c, "You are not allowed to delete this task");
		}

		await DB.instance()
			.delete(DB.Tables.tasks)
			.where(and(inOrg(DB.Tables.tasks), eq(DB.Tables.tasks.id, task.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "task",
			entityId: task.id,
			summary: `Aufgabe „${task.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Task deleted successfully");
	},
);
