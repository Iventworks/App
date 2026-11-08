import { ConfigHandler } from "./config";

/**
 * Calendar-day helpers in the organisation's time zone (`CMP_TIMEZONE`, default Europe/Berlin).
 * Event dates are stored as `YYYY-MM-DD`; program items and tasks as unix-ms timestamps.
 */
export class TimeUtils {
	static get timeZone() {
		return ConfigHandler.getConfig()?.TIMEZONE ?? "Europe/Berlin";
	}

	/** `YYYY-MM-DD` of the given instant in the organisation's time zone. */
	static toDateString(ts: number = Date.now(), timeZone = TimeUtils.timeZone) {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date(ts));
	}

	static today(timeZone = TimeUtils.timeZone) {
		return TimeUtils.toDateString(Date.now(), timeZone);
	}

	/** Offset (ms) of `timeZone` from UTC at instant `ts`. */
	protected static getOffset(ts: number, timeZone: string) {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).formatToParts(new Date(ts));
		const get = (type: Intl.DateTimeFormatPartTypes) =>
			Number(parts.find((part) => part.type === type)?.value ?? 0);
		const asUTC = Date.UTC(
			get("year"),
			get("month") - 1,
			get("day"),
			get("hour"),
			get("minute"),
			get("second"),
		);
		return asUTC - Math.floor(ts / 1000) * 1000;
	}

	/** Unix-ms start (inclusive) and end (exclusive) of a calendar day in the time zone. */
	static dayBounds(date: string, timeZone = TimeUtils.timeZone) {
		return {
			start: TimeUtils.startOfDay(date, timeZone),
			end: TimeUtils.startOfDay(TimeUtils.addDays(date, 1), timeZone),
		};
	}

	static startOfDay(date: string, timeZone = TimeUtils.timeZone) {
		const [y, m, d] = date.split("-").map(Number) as [number, number, number];
		const utcGuess = Date.UTC(y, m - 1, d);
		let ts = utcGuess - TimeUtils.getOffset(utcGuess, timeZone);
		// Re-check across DST transitions.
		const corrected = utcGuess - TimeUtils.getOffset(ts, timeZone);
		if (corrected !== ts) ts = corrected;
		return ts;
	}

	static addDays(date: string, days: number) {
		const [y, m, d] = date.split("-").map(Number) as [number, number, number];
		return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
	}

	/** Whole-day difference `b - a` between two `YYYY-MM-DD` dates. */
	static diffDays(a: string, b: string) {
		return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
	}

	/** Age in full years on `onDate` for a `YYYY-MM-DD` birth date. */
	static ageOn(birthDate: string | null | undefined, onDate: string) {
		if (!birthDate) return null;
		const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
		const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
		let age = y - by;
		if (m < bm || (m === bm && d < bd)) age--;
		return age;
	}
}
