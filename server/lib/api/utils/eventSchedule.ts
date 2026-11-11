import { and, eq, inArray } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { inOrg } from "../../orgs/context";

type Dated = Pick<DB.Models.Event, "id" | "type" | "start_date" | "end_date">;

/**
 * On which days events take place. A camp or event fills its whole date range; a recurring event
 * only its planned dates — so a weekly meeting neither "runs" all year nor clashes with a camp in
 * a week without a meeting. Load once for a set of events, then ask.
 */
export class EventSchedule {
	private constructor(
		/** Planned dates of the recurring events (event id → sorted `YYYY-MM-DD`). */
		private readonly dates: Map<number, string[]>,
	) {}

	static async load(events: Dated[], tx: DrizzleDB = DB.instance()) {
		const dates = new Map<number, string[]>();
		const recurring = events.filter((event) => event.type === "recurring").map((event) => event.id);
		for (const id of recurring) dates.set(id, []);

		if (recurring.length > 0) {
			const table = DB.Tables.eventOccurrences;
			const rows = await tx
				.select({ event_id: table.event_id, date: table.date })
				.from(table)
				.where(and(inOrg(table), inArray(table.event_id, recurring), eq(table.status, "planned")))
				.orderBy(table.date)
				.all();
			for (const row of rows) dates.get(row.event_id)?.push(row.date);
		}
		return new EventSchedule(dates);
	}

	/** The event takes place on `date`. */
	takesPlaceOn(event: Dated, date: string) {
		const dates = this.dates.get(event.id);
		if (dates) return dates.includes(date);
		return event.start_date <= date && date <= event.end_date;
	}

	/** The event takes place on at least one day from `from` to `to` (inclusive). */
	takesPlaceWithin(event: Dated, from: string, to: string) {
		const dates = this.dates.get(event.id);
		if (dates) return dates.some((date) => from <= date && date <= to);
		return event.start_date <= to && from <= event.end_date;
	}

	/** A recurring event's planned dates from `from` to `to`; null for camps and events. */
	datesWithin(event: Dated, from: string, to: string): string[] | null {
		const dates = this.dates.get(event.id);
		return dates ? dates.filter((date) => from <= date && date <= to) : null;
	}

	/** Two events share at least one day. */
	overlap(a: Dated, b: Dated) {
		const datesA = this.dates.get(a.id);
		const datesB = this.dates.get(b.id);
		if (datesA && datesB) {
			const set = new Set(datesB);
			return datesA.some((date) => set.has(date));
		}
		if (datesA) return datesA.some((date) => b.start_date <= date && date <= b.end_date);
		if (datesB) return datesB.some((date) => a.start_date <= date && date <= a.end_date);
		return a.start_date <= b.end_date && b.start_date <= a.end_date;
	}

	/** The first day from `from` on which the event takes place, or null when it is over. */
	nextDay(event: Dated, from: string): string | null {
		const dates = this.dates.get(event.id);
		if (dates) return dates.find((date) => date >= from) ?? null;
		if (event.end_date < from) return null;
		return event.start_date > from ? event.start_date : from;
	}
}
