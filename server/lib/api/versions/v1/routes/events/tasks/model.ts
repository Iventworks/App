import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventTasksModel {
	export const GroupRef = z.object({
		id: z.number(),
		name: z.string(),
		color: z.string().nullable(),
	});
	export type GroupRef = z.infer<typeof GroupRef>;

	export const Task = createSelectSchema(DB.Tables.tasks).extend({
		assignee: UserSummary.Schema.nullable(),
		creator: UserSummary.Schema.nullable(),
		group: GroupRef.nullable(),
		/** Whether the caller may edit all fields (leader or creator) or only the status. */
		can_edit: z.boolean(),
		can_delete: z.boolean(),
	});
	export type Task = z.infer<typeof Task>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		taskId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const TaskFields = {
		title: z.string().trim().min(1).max(200),
		description: z.string().max(10_000),
		status: z.enum(TASK_STATUSES),
		priority: z.enum(TASK_PRIORITIES),
		due_at: z.number().int().nullable(),
		assignee_id: z.number().int().positive().nullable(),
		group_id: z.number().int().positive().nullable(),
	};
}

export namespace EventTasksModel.GetAll {
	export const Query = z.object({
		/** `mine` = assigned to me or one of my groups; `open` = not done. */
		filter: z.enum(["all", "mine", "open"]).default("all"),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(EventTasksModel.Task);
	export type Response = z.infer<typeof Response>;
}

export namespace EventTasksModel.Create {
	export const Body = z.object({
		title: EventTasksModel.TaskFields.title,
		description: EventTasksModel.TaskFields.description.default(""),
		status: EventTasksModel.TaskFields.status.default("open"),
		priority: EventTasksModel.TaskFields.priority.default("normal"),
		due_at: EventTasksModel.TaskFields.due_at.default(null),
		assignee_id: EventTasksModel.TaskFields.assignee_id.default(null),
		group_id: EventTasksModel.TaskFields.group_id.default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventTasksModel.Task;
	export type Response = z.infer<typeof Response>;
}

export namespace EventTasksModel.Update {
	export const Body = z
		.object(EventTasksModel.TaskFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventTasksModel.Task;
	export type Response = z.infer<typeof Response>;
}
