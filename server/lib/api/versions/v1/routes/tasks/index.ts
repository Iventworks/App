import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PersonalScope } from "./aggregate";
import { PersonalTasksModel } from "./model";

type TasksEnv = { Variables: { task: DB.Models.Task } };

export const router = new Hono<TasksEnv>().basePath("/tasks");

router.use("*", requireOrgRole("volunteer"));

function toResponse(
	entry: PersonalScope.AggregatedTask,
	now = Date.now(),
): PersonalTasksModel.Task {
	return {
		...entry.task,
		event: entry.event,
		group: entry.group,
		source: entry.source,
		is_overdue: entry.task.status !== "done" && entry.task.due_at !== null && entry.task.due_at < now,
	};
}

function personal(task: DB.Models.Task): PersonalScope.AggregatedTask {
	return { task, event: null, group: null, source: "personal" };
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List my tasks",
		description:
			"All to-dos of the caller: personal tasks plus event tasks assigned to them or one of their groups. Overdue first, then by due date and priority.",
		tags: [DOCS_TAGS.PERSONAL.TASKS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Tasks retrieved successfully", PersonalTasksModel.GetAll.Response),
		),
	}),

	zValidator("query", PersonalTasksModel.GetAll.Query),

	async (c) => {
		const query = c.req.valid("query") as PersonalTasksModel.GetAll.Query;
		const tasks = await PersonalScope.getTasks(getAuthUserId(c), {
			scope: query.scope,
			includeDone: query.include_done,
		});
		const now = Date.now();
		return APIResponse.success(
			c,
			"Tasks retrieved successfully",
			tasks.map((entry) => toResponse(entry, now)),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create personal task",
		description: "Create a personal to-do only the caller can see.",
		tags: [DOCS_TAGS.PERSONAL.TASKS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Task created successfully", PersonalTasksModel.Create.Response),
		),
	}),

	zValidator("json", PersonalTasksModel.Create.Body),

	async (c) => {
		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as PersonalTasksModel.Create.Body;

		const task = await DB.instance()
			.insert(DB.Tables.tasks)
			.values({
				...body,
				event_id: null,
				user_id: userId,
				created_by: userId,
				completed_at: body.status === "done" ? Date.now() : null,
			})
			.returning()
			.get();

		return APIResponse.created(c, "Task created successfully", toResponse(personal(task)));
	},
);

router.use("/:taskId/*", zValidator("param", PersonalTasksModel.Params), async (c, next) => {
	const taskId = PersonalTasksModel.Params.shape.taskId.safeParse(c.req.param("taskId"));
	if (!taskId.success) return APIResponse.badRequest(c, "Invalid task id");

	// Only the caller's own personal tasks; event tasks are edited via /events/{eventId}/tasks.
	const task = await DB.instance()
		.select()
		.from(DB.Tables.tasks)
		.where(
			and(
				eq(DB.Tables.tasks.id, taskId.data),
				isNull(DB.Tables.tasks.event_id),
				eq(DB.Tables.tasks.user_id, getAuthUserId(c)),
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
		summary: "Update personal task",
		description: "Update one of the caller's personal tasks.",
		tags: [DOCS_TAGS.PERSONAL.TASKS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Task updated successfully", PersonalTasksModel.Update.Response),
			APIResponseSpec.notFound("Task not found"),
		),
	}),

	zValidator("json", PersonalTasksModel.Update.Body),

	async (c) => {
		const task = c.get("task");
		const body = c.req.valid("json") as PersonalTasksModel.Update.Body;

		const completedAt =
			body.status === undefined
				? task.completed_at
				: body.status === "done"
					? (task.completed_at ?? Date.now())
					: null;

		const updated = await DB.instance()
			.update(DB.Tables.tasks)
			.set({ ...body, completed_at: completedAt, updated_at: Date.now() })
			.where(eq(DB.Tables.tasks.id, task.id))
			.returning()
			.get();

		return APIResponse.success(c, "Task updated successfully", toResponse(personal(updated)));
	},
);

router.delete(
	"/:taskId",

	APIRouteSpec.authenticated({
		summary: "Delete personal task",
		description: "Delete one of the caller's personal tasks.",
		tags: [DOCS_TAGS.PERSONAL.TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Task deleted successfully"),
			APIResponseSpec.notFound("Task not found"),
		),
	}),

	async (c) => {
		const task = c.get("task");
		await DB.instance().delete(DB.Tables.tasks).where(eq(DB.Tables.tasks.id, task.id)).run();
		return APIResponse.successNoData(c, "Task deleted successfully");
	},
);
