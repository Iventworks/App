import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { Notifier } from "../../../../../utils/notifications";
import { Occurrences } from "../../../../../utils/occurrences";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventOccurrencesModel } from "./model";

type OccurrencesEnv = {
	Variables: EventRouterEnv["Variables"] & {
		occurrence: DB.Models.EventOccurrence;
		responsibility: DB.Models.Responsibility;
	};
};

/** The dates ("Termine") of a recurring event and its duty roster ("Dienstplan"). */
export const router = new Hono<OccurrencesEnv>().basePath("/:eventId/occurrences");

const NOT_RECURRING = "Only recurring events have dates";

router.use("*", async (c, next) => {
	if (c.get("event").type !== "recurring") return APIResponse.badRequest(c, NOT_RECURRING);
	await next();
});

const dayFormatter = new Intl.DateTimeFormat("de-DE", {
	weekday: "short",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	timeZone: "UTC",
});

/** `Fr., 14.03.2027` */
function formatDay(date: string) {
	return dayFormatter.format(new Date(`${date}T00:00:00Z`));
}

function occurrencesLink(event: DB.Models.Event) {
	return `/events/${event.id}/occurrences`;
}

/** The ids among `userIds` that are staff of the event. */
async function staffIds(eventId: number, userIds?: number[]) {
	if (userIds && userIds.length === 0) return new Set<number>();
	const rows = await DB.instance()
		.select({ user_id: DB.Tables.eventMembers.user_id })
		.from(DB.Tables.eventMembers)
		.where(
			and(
				inOrg(DB.Tables.eventMembers),
				eq(DB.Tables.eventMembers.event_id, eventId),
				userIds ? inArray(DB.Tables.eventMembers.user_id, userIds) : undefined,
			),
		)
		.all();
	return new Set(rows.map((row) => row.user_id));
}

/** The event's responsibilities with the people who usually do them (ids, by name). */
async function loadResponsibilities(eventId: number) {
	const responsibilities = await DB.instance()
		.select()
		.from(DB.Tables.responsibilities)
		.where(and(inOrg(DB.Tables.responsibilities), eq(DB.Tables.responsibilities.event_id, eventId)))
		.orderBy(asc(DB.Tables.responsibilities.title))
		.all();
	const assignments = responsibilities.length
		? await DB.instance()
				.select()
				.from(DB.Tables.responsibilityAssignees)
				.where(
					and(
						inOrg(DB.Tables.responsibilityAssignees),
						inArray(
							DB.Tables.responsibilityAssignees.responsibility_id,
							responsibilities.map((entry) => entry.id),
						),
					),
				)
				.all()
		: [];
	const users = await UserSummary.fetchMap(assignments.map((entry) => entry.user_id));

	return responsibilities.map((responsibility) => ({
		id: responsibility.id,
		title: responsibility.title,
		assignees: assignments
			.filter((entry) => entry.responsibility_id === responsibility.id)
			.map((entry) => users.get(entry.user_id))
			.filter((user): user is UserSummary.Schema => Boolean(user))
			.sort((a, b) => a.display_name.localeCompare(b.display_name, "de")),
	}));
}

async function respond(
	occurrence: DB.Models.EventOccurrence,
	event: DB.Models.Event,
	userId: number,
) {
	const [result] = await Occurrences.toResponse([occurrence], event, userId);
	return result!;
}

/** Replace who covers a responsibility on a date. Returns the people who are new on it. */
async function replaceDuty(
	occurrenceId: number,
	responsibilityId: number,
	userIds: number[],
	tx: DrizzleDB = DB.instance(),
) {
	const table = DB.Tables.occurrenceDuties;
	const scope = and(
		inOrg(table),
		eq(table.occurrence_id, occurrenceId),
		eq(table.responsibility_id, responsibilityId),
	);
	const before = new Set(
		(await tx.select().from(table).where(scope).all()).map((row) => row.user_id),
	);
	const wanted = [...new Set(userIds)];

	await tx.delete(table).where(scope).run();
	if (wanted.length) {
		await tx
			.insert(table)
			.values(
				wanted.map((user_id) => ({
					org_id: OrgContext.id(),
					occurrence_id: occurrenceId,
					responsibility_id: responsibilityId,
					user_id,
				})),
			)
			.run();
	}
	return wanted.filter((id) => !before.has(id));
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List dates",
		description:
			"The dates of a recurring event, ascending, each with its time and place (its own or the series'), topic, status and who is on duty — plus the event's responsibilities, the columns of the duty roster. `from`/`to` limit the range.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Dates retrieved successfully", EventOccurrencesModel.GetAll.Response),
			APIResponseSpec.badRequest(`${NOT_RECURRING} / Syntax or validation error in request`),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view the dates"),
		),
	}),

	zValidator("query", EventOccurrencesModel.GetAll.Query),

	async (c) => {
		if (!EventAccess.can(c, "occurrences:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view the dates");
		}

		const event = c.get("event");
		const range = c.req.valid("query") as EventOccurrencesModel.GetAll.Query;
		const occurrences = await Occurrences.list(event.id, range);

		return APIResponse.success(c, "Dates retrieved successfully", {
			occurrences: await Occurrences.toResponse(occurrences, event, c.get("eventAccess").userId),
			responsibilities: await loadResponsibilities(event.id),
		} satisfies EventOccurrencesModel.GetAll.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Add date",
		description:
			"Add a single date to a recurring event by hand — an extra one, or the replacement for a cancelled one. It stays when the recurrence changes.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Date added successfully", EventOccurrencesModel.Create.Response),
			APIResponseSpec.badRequest(
				`${NOT_RECURRING} / end_time must be after start_time / Syntax or validation error in request`,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the dates"),
		),
	}),

	zValidator("json", EventOccurrencesModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "occurrences:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the dates");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventOccurrencesModel.Create.Body;

		// An end without a start has nothing to end.
		const endTime = body.start_time ? body.end_time : null;
		if (body.start_time && endTime && endTime <= body.start_time) {
			return APIResponse.badRequest(c, "end_time must be after start_time");
		}

		const created = await DB.instance()
			.insert(DB.Tables.eventOccurrences)
			.values({
				org_id: OrgContext.id(),
				event_id: event.id,
				date: body.date,
				start_time: body.start_time,
				end_time: endTime,
				location: body.location || null,
				title: body.title || null,
				notes: body.notes,
				origin: "manual",
			})
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "occurrence",
			entityId: created.id,
			summary: `Termin am ${formatDay(created.date)} hinzugefügt`,
		});

		return APIResponse.created(c, "Date added successfully", await respond(created, event, userId));
	},
);

router.post(
	"/plan",

	APIRouteSpec.authenticated({
		summary: "Fill duty roster",
		description:
			"Fill the duty roster of all upcoming dates from the people who usually do each responsibility (its assignees): `standard` puts all of them on every date, `rotate` lets them take turns. Duties that are already filled stay unless `overwrite` is set.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Duty roster filled successfully", EventOccurrencesModel.Plan.Response),
			APIResponseSpec.badRequest(`${NOT_RECURRING} / Syntax or validation error in request`),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the dates"),
		),
	}),

	zValidator("json", EventOccurrencesModel.Plan.Body),

	async (c) => {
		if (!EventAccess.can(c, "occurrences:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the dates");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventOccurrencesModel.Plan.Body;

		const staff = await staffIds(event.id);
		const responsibilities = (await loadResponsibilities(event.id))
			.filter((entry) => !body.responsibility_ids || body.responsibility_ids.includes(entry.id))
			.map((entry) => ({
				id: entry.id,
				// Only people who are (still) on the team.
				pool: entry.assignees.map((user) => user.id).filter((id) => staff.has(id)),
			}))
			.filter((entry) => entry.pool.length > 0);

		const all = await Occurrences.list(event.id);
		const today = TimeUtils.today();
		const upcoming = all.filter(
			(occurrence) => occurrence.status === "planned" && occurrence.date >= today,
		);
		const duties = await Occurrences.duties(all.map((occurrence) => occurrence.id));
		const usersOn = (occurrenceId: number, responsibilityId: number) =>
			duties
				.filter(
					(duty) => duty.occurrence_id === occurrenceId && duty.responsibility_id === responsibilityId,
				)
				.map((duty) => duty.user_id);

		const touched = new Set<number>();
		const datesPerUser = new Map<number, Set<number>>();
		let count = 0;

		await DB.instance().transaction(async (tx: DrizzleDB) => {
			for (const responsibility of responsibilities) {
				const { pool } = responsibility;

				// Taking turns continues after whoever had the last date before today.
				let turn = 0;
				if (body.mode === "rotate") {
					const previous = all
						.filter((occurrence) => occurrence.date < today)
						.map((occurrence) => usersOn(occurrence.id, responsibility.id))
						.findLast((users) => users.length === 1 && pool.includes(users[0]!));
					if (previous) turn = pool.indexOf(previous[0]!) + 1;
				}

				for (const occurrence of upcoming) {
					const current = usersOn(occurrence.id, responsibility.id);
					if (current.length > 0 && !body.overwrite) {
						// Keep the rotation in step with what is already planned.
						if (body.mode === "rotate" && current.length === 1 && pool.includes(current[0]!)) {
							turn = pool.indexOf(current[0]!) + 1;
						}
						continue;
					}

					const users = body.mode === "standard" ? pool : [pool[turn++ % pool.length]!];
					const added = await replaceDuty(occurrence.id, responsibility.id, users, tx);
					count += users.length;
					touched.add(occurrence.id);
					for (const id of added) {
						const dates = datesPerUser.get(id) ?? new Set<number>();
						dates.add(occurrence.id);
						datesPerUser.set(id, dates);
					}
				}
			}
		});

		if (touched.size > 0) {
			await AuditLog.record({
				userId,
				eventId: event.id,
				action: "assign",
				entityType: "occurrence",
				summary: `Dienstplan für ${touched.size} Termin(e) ${body.mode === "rotate" ? "im Wechsel" : "mit der Standardbesetzung"} gefüllt`,
				metadata: { mode: body.mode, overwrite: body.overwrite, duties: count },
			});
		}

		// One notification per person, however many dates they got.
		for (const [id, dates] of datesPerUser) {
			await Notifier.notify(
				[id],
				{
					type: "occurrence_assigned",
					title:
						dates.size === 1
							? "Du wurdest für einen Termin eingeteilt"
							: `Du wurdest für ${dates.size} Termine eingeteilt`,
					body: event.name,
					link: occurrencesLink(event),
				},
				{ excludeUserId: userId },
			);
		}

		return APIResponse.success(c, "Duty roster filled successfully", {
			occurrences: touched.size,
			duties: count,
		} satisfies EventOccurrencesModel.Plan.Response);
	},
);

router.use(
	"/:occurrenceId/*",
	zValidator("param", EventOccurrencesModel.Params),
	async (c, next) => {
		const occurrenceId = EventOccurrencesModel.Params.shape.occurrenceId.safeParse(
			c.req.param("occurrenceId"),
		);
		if (!occurrenceId.success) return APIResponse.badRequest(c, "Invalid date id");

		const occurrence = await Occurrences.get(c.get("event").id, occurrenceId.data);
		if (!occurrence) return APIResponse.notFound(c, "Date not found");

		c.set("occurrence", occurrence);
		await next();
	},
);

router.put(
	"/:occurrenceId",

	APIRouteSpec.authenticated({
		summary: "Update date",
		description:
			"Change one date: its topic and notes, its own time or place (`null` = as the series), or cancel it (`status: cancelled` with an optional `cancel_reason`; the people on duty are notified). Only dates added by hand can be moved to another day.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Date updated successfully", EventOccurrencesModel.Update.Response),
			APIResponseSpec.badRequest(
				"Only dates added by hand can be moved / end_time must be after start_time / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Date not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the dates"),
		),
	}),

	zValidator("json", EventOccurrencesModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "occurrences:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the dates");
		}

		const event = c.get("event");
		const occurrence = c.get("occurrence");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventOccurrencesModel.Update.Body;

		if (body.date !== undefined && body.date !== occurrence.date && occurrence.origin !== "manual") {
			return APIResponse.badRequest(c, "Only dates added by hand can be moved");
		}

		// The date's own time: without a start there is no end either.
		const startTime = body.start_time !== undefined ? body.start_time : occurrence.start_time;
		const endTime = startTime
			? body.end_time !== undefined
				? body.end_time
				: occurrence.end_time
			: null;
		if (startTime && endTime && endTime <= startTime) {
			return APIResponse.badRequest(c, "end_time must be after start_time");
		}

		const status = body.status ?? occurrence.status;
		const updated = await DB.instance()
			.update(DB.Tables.eventOccurrences)
			.set({
				...(body.date !== undefined ? { date: body.date } : {}),
				start_time: startTime,
				end_time: endTime,
				...(body.location !== undefined ? { location: body.location || null } : {}),
				...(body.title !== undefined ? { title: body.title || null } : {}),
				...(body.notes !== undefined ? { notes: body.notes } : {}),
				status,
				// A reason only makes sense while the date is cancelled.
				cancel_reason:
					status === "cancelled"
						? body.cancel_reason !== undefined
							? body.cancel_reason || null
							: occurrence.cancel_reason
						: null,
				updated_at: Date.now(),
			})
			.where(and(inOrg(DB.Tables.eventOccurrences), eq(DB.Tables.eventOccurrences.id, occurrence.id)))
			.returning()
			.get();

		const cancelled = occurrence.status !== "cancelled" && updated.status === "cancelled";
		const restored = occurrence.status === "cancelled" && updated.status === "planned";

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "occurrence",
			entityId: occurrence.id,
			summary: cancelled
				? `Termin am ${formatDay(updated.date)} abgesagt`
				: restored
					? `Termin am ${formatDay(updated.date)} findet wieder statt`
					: `Termin am ${formatDay(updated.date)} geändert`,
			metadata: { fields: Object.keys(body) },
		});

		if (cancelled) {
			const onDuty = (await Occurrences.duties([occurrence.id])).map((duty) => duty.user_id);
			await Notifier.notify(
				onDuty,
				{
					type: "occurrence_cancelled",
					title: `Termin am ${formatDay(updated.date)} fällt aus`,
					body: updated.cancel_reason ? `${event.name} · ${updated.cancel_reason}` : event.name,
					link: occurrencesLink(event),
				},
				{ excludeUserId: userId },
			);
		}

		return APIResponse.success(c, "Date updated successfully", await respond(updated, event, userId));
	},
);

router.delete(
	"/:occurrenceId",

	APIRouteSpec.authenticated({
		summary: "Delete date",
		description:
			"Delete a date that was added by hand. Dates of the series cannot be deleted — the recurrence would bring them back; cancel them instead.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Date deleted successfully"),
			APIResponseSpec.badRequest("Dates of the series can only be cancelled"),
			APIResponseSpec.notFound("Date not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the dates"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "occurrences:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the dates");
		}

		const event = c.get("event");
		const occurrence = c.get("occurrence");
		if (occurrence.origin !== "manual") {
			return APIResponse.badRequest(c, "Dates of the series can only be cancelled");
		}

		await DB.instance()
			.delete(DB.Tables.eventOccurrences)
			.where(and(inOrg(DB.Tables.eventOccurrences), eq(DB.Tables.eventOccurrences.id, occurrence.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "delete",
			entityType: "occurrence",
			entityId: occurrence.id,
			summary: `Termin am ${formatDay(occurrence.date)} gelöscht`,
		});

		return APIResponse.successNoData(c, "Date deleted successfully");
	},
);

router.use(
	"/:occurrenceId/duties/:responsibilityId/*",
	zValidator("param", EventOccurrencesModel.DutyParams),
	async (c, next) => {
		const responsibilityId = EventOccurrencesModel.DutyParams.shape.responsibilityId.safeParse(
			c.req.param("responsibilityId"),
		);
		if (!responsibilityId.success) return APIResponse.badRequest(c, "Invalid responsibility id");

		const responsibility = await DB.instance()
			.select()
			.from(DB.Tables.responsibilities)
			.where(
				and(
					inOrg(DB.Tables.responsibilities),
					eq(DB.Tables.responsibilities.id, responsibilityId.data),
					eq(DB.Tables.responsibilities.event_id, c.get("event").id),
				),
			)
			.get();
		if (!responsibility) return APIResponse.notFound(c, "Responsibility not found");

		c.set("responsibility", responsibility);
		await next();
	},
);

router.put(
	"/:occurrenceId/duties/:responsibilityId",

	APIRouteSpec.authenticated({
		summary: "Set duty",
		description:
			"Set who covers a responsibility on this date (replaces the current people; an empty list clears it). They must be staff of the event and are notified.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Duty updated successfully", EventOccurrencesModel.SetDuty.Response),
			APIResponseSpec.badRequest(
				"Only staff of the event can be put on duty / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Date not found / Responsibility not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the dates"),
		),
	}),

	zValidator("json", EventOccurrencesModel.SetDuty.Body),

	async (c) => {
		if (!EventAccess.can(c, "occurrences:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the dates");
		}

		const event = c.get("event");
		const occurrence = c.get("occurrence");
		const responsibility = c.get("responsibility");
		const { userId } = c.get("eventAccess");
		const { user_ids } = c.req.valid("json") as EventOccurrencesModel.SetDuty.Body;

		const wanted = [...new Set(user_ids)];
		if ((await staffIds(event.id, wanted)).size !== wanted.length) {
			return APIResponse.badRequest(c, "Only staff of the event can be put on duty");
		}

		const added = await replaceDuty(occurrence.id, responsibility.id, wanted);

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: wanted.length ? "assign" : "unassign",
			entityType: "occurrence",
			entityId: occurrence.id,
			summary: `Dienst „${responsibility.title}“ am ${formatDay(occurrence.date)} ${wanted.length ? "eingeteilt" : "geleert"}`,
			metadata: { user_ids: wanted },
		});

		await Notifier.notify(
			added,
			{
				type: "occurrence_assigned",
				title: `Du bist am ${formatDay(occurrence.date)} eingeteilt`,
				body: `${responsibility.title} · ${event.name}`,
				link: occurrencesLink(event),
			},
			{ excludeUserId: userId },
		);

		return APIResponse.success(
			c,
			"Duty updated successfully",
			await respond(occurrence, event, userId),
		);
	},
);

router.put(
	"/:occurrenceId/duties/:responsibilityId/me",

	APIRouteSpec.authenticated({
		summary: "Sign up for duty",
		description:
			"The caller takes a responsibility on this date themselves (`assigned: true`) or steps back from it. Needs to be staff of the event.",
		tags: [DOCS_TAGS.EVENTS.OCCURRENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Duty updated successfully", EventOccurrencesModel.SignUp.Response),
			APIResponseSpec.badRequest("This date is cancelled / Syntax or validation error in request"),
			APIResponseSpec.notFound("Date not found / Responsibility not found"),
			APIResponseSpec.forbidden("Only staff of the event can sign up"),
		),
	}),

	zValidator("json", EventOccurrencesModel.SignUp.Body),

	async (c) => {
		const access = c.get("eventAccess");
		// Core team without a place on the team can plan others, but not take a duty themselves.
		if (!EventAccess.can(c, "occurrences:signup") || !access.membership) {
			return APIResponse.forbidden(c, "Only staff of the event can sign up");
		}

		const event = c.get("event");
		const occurrence = c.get("occurrence");
		const responsibility = c.get("responsibility");
		const { assigned } = c.req.valid("json") as EventOccurrencesModel.SignUp.Body;
		const table = DB.Tables.occurrenceDuties;

		if (assigned && occurrence.status === "cancelled") {
			return APIResponse.badRequest(c, "This date is cancelled");
		}

		if (assigned) {
			await DB.instance()
				.insert(table)
				.values({
					org_id: OrgContext.id(),
					occurrence_id: occurrence.id,
					responsibility_id: responsibility.id,
					user_id: access.userId,
				})
				.onConflictDoNothing()
				.run();
		} else {
			await DB.instance()
				.delete(table)
				.where(
					and(
						inOrg(table),
						eq(table.occurrence_id, occurrence.id),
						eq(table.responsibility_id, responsibility.id),
						eq(table.user_id, access.userId),
					),
				)
				.run();
		}

		await AuditLog.record({
			userId: access.userId,
			eventId: event.id,
			action: assigned ? "assign" : "unassign",
			entityType: "occurrence",
			entityId: occurrence.id,
			summary: assigned
				? `Dienst „${responsibility.title}“ am ${formatDay(occurrence.date)} übernommen`
				: `Dienst „${responsibility.title}“ am ${formatDay(occurrence.date)} abgegeben`,
		});

		return APIResponse.success(
			c,
			"Duty updated successfully",
			await respond(occurrence, event, access.userId),
		);
	},
);
