import { z } from "zod";

/**
 * The rule of a recurring event ("Regeltermin"): weekly on given weekdays or monthly, every
 * `interval` weeks/months. The series runs from the event's `start_date` to its `end_date`; its
 * dates are materialised as `event_occurrences` (see `Occurrences.syncWithRule`).
 */
export namespace Recurrence {
	export const FREQUENCIES = ["weekly", "monthly"] as const;
	export const MONTHLY_MODES = ["day_of_month", "weekday_of_month"] as const;

	/** A series may not produce more dates than this … */
	export const MAX_OCCURRENCES = 400;
	/** … nor run longer than this (three years). */
	export const MAX_SPAN_DAYS = 3 * 366;

	const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time in the format HH:MM");

	export const Schema = z.object({
		frequency: z.enum(FREQUENCIES),
		/** Every n-th week or month. */
		interval: z.number().int().min(1).max(12).default(1),
		/**
		 * Weekly: ISO weekdays, 1 = Monday … 7 = Sunday. Empty = the weekday of the first date.
		 */
		weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
		/**
		 * Monthly: on the day of the month of the first date ("am 15."), or on its weekday of the
		 * month ("am 2. Freitag"; the fifth one means "the last").
		 */
		monthly_mode: z.enum(MONTHLY_MODES).default("day_of_month"),
		/** Usual time of day (`HH:MM`); a date of the series can have its own. */
		start_time: Time.nullable().default(null),
		end_time: Time.nullable().default(null),
	});
	export type Rule = z.infer<typeof Schema>;

	function parse(date: string) {
		const [y, m, d] = date.split("-").map(Number) as [number, number, number];
		return { y, m, d };
	}

	function format(y: number, m: number, d: number) {
		return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
	}

	function addDays(date: string, days: number) {
		const { y, m, d } = parse(date);
		return format(y, m, d + days);
	}

	/** ISO weekday of a `YYYY-MM-DD` date: 1 = Monday … 7 = Sunday. */
	export function weekday(date: string) {
		const { y, m, d } = parse(date);
		return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
	}

	function daysInMonth(y: number, m: number) {
		return new Date(Date.UTC(y, m, 0)).getUTCDate();
	}

	/** Which weekday of its month a date is: 1 = first … 5 = fifth (treated as "last"). */
	export function weekdayOrdinal(date: string) {
		return Math.ceil(parse(date).d / 7);
	}

	/** Every date of the series from `start` to `end` (both inclusive), ascending. */
	export function dates(rule: Rule, start: string, end: string): string[] {
		if (start > end) return [];
		const result: string[] = [];
		const interval = Math.max(1, rule.interval);
		// Stops runaway loops on bad input; callers enforce the real limits.
		const cap = MAX_OCCURRENCES * 4;

		if (rule.frequency === "weekly") {
			const weekdays = [...new Set(rule.weekdays.length ? rule.weekdays : [weekday(start)])].sort(
				(a, b) => a - b,
			);
			const firstMonday = addDays(start, 1 - weekday(start));
			for (
				let week = firstMonday;
				week <= end && result.length < cap;
				week = addDays(week, 7 * interval)
			) {
				for (const day of weekdays) {
					const date = addDays(week, day - 1);
					if (date >= start && date <= end) result.push(date);
				}
			}
			return result;
		}

		const first = parse(start);
		const ordinal = weekdayOrdinal(start);
		const day = weekday(start);
		for (let step = 0; result.length < cap; step += interval) {
			const y = first.y + Math.floor((first.m - 1 + step) / 12);
			const m = ((first.m - 1 + step) % 12) + 1;
			if (format(y, m, 1) > end) break;

			let date: string;
			if (rule.monthly_mode === "day_of_month") {
				// Months without that day (the 31st) use their last day.
				date = format(y, m, Math.min(first.d, daysInMonth(y, m)));
			} else {
				const firstOfMonth = weekday(format(y, m, 1));
				const firstMatch = 1 + ((day - firstOfMonth + 7) % 7);
				let dayOfMonth = firstMatch + (ordinal - 1) * 7;
				// "The fifth" means the last one; so does a fourth that a short month lacks.
				while (dayOfMonth > daysInMonth(y, m)) dayOfMonth -= 7;
				if (ordinal >= 5) {
					while (dayOfMonth + 7 <= daysInMonth(y, m)) dayOfMonth += 7;
				}
				date = format(y, m, dayOfMonth);
			}
			if (date >= start && date <= end) result.push(date);
		}
		return result;
	}

	/** Why a series is not acceptable, or null. */
	export function validate(rule: Rule, start: string, end: string): string | null {
		const span = Math.round(
			(Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
		);
		if (span > MAX_SPAN_DAYS) return "A recurring event can span at most three years";
		if (rule.start_time && rule.end_time && rule.end_time <= rule.start_time) {
			return "end_time must be after start_time";
		}
		const count = dates(rule, start, end).length;
		if (count === 0) return "The recurrence has no date between start_date and end_date";
		if (count > MAX_OCCURRENCES) {
			return `A recurring event can have at most ${MAX_OCCURRENCES} dates`;
		}
		return null;
	}
}
