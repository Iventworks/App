import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg } from "../../../../../../orgs/context";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventInsightsModel } from "./model";

export const router = new Hono<EventRouterEnv>().basePath("/:eventId");

const AGE_BUCKETS: { label: string; min: number; max: number }[] = [
	{ label: "unter 10", min: 0, max: 9 },
	{ label: "10–12", min: 10, max: 12 },
	{ label: "13–15", min: 13, max: 15 },
	{ label: "16–17", min: 16, max: 17 },
	{ label: "18–25", min: 18, max: 25 },
	{ label: "26+", min: 26, max: Number.POSITIVE_INFINITY },
];

function hasText(value: string | null | undefined) {
	return Boolean(value && value.trim().length > 0);
}

router.get(
	"/stats",

	APIRouteSpec.authenticated({
		summary: "Get event statistics",
		description:
			"Key figures of an event: participants (status, gender, age, fees, medical), staff, rooms, tasks, finances and program. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.INSIGHTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Statistics retrieved successfully", EventInsightsModel.Stats.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view the statistics of this event"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "stats:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view the statistics of this event");
		}

		const event = c.get("event");
		const db = DB.instance();

		const [participants, members, groupCounts, rooms, tasks, expenses, budgetItems, programItems] =
			await Promise.all([
				db
					.select()
					.from(DB.Tables.participants)
					.where(and(inOrg(DB.Tables.participants), eq(DB.Tables.participants.event_id, event.id)))
					.all(),
				db
					.select({ role: DB.Tables.eventMembers.role })
					.from(DB.Tables.eventMembers)
					.where(and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.event_id, event.id)))
					.all(),
				db
					.select({
						group_id: DB.Tables.eventGroups.id,
						name: DB.Tables.eventGroups.name,
						count: count(DB.Tables.eventGroupMembers.user_id),
					})
					.from(DB.Tables.eventGroups)
					.leftJoin(
						DB.Tables.eventGroupMembers,
						and(
							inOrg(DB.Tables.eventGroupMembers),
							eq(DB.Tables.eventGroupMembers.group_id, DB.Tables.eventGroups.id),
						),
					)
					.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.event_id, event.id)))
					.groupBy(DB.Tables.eventGroups.id)
					.all(),
				db
					.select({ capacity: DB.Tables.rooms.capacity })
					.from(DB.Tables.rooms)
					.where(and(inOrg(DB.Tables.rooms), eq(DB.Tables.rooms.event_id, event.id)))
					.all(),
				db
					.select({ status: DB.Tables.tasks.status, due_at: DB.Tables.tasks.due_at })
					.from(DB.Tables.tasks)
					.where(and(inOrg(DB.Tables.tasks), eq(DB.Tables.tasks.event_id, event.id)))
					.all(),
				db
					.select({
						status: DB.Tables.expenses.status,
						category: DB.Tables.expenses.category,
						amount_cents: DB.Tables.expenses.amount_cents,
					})
					.from(DB.Tables.expenses)
					.where(and(inOrg(DB.Tables.expenses), eq(DB.Tables.expenses.event_id, event.id)))
					.all(),
				db
					.select({
						kind: DB.Tables.budgetItems.kind,
						planned_cents: DB.Tables.budgetItems.planned_cents,
					})
					.from(DB.Tables.budgetItems)
					.where(and(inOrg(DB.Tables.budgetItems), eq(DB.Tables.budgetItems.event_id, event.id)))
					.all(),
				db
					.select({
						start_at: DB.Tables.programItems.start_at,
						end_at: DB.Tables.programItems.end_at,
					})
					.from(DB.Tables.programItems)
					.where(and(inOrg(DB.Tables.programItems), eq(DB.Tables.programItems.event_id, event.id)))
					.all(),
			]);

		const active = participants.filter((participant) => participant.status !== "cancelled");

		const byStatus = { registered: 0, confirmed: 0, waitlist: 0, cancelled: 0 };
		for (const participant of participants) byStatus[participant.status]++;

		const byGender: Record<string, number> = { female: 0, male: 0, diverse: 0, unknown: 0 };
		for (const participant of active) {
			const key = participant.gender ?? "unknown";
			byGender[key] = (byGender[key] ?? 0) + 1;
		}

		const ageBuckets = AGE_BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
		let unknownAge = 0;
		for (const participant of active) {
			const age = TimeUtils.ageOn(participant.birth_date, event.start_date);
			const index =
				age === null ? -1 : AGE_BUCKETS.findIndex((bucket) => age >= bucket.min && age <= bucket.max);
			if (index === -1) unknownAge++;
			else ageBuckets[index]!.count++;
		}
		if (unknownAge > 0) ageBuckets.push({ label: "unbekannt", count: unknownAge });

		const now = Date.now();
		const taskStats = { open: 0, in_progress: 0, done: 0, overdue: 0 };
		for (const task of tasks) {
			taskStats[task.status]++;
			if (task.status !== "done" && task.due_at !== null && task.due_at < now) taskStats.overdue++;
		}

		const expensesByStatus = { submitted: 0, approved: 0, rejected: 0, reimbursed: 0 };
		const byCategory = new Map<string, number>();
		for (const expense of expenses) {
			expensesByStatus[expense.status] += expense.amount_cents;
			if (expense.status === "approved" || expense.status === "reimbursed") {
				byCategory.set(
					expense.category,
					(byCategory.get(expense.category) ?? 0) + expense.amount_cents,
				);
			}
		}

		const scheduledMs = programItems.reduce(
			(sum, item) => sum + Math.max(0, item.end_at - item.start_at),
			0,
		);

		return APIResponse.success(c, "Statistics retrieved successfully", {
			participants: {
				total: active.length,
				by_status: byStatus,
				by_gender: byGender,
				age_buckets: ageBuckets,
				fee_paid: active.filter((participant) => participant.fee_paid).length,
				fee_open: active.filter((participant) => !participant.fee_paid).length,
				with_allergies: active.filter((participant) => hasText(participant.allergies)).length,
				with_medications: active.filter((participant) => hasText(participant.medications)).length,
				photo_consent: active.filter((participant) => participant.photo_consent).length,
			},
			staff: {
				total: members.length,
				leaders: members.filter((member) => member.role === "leader").length,
				by_group: groupCounts.sort((a, b) => a.name.localeCompare(b.name)),
			},
			rooms: {
				total: rooms.length,
				capacity: rooms.reduce((sum, room) => sum + (room.capacity ?? 0), 0),
				assigned_participants: active.filter((participant) => participant.room_id !== null).length,
				unassigned_participants: active.filter((participant) => participant.room_id === null).length,
			},
			tasks: taskStats,
			finances: {
				budget_cents: event.budget_cents,
				planned_expenses_cents: budgetItems
					.filter((item) => item.kind === "expense")
					.reduce((sum, item) => sum + item.planned_cents, 0),
				planned_income_cents: budgetItems
					.filter((item) => item.kind === "income")
					.reduce((sum, item) => sum + item.planned_cents, 0),
				expenses_by_status: expensesByStatus,
				expenses_by_category: [...byCategory.entries()]
					.map(([category, amount_cents]) => ({ category, amount_cents }))
					.sort((a, b) => b.amount_cents - a.amount_cents),
				expected_fees_cents: (event.participant_fee_cents ?? 0) * active.length,
			},
			program: {
				items: programItems.length,
				hours_scheduled: Math.round((scheduledMs / 3_600_000) * 10) / 10,
			},
		} satisfies EventInsightsModel.Stats.Response);
	},
);

router.get(
	"/audit-log",

	APIRouteSpec.authenticated({
		summary: "Get event audit log",
		description: "Who changed what in this event, newest first. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.INSIGHTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Audit log retrieved successfully",
				EventInsightsModel.AuditLog.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view the audit log of this event"),
		),
	}),

	zValidator("query", EventInsightsModel.AuditLog.Query),

	async (c) => {
		if (!EventAccess.can(c, "audit_log:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view the audit log of this event");
		}

		const event = c.get("event");
		const query = c.req.valid("query") as EventInsightsModel.AuditLog.Query;

		return APIResponse.success(
			c,
			"Audit log retrieved successfully",
			(await AuditLog.list(query, {
				eventId: event.id,
			})) satisfies EventInsightsModel.AuditLog.Response,
		);
	},
);
