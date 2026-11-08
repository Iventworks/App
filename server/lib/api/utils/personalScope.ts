import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { DB } from "../../db";

/**
 * Personal scope helpers shared by `/tasks`, `/dashboard` and `/calendar`: the caller's events,
 * groups and "todos from everything" (personal tasks + event tasks assigned to them or a group).
 */
export namespace PersonalScope {
	export interface Membership {
		event: DB.Models.Event;
		role: DB.Models.EventMember["role"];
	}

	export interface AggregatedTask {
		task: DB.Models.Task;
		event: { id: number; name: string } | null;
		group: { id: number; name: string; color: string | null } | null;
		source: "personal" | "event";
	}

	export const PRIORITY_RANK: Record<DB.Models.Task["priority"], number> = {
		urgent: 0,
		high: 1,
		normal: 2,
		low: 3,
	};

	/** Events the user is staff of (with their membership role). */
	export async function getMemberships(userId: number): Promise<Membership[]> {
		const rows = await DB.instance()
			.select({ event: DB.Tables.events, role: DB.Tables.eventMembers.role })
			.from(DB.Tables.eventMembers)
			.innerJoin(DB.Tables.events, eq(DB.Tables.events.id, DB.Tables.eventMembers.event_id))
			.where(eq(DB.Tables.eventMembers.user_id, userId))
			.all();
		return rows;
	}

	export async function getGroupIds(userId: number, eventIds: number[]) {
		if (eventIds.length === 0) return [];
		const rows = await DB.instance()
			.select({ id: DB.Tables.eventGroups.id })
			.from(DB.Tables.eventGroupMembers)
			.innerJoin(
				DB.Tables.eventGroups,
				eq(DB.Tables.eventGroups.id, DB.Tables.eventGroupMembers.group_id),
			)
			.where(
				and(
					eq(DB.Tables.eventGroupMembers.user_id, userId),
					inArray(DB.Tables.eventGroups.event_id, eventIds),
				),
			)
			.all();
		return rows.map((row) => row.id);
	}

	/**
	 * Personal tasks plus event tasks assigned to the user or one of their groups (only in events
	 * they are still staff of).
	 */
	export async function getTasks(
		userId: number,
		options: { scope?: "all" | "personal" | "assigned"; includeDone?: boolean } = {},
	): Promise<AggregatedTask[]> {
		const scope = options.scope ?? "all";
		const memberships = await getMemberships(userId);
		const eventIds = memberships.map((membership) => membership.event.id);
		const groupIds = await getGroupIds(userId, eventIds);

		const personal = and(isNull(DB.Tables.tasks.event_id), eq(DB.Tables.tasks.user_id, userId));
		const assignedTo = groupIds.length
			? or(eq(DB.Tables.tasks.assignee_id, userId), inArray(DB.Tables.tasks.group_id, groupIds))
			: eq(DB.Tables.tasks.assignee_id, userId);
		const assigned = eventIds.length
			? and(inArray(DB.Tables.tasks.event_id, eventIds), assignedTo)
			: undefined;

		const scopeCondition =
			scope === "personal" ? personal : scope === "assigned" ? assigned : or(personal, assigned);
		if (!scopeCondition) return [];

		const tasks = await DB.instance()
			.select()
			.from(DB.Tables.tasks)
			.where(and(scopeCondition, options.includeDone ? undefined : ne(DB.Tables.tasks.status, "done")))
			.all();

		const taskGroupIds = [
			...new Set(tasks.map((task) => task.group_id).filter((id): id is number => id !== null)),
		];
		const groups = taskGroupIds.length
			? await DB.instance()
					.select({
						id: DB.Tables.eventGroups.id,
						name: DB.Tables.eventGroups.name,
						color: DB.Tables.eventGroups.color,
					})
					.from(DB.Tables.eventGroups)
					.where(inArray(DB.Tables.eventGroups.id, taskGroupIds))
					.all()
			: [];

		return sortTasks(
			tasks.map((task) => {
				const membership = memberships.find((entry) => entry.event.id === task.event_id);
				return {
					task,
					event: membership ? { id: membership.event.id, name: membership.event.name } : null,
					group: groups.find((group) => group.id === task.group_id) ?? null,
					source: task.event_id === null ? ("personal" as const) : ("event" as const),
				};
			}),
		);
	}

	/** Overdue first, then due date (no due date last), then priority. Done tasks at the end. */
	export function sortTasks<T extends { task: DB.Models.Task }>(
		entries: T[],
		now: number = Date.now(),
	): T[] {
		const isOverdue = (task: DB.Models.Task) =>
			task.status !== "done" && task.due_at !== null && task.due_at < now;
		return [...entries].sort((a, b) => {
			const doneDiff = Number(a.task.status === "done") - Number(b.task.status === "done");
			if (doneDiff !== 0) return doneDiff;
			const overdueDiff = Number(isOverdue(b.task)) - Number(isOverdue(a.task));
			if (overdueDiff !== 0) return overdueDiff;
			const dueA = a.task.due_at ?? Number.POSITIVE_INFINITY;
			const dueB = b.task.due_at ?? Number.POSITIVE_INFINITY;
			if (dueA !== dueB) return dueA - dueB;
			const priorityDiff = PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
			if (priorityDiff !== 0) return priorityDiff;
			return a.task.id - b.task.id;
		});
	}
}
