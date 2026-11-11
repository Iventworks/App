import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import { OCCURRENCE_ORIGINS, OCCURRENCE_STATUSES } from "../../db/schema";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import { Recurrence } from "../../utils/recurrence";
import { TimeUtils } from "../../utils/time";
import { UserSummary } from "./shared-models/userSummary";

/**
 * The dates ("Termine") of recurring events and their duty roster.
 *
 * The event's recurrence is the plan; `event_occurrences` is what actually happens. Rows with
 * `origin = rule` follow the rule (`syncWithRule` after every change to it), rows a person has
 * worked on — a topic, a note, an own time, people on duty, cancelled — are never thrown away.
 */
export class Occurrences {
	/** Time and place of a date: its own, or the series'. */
	static effective(occurrence: DB.Models.EventOccurrence, event: DB.Models.Event) {
		const rule = event.recurrence;
		let endTime: string | null;
		if (!occurrence.start_time) {
			// The series' time.
			endTime = rule?.end_time ?? null;
		} else if (occurrence.end_time) {
			endTime = occurrence.end_time;
		} else {
			// Its own start but no own end: as long as the series' dates (19:00–21:00 moved to
			// 19:30 runs until 21:30; an extra date at 10:00 until 12:00).
			endTime = Occurrences.keepDuration(occurrence.start_time, rule?.start_time, rule?.end_time);
		}
		return {
			start_time: occurrence.start_time ?? rule?.start_time ?? null,
			end_time: endTime,
			location: occurrence.location ?? event.location,
		};
	}

	/** `start` plus the length of `seriesStart`–`seriesEnd` (HH:MM); null past midnight. */
	static keepDuration(
		start: string,
		seriesStart: string | null | undefined,
		seriesEnd: string | null | undefined,
	) {
		if (!seriesStart || !seriesEnd) return null;
		const minutes = (time: string) => {
			const [h, m] = time.split(":").map(Number) as [number, number];
			return h * 60 + m;
		};
		const length = minutes(seriesEnd) - minutes(seriesStart);
		const end = minutes(start) + length;
		if (length <= 0 || end >= 24 * 60) return null;
		return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
	}

	/** Start and end of a date as instants; `all_day` when it has no time. */
	static instants(occurrence: DB.Models.EventOccurrence, event: DB.Models.Event) {
		const { start_time, end_time } = Occurrences.effective(occurrence, event);
		if (!start_time) {
			const { start, end } = TimeUtils.dayBounds(occurrence.date);
			return { start_at: start, end_at: end, all_day: true };
		}
		const start = TimeUtils.instantOf(occurrence.date, start_time);
		const end =
			end_time && end_time > start_time
				? TimeUtils.instantOf(occurrence.date, end_time)
				: start + 60 * 60 * 1000;
		return { start_at: start, end_at: end, all_day: false };
	}

	/** Someone has worked on this date: it must survive a change of the rule. */
	protected static isTouched(occurrence: DB.Models.EventOccurrence, hasDuties: boolean) {
		return (
			hasDuties ||
			occurrence.status !== "planned" ||
			Boolean(occurrence.title) ||
			occurrence.notes !== "" ||
			occurrence.start_time !== null ||
			occurrence.end_time !== null ||
			occurrence.location !== null
		);
	}

	/**
	 * Bring the dates of an event in line with its recurrence: add the dates the rule now has, drop
	 * future dates it no longer has (unless someone worked on them — those become `manual`). Past
	 * dates are history and stay. An event that is not recurring (any more) has no dates.
	 */
	static async syncWithRule(event: DB.Models.Event, tx: DrizzleDB = DB.instance()) {
		const table = DB.Tables.eventOccurrences;

		if (event.type !== "recurring" || !event.recurrence) {
			await tx
				.delete(table)
				.where(and(inOrg(table), eq(table.event_id, event.id)))
				.run();
			return { added: 0, removed: 0 };
		}

		const wanted = new Set(Recurrence.dates(event.recurrence, event.start_date, event.end_date));
		const existing = await tx
			.select()
			.from(table)
			.where(and(inOrg(table), eq(table.event_id, event.id)))
			.all();
		const today = TimeUtils.today();

		const obsolete = existing.filter(
			(occurrence) =>
				occurrence.origin === "rule" && !wanted.has(occurrence.date) && occurrence.date >= today,
		);
		const withDuties = new Set(
			obsolete.length
				? (
						await tx
							.selectDistinct({ id: DB.Tables.occurrenceDuties.occurrence_id })
							.from(DB.Tables.occurrenceDuties)
							.where(
								and(
									inOrg(DB.Tables.occurrenceDuties),
									inArray(
										DB.Tables.occurrenceDuties.occurrence_id,
										obsolete.map((occurrence) => occurrence.id),
									),
								),
							)
							.all()
					).map((row) => row.id)
				: [],
		);

		const keep = obsolete.filter((occurrence) =>
			Occurrences.isTouched(occurrence, withDuties.has(occurrence.id)),
		);
		const remove = obsolete.filter((occurrence) => !keep.includes(occurrence));

		if (keep.length) {
			await tx
				.update(table)
				.set({ origin: "manual", updated_at: Date.now() })
				.where(
					and(
						inOrg(table),
						inArray(
							table.id,
							keep.map((occurrence) => occurrence.id),
						),
					),
				)
				.run();
		}
		if (remove.length) {
			await tx
				.delete(table)
				.where(
					and(
						inOrg(table),
						inArray(
							table.id,
							remove.map((occurrence) => occurrence.id),
						),
					),
				)
				.run();
		}

		// A date that already has a row (also a manual one) is not added twice.
		const taken = new Set(
			existing.filter((occurrence) => !remove.includes(occurrence)).map((entry) => entry.date),
		);
		const missing = [...wanted].filter((date) => !taken.has(date));
		// SQLite caps the number of bound values per statement: insert in chunks.
		for (let at = 0; at < missing.length; at += 100) {
			await tx
				.insert(table)
				.values(
					missing.slice(at, at + 100).map((date) => ({
						org_id: OrgContext.id(),
						event_id: event.id,
						date,
						origin: "rule" as const,
					})),
				)
				.run();
		}

		return { added: missing.length, removed: remove.length };
	}

	/** The dates of an event, ascending, optionally within a range of days. */
	static async list(
		eventId: number,
		range: { from?: string; to?: string } = {},
		tx: DrizzleDB = DB.instance(),
	) {
		const table = DB.Tables.eventOccurrences;
		return await tx
			.select()
			.from(table)
			.where(
				and(
					inOrg(table),
					eq(table.event_id, eventId),
					range.from ? gte(table.date, range.from) : undefined,
					range.to ? lte(table.date, range.to) : undefined,
				),
			)
			.orderBy(asc(table.date), asc(table.start_time), asc(table.id))
			.all();
	}

	static async get(eventId: number, occurrenceId: number) {
		const table = DB.Tables.eventOccurrences;
		return (
			(await DB.instance()
				.select()
				.from(table)
				.where(and(inOrg(table), eq(table.id, occurrenceId), eq(table.event_id, eventId)))
				.get()) ?? null
		);
	}

	static async duties(occurrenceIds: number[], tx: DrizzleDB = DB.instance()) {
		if (occurrenceIds.length === 0) return [];
		const table = DB.Tables.occurrenceDuties;
		const rows: DB.Models.OccurrenceDuty[] = [];
		for (let at = 0; at < occurrenceIds.length; at += 500) {
			rows.push(
				...(await tx
					.select()
					.from(table)
					.where(and(inOrg(table), inArray(table.occurrence_id, occurrenceIds.slice(at, at + 500))))
					.all()),
			);
		}
		return rows;
	}

	/** Dates as the caller sees them: effective time and place, who is on duty. */
	static async toResponse(
		occurrences: DB.Models.EventOccurrence[],
		event: DB.Models.Event,
		userId: number,
	): Promise<Occurrences.Item[]> {
		const duties = await Occurrences.duties(occurrences.map((occurrence) => occurrence.id));
		const users = await UserSummary.fetchMap(duties.map((duty) => duty.user_id));

		return occurrences.map((occurrence) => {
			const own = duties.filter((duty) => duty.occurrence_id === occurrence.id);
			const byResponsibility = new Map<number, UserSummary.Schema[]>();
			for (const duty of own) {
				const user = users.get(duty.user_id);
				if (!user) continue;
				const list = byResponsibility.get(duty.responsibility_id) ?? [];
				list.push(user);
				byResponsibility.set(duty.responsibility_id, list);
			}

			return {
				id: occurrence.id,
				event_id: occurrence.event_id,
				date: occurrence.date,
				...Occurrences.effective(occurrence, event),
				custom_time: occurrence.start_time !== null,
				custom_location: occurrence.location !== null,
				title: occurrence.title,
				notes: occurrence.notes,
				status: occurrence.status,
				cancel_reason: occurrence.cancel_reason,
				origin: occurrence.origin,
				duties: [...byResponsibility].map(([responsibility_id, people]) => ({
					responsibility_id,
					users: people.sort((a, b) => a.display_name.localeCompare(b.display_name, "de")),
				})),
				is_mine: own.some((duty) => duty.user_id === userId),
			};
		});
	}

	/** The next planned date (from today) of each recurring event among `events`. */
	static async nextByEvent(events: DB.Models.Event[], tx: DrizzleDB = DB.instance()) {
		const result = new Map<number, Occurrences.Summary>();
		const recurring = events.filter((event) => event.type === "recurring");
		if (recurring.length === 0) return result;

		const table = DB.Tables.eventOccurrences;
		const rows = await tx
			.select()
			.from(table)
			.where(
				and(
					inOrg(table),
					inArray(
						table.event_id,
						recurring.map((event) => event.id),
					),
					eq(table.status, "planned"),
					gte(table.date, TimeUtils.today()),
				),
			)
			.orderBy(asc(table.date), asc(table.start_time), asc(table.id))
			.all();

		for (const row of rows) {
			if (result.has(row.event_id)) continue;
			const event = recurring.find((entry) => entry.id === row.event_id);
			if (event) result.set(row.event_id, Occurrences.toSummary(row, event));
		}
		return result;
	}

	/** Take a person off every upcoming date of an event (they left its team). */
	static async removeUpcomingDuties(eventId: number, userId: number, tx: DrizzleDB = DB.instance()) {
		const upcoming = await tx
			.select({ id: DB.Tables.eventOccurrences.id })
			.from(DB.Tables.eventOccurrences)
			.where(
				and(
					inOrg(DB.Tables.eventOccurrences),
					eq(DB.Tables.eventOccurrences.event_id, eventId),
					gte(DB.Tables.eventOccurrences.date, TimeUtils.today()),
				),
			)
			.all();
		for (let at = 0; at < upcoming.length; at += 500) {
			await tx
				.delete(DB.Tables.occurrenceDuties)
				.where(
					and(
						inOrg(DB.Tables.occurrenceDuties),
						eq(DB.Tables.occurrenceDuties.user_id, userId),
						inArray(
							DB.Tables.occurrenceDuties.occurrence_id,
							upcoming.slice(at, at + 500).map((row) => row.id),
						),
					),
				)
				.run();
		}
	}

	static toSummary(
		occurrence: DB.Models.EventOccurrence,
		event: DB.Models.Event,
	): Occurrences.Summary {
		const { start_time, end_time, location } = Occurrences.effective(occurrence, event);
		return {
			id: occurrence.id,
			date: occurrence.date,
			start_time,
			end_time,
			location,
			title: occurrence.title,
		};
	}
}

export namespace Occurrences {
	export const SummarySchema = z.object({
		id: z.number(),
		date: z.string(),
		start_time: z.string().nullable(),
		end_time: z.string().nullable(),
		location: z.string().nullable(),
		title: z.string().nullable(),
	});
	export type Summary = z.infer<typeof SummarySchema>;

	export const ItemSchema = z.object({
		id: z.number(),
		event_id: z.number(),
		/** `YYYY-MM-DD` */
		date: z.string(),
		/** `HH:MM` — this date's own time, or the time of the series. */
		start_time: z.string().nullable(),
		end_time: z.string().nullable(),
		/** This date's own place, or the event's. */
		location: z.string().nullable(),
		/** This date has its own time / place instead of the series'. */
		custom_time: z.boolean(),
		custom_location: z.boolean(),
		/** What the date is about ("Thema"). */
		title: z.string().nullable(),
		notes: z.string(),
		status: z.enum(OCCURRENCE_STATUSES),
		cancel_reason: z.string().nullable(),
		/** `rule`: from the recurrence; `manual`: added by hand. */
		origin: z.enum(OCCURRENCE_ORIGINS),
		/** Who covers which responsibility on this date. */
		duties: z.array(
			z.object({
				responsibility_id: z.number(),
				users: z.array(UserSummary.Schema),
			}),
		),
		/** The caller is on duty on this date. */
		is_mine: z.boolean(),
	});
	export type Item = z.infer<typeof ItemSchema>;
}
