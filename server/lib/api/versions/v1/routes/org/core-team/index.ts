import { and, count, desc, eq, inArray, like, ne } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { getAuthUserId } from "../../../../../utils/guards";
import { PermissionHelper } from "../../../../../utils/permissions";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { CoreTeamModel } from "./model";

type CoreTeamEnv = {
	Variables: { note: DB.Models.Note };
};

/** The core team's ("Kernteam") organisation-wide tools. */
export const router = new Hono<CoreTeamEnv>().basePath("/core-team");

const FORBIDDEN = "This area is restricted to the core team";
const ACTIVE_VOLUNTEER_ROLES = ["volunteer", "core_team", "admin"] as const;

function denied(c: Context, permission: PermissionHelper.OrgPermission) {
	return !PermissionHelper.can({ authContext: AuthHandler.AuthContext.get(c), permission });
}

async function loadEvents(year?: number) {
	return await DB.instance()
		.select()
		.from(DB.Tables.events)
		.where(year ? like(DB.Tables.events.start_date, `${year}-%`) : undefined)
		.orderBy(desc(DB.Tables.events.start_date))
		.all();
}

/** Non-cancelled participants of the given events (only the columns the statistics need). */
async function loadParticipants(eventIds: number[]) {
	if (eventIds.length === 0) return [];
	return await DB.instance()
		.select({
			event_id: DB.Tables.participants.event_id,
			first_name: DB.Tables.participants.first_name,
			last_name: DB.Tables.participants.last_name,
			birth_date: DB.Tables.participants.birth_date,
			gender: DB.Tables.participants.gender,
		})
		.from(DB.Tables.participants)
		.where(
			and(
				inArray(DB.Tables.participants.event_id, eventIds),
				ne(DB.Tables.participants.status, "cancelled"),
			),
		)
		.all();
}

async function loadMembers(eventIds: number[]) {
	if (eventIds.length === 0) return [];
	return await DB.instance()
		.select()
		.from(DB.Tables.eventMembers)
		.where(inArray(DB.Tables.eventMembers.event_id, eventIds))
		.all();
}

async function toEventSummaries(events: DB.Models.Event[]): Promise<CoreTeamModel.EventSummary[]> {
	const ids = events.map((event) => event.id);
	const [members, participants] = await Promise.all([loadMembers(ids), loadParticipants(ids)]);

	return events.map((event) => ({
		id: event.id,
		name: event.name,
		type: event.type,
		status: event.status,
		start_date: event.start_date,
		end_date: event.end_date,
		color: event.color,
		staff_count: members.filter((member) => member.event_id === event.id).length,
		participant_count: participants.filter((entry) => entry.event_id === event.id).length,
	}));
}

function overlaps(a: { start_date: string; end_date: string }, b: typeof a) {
	return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

router.get(
	"/overview",

	APIRouteSpec.authenticated({
		summary: "Get core team overview",
		description:
			"Organisation dashboard for the core team: running and upcoming events (incl. unstaffed ones), totals, pending expenses and accounts waiting for activation.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Overview retrieved successfully", CoreTeamModel.Overview.Response),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		if (denied(c, "core_team:space")) return APIResponse.forbidden(c, FORBIDDEN);

		const db = DB.instance();
		const today = TimeUtils.today();
		const events = await loadEvents();

		const eventsByStatus = { planning: 0, confirmed: 0, cancelled: 0, archived: 0 };
		for (const event of events) eventsByStatus[event.status]++;

		const active = (event: DB.Models.Event) =>
			event.status === "planning" || event.status === "confirmed";

		const running = events.filter(
			(event) => active(event) && event.start_date <= today && today <= event.end_date,
		);
		const upcoming = events
			.filter((event) => active(event) && event.start_date > today)
			.sort((a, b) => a.start_date.localeCompare(b.start_date))
			.slice(0, 5);

		const [runningSummaries, upcomingSummaries] = await Promise.all([
			toEventSummaries(running),
			toEventSummaries(upcoming),
		]);

		const leaderRows = upcoming.length
			? await db
					.select()
					.from(DB.Tables.eventMembers)
					.where(
						and(
							inArray(
								DB.Tables.eventMembers.event_id,
								upcoming.map((event) => event.id),
							),
							eq(DB.Tables.eventMembers.role, "leader"),
						),
					)
					.all()
			: [];
		const leaderUsers = await UserSummary.fetchMap(leaderRows.map((row) => row.user_id));

		const participantsTotal =
			(
				await db
					.select({ value: count() })
					.from(DB.Tables.participants)
					.where(ne(DB.Tables.participants.status, "cancelled"))
					.get()
			)?.value ?? 0;

		const volunteers =
			(
				await db
					.select({ value: count() })
					.from(DB.Tables.users)
					.where(inArray(DB.Tables.users.role, [...ACTIVE_VOLUNTEER_ROLES]))
					.get()
			)?.value ?? 0;

		const unverified =
			(
				await db
					.select({ value: count() })
					.from(DB.Tables.users)
					.where(eq(DB.Tables.users.role, "unverified"))
					.get()
			)?.value ?? 0;

		const pending = await db
			.select({ amount_cents: DB.Tables.expenses.amount_cents })
			.from(DB.Tables.expenses)
			.where(eq(DB.Tables.expenses.status, "submitted"))
			.all();

		return APIResponse.success(c, "Overview retrieved successfully", {
			events_by_status: eventsByStatus,
			running_events: runningSummaries,
			upcoming_events: upcomingSummaries.map((summary) => {
				const leaders = leaderRows
					.filter((row) => row.event_id === summary.id)
					.map((row) => leaderUsers.get(row.user_id))
					.filter((user): user is UserSummary.Schema => Boolean(user));
				return { ...summary, leaders, unstaffed: leaders.length === 0 };
			}),
			totals: {
				events: events.length,
				participants: participantsTotal,
				volunteers,
			},
			pending_expenses: {
				count: pending.length,
				amount_cents: pending.reduce((sum, row) => sum + row.amount_cents, 0),
			},
			unverified_users: unverified,
		} satisfies CoreTeamModel.Overview.Response);
	},
);

router.get(
	"/finances",

	APIRouteSpec.authenticated({
		summary: "Get organisation finances",
		description:
			"Budget, planned and actual figures for every event (optionally of one year), with totals and actual expenses by category.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Finances retrieved successfully", CoreTeamModel.Finances.Response),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("query", CoreTeamModel.Finances.Query),

	async (c) => {
		if (denied(c, "org_finances:read")) return APIResponse.forbidden(c, FORBIDDEN);

		const { year } = c.req.valid("query") as CoreTeamModel.Finances.Query;
		const events = await loadEvents(year);
		const ids = events.map((event) => event.id);

		const [budgetItems, expenses, participants] = ids.length
			? await Promise.all([
					DB.instance()
						.select()
						.from(DB.Tables.budgetItems)
						.where(inArray(DB.Tables.budgetItems.event_id, ids))
						.all(),
					DB.instance()
						.select()
						.from(DB.Tables.expenses)
						.where(inArray(DB.Tables.expenses.event_id, ids))
						.all(),
					loadParticipants(ids),
				])
			: [[], [], []];

		const sum = <T>(rows: T[], pick: (row: T) => number) =>
			rows.reduce((total, row) => total + pick(row), 0);

		const perEvent = events.map((event) => {
			const items = budgetItems.filter((item) => item.event_id === event.id);
			const eventExpenses = expenses.filter((expense) => expense.event_id === event.id);
			const participantCount = participants.filter((entry) => entry.event_id === event.id).length;

			return {
				event: {
					id: event.id,
					name: event.name,
					start_date: event.start_date,
					status: event.status,
				},
				budget_cents: event.budget_cents,
				planned_expense_cents: sum(
					items.filter((item) => item.kind === "expense"),
					(item) => item.planned_cents,
				),
				planned_income_cents: sum(
					items.filter((item) => item.kind === "income"),
					(item) => item.planned_cents,
				),
				expected_fees_cents: (event.participant_fee_cents ?? 0) * participantCount,
				actual_expense_cents: sum(
					eventExpenses.filter(
						(expense) => expense.status === "approved" || expense.status === "reimbursed",
					),
					(expense) => expense.amount_cents,
				),
				pending_expense_cents: sum(
					eventExpenses.filter((expense) => expense.status === "submitted"),
					(expense) => expense.amount_cents,
				),
				reimbursed_cents: sum(
					eventExpenses.filter((expense) => expense.status === "reimbursed"),
					(expense) => expense.amount_cents,
				),
			} satisfies CoreTeamModel.Finances.EventFinances;
		});

		const totals = {
			budget_cents: sum(perEvent, (row) => row.budget_cents),
			planned_expense_cents: sum(perEvent, (row) => row.planned_expense_cents),
			planned_income_cents: sum(perEvent, (row) => row.planned_income_cents),
			expected_fees_cents: sum(perEvent, (row) => row.expected_fees_cents),
			actual_expense_cents: sum(perEvent, (row) => row.actual_expense_cents),
			pending_expense_cents: sum(perEvent, (row) => row.pending_expense_cents),
			reimbursed_cents: sum(perEvent, (row) => row.reimbursed_cents),
		};

		const byCategory = new Map<string, number>();
		for (const expense of expenses) {
			if (expense.status !== "approved" && expense.status !== "reimbursed") continue;
			byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount_cents);
		}

		return APIResponse.success(c, "Finances retrieved successfully", {
			per_event: perEvent,
			totals,
			by_category: [...byCategory.entries()]
				.map(([category, actual_cents]) => ({ category, actual_cents }))
				.sort((a, b) => b.actual_cents - a.actual_cents),
		} satisfies CoreTeamModel.Finances.Response);
	},
);

const AGE_BUCKETS: { label: string; min: number; max: number }[] = [
	{ label: "unter 10", min: 0, max: 9 },
	{ label: "10–12", min: 10, max: 12 },
	{ label: "13–15", min: 13, max: 15 },
	{ label: "16–17", min: 16, max: 17 },
	{ label: "18–25", min: 18, max: 25 },
	{ label: "26+", min: 26, max: Number.POSITIVE_INFINITY },
];

router.get(
	"/stats",

	APIRouteSpec.authenticated({
		summary: "Get organisation statistics",
		description:
			"Participant and staff statistics across all events (optionally of one year): participants per event, age and gender distribution, staff engagement and returning participants.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Statistics retrieved successfully", CoreTeamModel.Stats.Response),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("query", CoreTeamModel.Stats.Query),

	async (c) => {
		if (denied(c, "org_stats:read")) return APIResponse.forbidden(c, FORBIDDEN);

		const { year } = c.req.valid("query") as CoreTeamModel.Stats.Query;
		const events = await loadEvents(year);
		const ids = events.map((event) => event.id);
		const [participants, members] = await Promise.all([loadParticipants(ids), loadMembers(ids)]);

		const startDates = new Map(events.map((event) => [event.id, event.start_date]));

		const ageCounts = new Map<string, number>(AGE_BUCKETS.map((bucket) => [bucket.label, 0]));
		let unknownAge = 0;
		const gender = { female: 0, male: 0, diverse: 0, unknown: 0 };
		const peopleEvents = new Map<string, Set<number>>();

		for (const participant of participants) {
			const age = TimeUtils.ageOn(participant.birth_date, startDates.get(participant.event_id)!);
			const bucket = age === null ? undefined : AGE_BUCKETS.find((b) => age >= b.min && age <= b.max);
			if (bucket) ageCounts.set(bucket.label, (ageCounts.get(bucket.label) ?? 0) + 1);
			else unknownAge++;

			gender[participant.gender ?? "unknown"]++;

			if (participant.birth_date) {
				const key = [
					participant.first_name.trim().toLowerCase(),
					participant.last_name.trim().toLowerCase(),
					participant.birth_date,
				].join("|");
				const set = peopleEvents.get(key) ?? new Set<number>();
				set.add(participant.event_id);
				peopleEvents.set(key, set);
			}
		}

		const engagement = new Map<number, { events: Set<number>; leader: number }>();
		for (const member of members) {
			const entry = engagement.get(member.user_id) ?? { events: new Set<number>(), leader: 0 };
			entry.events.add(member.event_id);
			if (member.role === "leader") entry.leader++;
			engagement.set(member.user_id, entry);
		}
		const topEngaged = [...engagement.entries()]
			.sort(([, a], [, b]) => b.events.size - a.events.size || b.leader - a.leader)
			.slice(0, 20);
		const users = await UserSummary.fetchMap(topEngaged.map(([userId]) => userId));

		return APIResponse.success(c, "Statistics retrieved successfully", {
			events_count: events.length,
			participants_total: participants.length,
			participants_by_event: events.map((event) => ({
				event_id: event.id,
				name: event.name,
				start_date: event.start_date,
				count: participants.filter((entry) => entry.event_id === event.id).length,
			})),
			age_buckets: [
				...AGE_BUCKETS.map((bucket) => ({
					label: bucket.label,
					count: ageCounts.get(bucket.label) ?? 0,
				})),
				{ label: "unbekannt", count: unknownAge },
			],
			gender,
			staff_engagement: topEngaged
				.map(([userId, entry]) => ({
					user: users.get(userId),
					events_count: entry.events.size,
					leader_count: entry.leader,
				}))
				.filter((entry): entry is CoreTeamModel.Stats.Response["staff_engagement"][number] =>
					Boolean(entry.user),
				),
			returning_participants: [...peopleEvents.values()].filter((set) => set.size > 1).length,
		} satisfies CoreTeamModel.Stats.Response);
	},
);

router.get(
	"/staff-planning",

	APIRouteSpec.authenticated({
		summary: "Get staff planning",
		description:
			"Which volunteers are assigned to which events in a date range (default: today + 180 days), with overlapping assignments and volunteers without any assignment.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Staff planning retrieved successfully",
				CoreTeamModel.StaffPlanning.Response,
			),
			APIResponseSpec.badRequest(
				"`from` must not be after `to` / Syntax or validation error in request",
			),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("query", CoreTeamModel.StaffPlanning.Query),

	async (c) => {
		if (denied(c, "core_team:space")) return APIResponse.forbidden(c, FORBIDDEN);

		const query = c.req.valid("query") as CoreTeamModel.StaffPlanning.Query;
		const from = query.from ?? TimeUtils.today();
		const to = query.to ?? TimeUtils.addDays(from, 180);
		if (from > to) return APIResponse.badRequest(c, "`from` must not be after `to`");

		const events = (await loadEvents())
			.filter((event) => event.status !== "cancelled")
			.filter((event) => overlaps(event, { start_date: from, end_date: to }))
			.sort((a, b) => a.start_date.localeCompare(b.start_date));
		const eventById = new Map(events.map((event) => [event.id, event]));

		const members = await loadMembers(events.map((event) => event.id));

		const volunteers = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(inArray(DB.Tables.users.role, [...ACTIVE_VOLUNTEER_ROLES]))
			.all();

		const users: CoreTeamModel.StaffPlanning.Response["users"] = [];
		const unassigned: UserSummary.Schema[] = [];

		for (const user of volunteers.sort((a, b) => a.display_name.localeCompare(b.display_name))) {
			const assignments = members
				.filter((member) => member.user_id === user.id)
				.map((member) => ({ event_id: member.event_id, role: member.role }));

			if (assignments.length === 0) {
				unassigned.push(UserSummary.from(user));
				continue;
			}

			const conflicts: [number, number][] = [];
			for (let i = 0; i < assignments.length; i++) {
				for (let j = i + 1; j < assignments.length; j++) {
					const a = eventById.get(assignments[i]!.event_id)!;
					const b = eventById.get(assignments[j]!.event_id)!;
					if (overlaps(a, b)) conflicts.push([a.id, b.id]);
				}
			}

			users.push({ user: UserSummary.from(user), assignments, conflicts });
		}

		return APIResponse.success(c, "Staff planning retrieved successfully", {
			from,
			to,
			events: events.map((event) => ({
				id: event.id,
				name: event.name,
				start_date: event.start_date,
				end_date: event.end_date,
				color: event.color,
			})),
			users,
			unassigned_users: unassigned,
		} satisfies CoreTeamModel.StaffPlanning.Response);
	},
);

// --- Core team notes ---------------------------------------------------------------------------

async function toNoteResponse(
	c: Context,
	notes: DB.Models.Note[],
): Promise<CoreTeamModel.Notes.Note[]> {
	const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
	const users = await UserSummary.fetchMap(
		notes.flatMap((note) => [note.created_by, note.updated_by]),
	);

	return notes.map((note) => ({
		...note,
		creator: note.created_by ? (users.get(note.created_by) ?? null) : null,
		updater: note.updated_by ? (users.get(note.updated_by) ?? null) : null,
		can_delete: note.created_by === authContext.user_id || authContext.user_role === "admin",
	}));
}

router.get(
	"/notes",

	APIRouteSpec.authenticated({
		summary: "List core team notes",
		description: "The core team's internal notes, pinned first, then most recently edited.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Notes retrieved successfully", CoreTeamModel.Notes.GetAllResponse),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	async (c) => {
		if (denied(c, "core_team:space")) return APIResponse.forbidden(c, FORBIDDEN);

		const notes = await DB.instance()
			.select()
			.from(DB.Tables.notes)
			.where(eq(DB.Tables.notes.scope, "core_team"))
			.orderBy(desc(DB.Tables.notes.pinned), desc(DB.Tables.notes.updated_at))
			.all();

		return APIResponse.success(c, "Notes retrieved successfully", await toNoteResponse(c, notes));
	},
);

router.post(
	"/notes",

	APIRouteSpec.authenticated({
		summary: "Create core team note",
		description: "Create an internal note visible to the whole core team.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Note created successfully", CoreTeamModel.Notes.Note),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", CoreTeamModel.Notes.CreateBody),

	async (c) => {
		if (denied(c, "core_team:space")) return APIResponse.forbidden(c, FORBIDDEN);

		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as CoreTeamModel.Notes.CreateBody;

		const note = await DB.instance()
			.insert(DB.Tables.notes)
			.values({ ...body, scope: "core_team", created_by: userId, updated_by: userId })
			.returning()
			.get();

		await AuditLog.record({
			userId,
			action: "create",
			entityType: "note",
			entityId: note.id,
			summary: `Kernteam-Notiz „${note.title}“ angelegt`,
		});

		const [result] = await toNoteResponse(c, [note]);
		return APIResponse.created(c, "Note created successfully", result!);
	},
);

router.use("/notes/:noteId/*", zValidator("param", CoreTeamModel.Notes.Params), async (c, next) => {
	if (denied(c, "core_team:space")) return APIResponse.forbidden(c, FORBIDDEN);

	const noteId = CoreTeamModel.Notes.Params.shape.noteId.safeParse(c.req.param("noteId"));
	if (!noteId.success) return APIResponse.badRequest(c, "Invalid note id");

	const note = await DB.instance()
		.select()
		.from(DB.Tables.notes)
		.where(and(eq(DB.Tables.notes.id, noteId.data), eq(DB.Tables.notes.scope, "core_team")))
		.get();

	if (!note) return APIResponse.notFound(c, "Note not found");

	c.set("note", note);
	await next();
});

router.put(
	"/notes/:noteId",

	APIRouteSpec.authenticated({
		summary: "Update core team note",
		description: "Edit an internal core team note (any core team member).",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Note updated successfully", CoreTeamModel.Notes.Note),
			APIResponseSpec.forbidden(FORBIDDEN),
			APIResponseSpec.notFound("Note not found"),
		),
	}),

	zValidator("json", CoreTeamModel.Notes.UpdateBody),

	async (c) => {
		const note = c.get("note");
		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as CoreTeamModel.Notes.UpdateBody;

		const updated = await DB.instance()
			.update(DB.Tables.notes)
			.set({ ...body, updated_by: userId, updated_at: Date.now() })
			.where(eq(DB.Tables.notes.id, note.id))
			.returning()
			.get();

		await AuditLog.record({
			userId,
			action: "update",
			entityType: "note",
			entityId: note.id,
			summary: `Kernteam-Notiz „${updated.title}“ bearbeitet`,
		});

		const [result] = await toNoteResponse(c, [updated]);
		return APIResponse.success(c, "Note updated successfully", result!);
	},
);

router.delete(
	"/notes/:noteId",

	APIRouteSpec.authenticated({
		summary: "Delete core team note",
		description: "Delete an internal core team note. Allowed for its creator and admins.",
		tags: [DOCS_TAGS.ORG.CORE_TEAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Note deleted successfully"),
			APIResponseSpec.forbidden("Only the creator or an admin can delete this note"),
			APIResponseSpec.notFound("Note not found"),
		),
	}),

	async (c) => {
		const note = c.get("note");
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;

		if (note.created_by !== authContext.user_id && authContext.user_role !== "admin") {
			return APIResponse.forbidden(c, "Only the creator or an admin can delete this note");
		}

		await DB.instance().delete(DB.Tables.notes).where(eq(DB.Tables.notes.id, note.id)).run();

		await AuditLog.record({
			userId: authContext.user_id,
			action: "delete",
			entityType: "note",
			entityId: note.id,
			summary: `Kernteam-Notiz „${note.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Note deleted successfully");
	},
);
