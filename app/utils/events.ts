/**
 * Helpers for events: how to word the rule of a recurring event ("Regeltermin"), its dates, and
 * where an event stands (running, upcoming, past) — a recurring event runs on the days of its
 * dates, not from the first to the last day of the series.
 */
import { formatDayRange, formatShortDay, parseDay, toDayString } from "./format";
import type { EventWithAccess } from "./types";

export type EventRecurrence = NonNullable<EventWithAccess["recurrence"]>;
export type EventOccurrenceSummary = NonNullable<EventWithAccess["next_occurrence"]>;

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const WEEKDAY_OPTIONS = [
	{ value: 1, label: "Montag", short: "Mo" },
	{ value: 2, label: "Dienstag", short: "Di" },
	{ value: 3, label: "Mittwoch", short: "Mi" },
	{ value: 4, label: "Donnerstag", short: "Do" },
	{ value: 5, label: "Freitag", short: "Fr" },
	{ value: 6, label: "Samstag", short: "Sa" },
	{ value: 7, label: "Sonntag", short: "So" },
] as const;

const WEEKDAY_ADVERBS = [
	"montags",
	"dienstags",
	"mittwochs",
	"donnerstags",
	"freitags",
	"samstags",
	"sonntags",
];

/** ISO weekday (1–7) of a `YYYY-MM-DD` date. */
export function isoWeekday(date: string) {
	return parseDay(date).getDay() || 7;
}

/** Which weekday of its month a date is: 1 = first … 5 = fifth (meaning "the last"). */
export function weekdayOrdinal(date: string) {
	return Math.ceil(parseDay(date).getDate() / 7);
}

function joinList(items: string[]) {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} und ${items.at(-1)}`;
}

/** "Am 15." or "Am 2. Freitag" / "Am letzten Freitag" for a monthly series starting on `date`. */
export function monthlyModeLabel(mode: EventRecurrence["monthly_mode"], date: string) {
	if (!date) return mode === "day_of_month" ? "Am selben Tag des Monats" : "Am selben Wochentag";
	if (mode === "day_of_month") return `Am ${parseDay(date).getDate()}.`;
	const weekday = WEEKDAY_OPTIONS[isoWeekday(date) - 1]?.label ?? "";
	const ordinal = weekdayOrdinal(date);
	return ordinal >= 5 ? `Am letzten ${weekday}` : `Am ${ordinal}. ${weekday}`;
}

/** `19:00–21:00 Uhr`, `19:00 Uhr`, or an empty string without a time. */
export function timeRangeLabel(start: string | null | undefined, end: string | null | undefined) {
	if (!start) return "";
	return end ? `${start}–${end} Uhr` : `${start} Uhr`;
}

/**
 * The rule in words: "Jeden Freitag", "Alle 2 Wochen dienstags und freitags",
 * "Monatlich am 2. Freitag" — with the usual time when there is one.
 */
export function describeRecurrence(
	recurrence: EventRecurrence,
	startDate: string,
	options: { time?: boolean } = {},
) {
	let text: string;
	if (recurrence.frequency === "weekly") {
		const days = [
			...new Set(recurrence.weekdays.length ? recurrence.weekdays : [isoWeekday(startDate)]),
		].sort((a, b) => a - b);
		if (recurrence.interval === 1 && days.length === 1) {
			text = `Jeden ${WEEKDAY_OPTIONS[(days[0] as number) - 1]?.label}`;
		} else if (recurrence.interval === 1 && days.length === 7) {
			text = "Täglich";
		} else {
			const prefix = recurrence.interval === 1 ? "Wöchentlich" : `Alle ${recurrence.interval} Wochen`;
			text = `${prefix} ${joinList(days.map((day) => WEEKDAY_ADVERBS[day - 1] as string))}`;
		}
	} else {
		const prefix = recurrence.interval === 1 ? "Monatlich" : `Alle ${recurrence.interval} Monate`;
		const mode = monthlyModeLabel(recurrence.monthly_mode, startDate);
		text = `${prefix} ${mode.charAt(0).toLowerCase()}${mode.slice(1)}`;
	}

	const time =
		options.time === false ? "" : timeRangeLabel(recurrence.start_time, recurrence.end_time);
	return time ? `${text}, ${time}` : text;
}

/** When an event is: its date range, or the rule of a recurring event. */
export function eventDateLabel(
	event: Pick<EventWithAccess, "type" | "start_date" | "end_date" | "recurrence">,
) {
	if (event.type === "recurring" && event.recurrence) {
		return describeRecurrence(event.recurrence, event.start_date);
	}
	return formatDayRange(event.start_date, event.end_date);
}

/** `Fr., 14.03. · 19:00 Uhr` */
export function occurrenceLabel(
	occurrence: Pick<EventOccurrenceSummary, "date" | "start_time" | "end_time">,
) {
	const time = timeRangeLabel(occurrence.start_time, occurrence.end_time);
	return time ? `${formatShortDay(occurrence.date)} · ${time}` : formatShortDay(occurrence.date);
}

export type EventPhase = "running" | "upcoming" | "past";

/** Running today, still to come, or over. A recurring event goes by its next date. */
export function eventPhase(
	event: Pick<EventWithAccess, "type" | "start_date" | "end_date" | "next_occurrence">,
	today = toDayString(),
): EventPhase {
	if (event.type === "recurring") {
		if (!event.next_occurrence) return event.start_date > today ? "upcoming" : "past";
		return event.next_occurrence.date === today ? "running" : "upcoming";
	}
	if (event.start_date <= today && today <= event.end_date) return "running";
	return event.start_date > today ? "upcoming" : "past";
}

/** The day an upcoming event (or the next date of a series) is on. */
export function eventNextDay(
	event: Pick<EventWithAccess, "type" | "start_date" | "next_occurrence">,
) {
	return event.type === "recurring" ? (event.next_occurrence?.date ?? null) : event.start_date;
}

/**
 * The rule as it is sent to the API: a weekly rule names its weekdays (the weekday of the first
 * date when none was picked), a monthly one has none; no end time without a start.
 */
export function normalizeRecurrence(rule: EventRecurrence, startDate: string): EventRecurrence {
	const weekdays = rule.weekdays.length
		? [...rule.weekdays].sort((a, b) => a - b)
		: startDate
			? [isoWeekday(startDate)]
			: [];
	return {
		...rule,
		weekdays: rule.frequency === "weekly" ? weekdays : [],
		end_time: rule.start_time ? rule.end_time : null,
	};
}

/** A sensible default rule for a new recurring event starting on `startDate`. */
export function defaultRecurrence(startDate?: string): EventRecurrence {
	return {
		frequency: "weekly",
		interval: 1,
		weekdays: startDate ? [isoWeekday(startDate)] : [],
		monthly_mode: "day_of_month",
		start_time: "19:00",
		end_time: null,
	};
}
