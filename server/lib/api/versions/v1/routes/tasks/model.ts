import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../db";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../../../../db/schema";

export namespace PersonalTasksModel {
	export const EventRef = z.object({ id: z.number(), name: z.string() });
	export type EventRef = z.infer<typeof EventRef>;

	export const GroupRef = z.object({
		id: z.number(),
		name: z.string(),
		color: z.string().nullable(),
	});
	export type GroupRef = z.infer<typeof GroupRef>;

	export const Task = createSelectSchema(DB.Tables.tasks)
		.omit({ org_id: true })
		.extend({
			event: EventRef.nullable(),
			group: GroupRef.nullable(),
			/** `personal` = own to-do (editable here); `event` = edit via /events/{eventId}/tasks. */
			source: z.enum(["personal", "event"]),
			is_overdue: z.boolean(),
		});
	export type Task = z.infer<typeof Task>;

	export const Params = z.object({
		taskId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const TaskFields = {
		title: z.string().trim().min(1).max(200),
		description: z.string().max(10_000),
		status: z.enum(TASK_STATUSES),
		priority: z.enum(TASK_PRIORITIES),
		due_at: z.number().int().nullable(),
	};
}

export namespace PersonalTasksModel.GetAll {
	export const Query = z.object({
		/** `personal` = own to-dos, `assigned` = event tasks for me or my groups, `all` = both. */
		scope: z.enum(["all", "personal", "assigned"]).default("all"),
		include_done: z
			.enum(["true", "false"])
			.default("false")
			.transform((value) => value === "true"),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(PersonalTasksModel.Task);
	export type Response = z.infer<typeof Response>;
}

export namespace PersonalTasksModel.Create {
	export const Body = z.object({
		title: PersonalTasksModel.TaskFields.title,
		description: PersonalTasksModel.TaskFields.description.default(""),
		status: PersonalTasksModel.TaskFields.status.default("open"),
		priority: PersonalTasksModel.TaskFields.priority.default("normal"),
		due_at: PersonalTasksModel.TaskFields.due_at.default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = PersonalTasksModel.Task;
	export type Response = z.infer<typeof Response>;
}

export namespace PersonalTasksModel.Update {
	export const Body = z
		.object(PersonalTasksModel.TaskFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = PersonalTasksModel.Task;
	export type Response = z.infer<typeof Response>;
}
