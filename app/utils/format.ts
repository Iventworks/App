/**
 * Shared formatting helpers (German locale). Timestamps are unix milliseconds, dates are
 * `YYYY-MM-DD` strings, money is integer cents.
 */
const LOCALE = "de-DE";

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
});
const longDateFormatter = new Intl.DateTimeFormat(LOCALE, {
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
});
const shortDayFormatter = new Intl.DateTimeFormat(LOCALE, {
	weekday: "short",
	day: "2-digit",
	month: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const currencyFormatter = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR" });
const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** `05.11.2026, 14:30` */
export function formatDate(ts: number | null | undefined): string {
	if (!ts) return "–";
	return dateTimeFormatter.format(new Date(ts));
}

/** `05.11.2026` from a timestamp or a `YYYY-MM-DD` string. */
export function formatDay(value: number | string | null | undefined): string {
	if (value === null || value === undefined || value === "") return "–";
	return dateFormatter.format(typeof value === "string" ? parseDay(value) : new Date(value));
}

/** `Donnerstag, 5. November 2026` */
export function formatLongDay(value: number | string): string {
	return longDateFormatter.format(typeof value === "string" ? parseDay(value) : new Date(value));
}

/** `Do., 05.11.` */
export function formatShortDay(value: number | string): string {
	return shortDayFormatter.format(typeof value === "string" ? parseDay(value) : new Date(value));
}

/** `14:30` */
export function formatTime(ts: number | null | undefined): string {
	if (!ts) return "–";
	return timeFormatter.format(new Date(ts));
}

/** `14:30 – 16:00` */
export function formatTimeRange(start: number, end: number): string {
	return `${formatTime(start)} – ${formatTime(end)}`;
}

/** `01.07.2027 – 10.07.2027` */
export function formatDayRange(start: string, end: string): string {
	return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}

/** `12,50 €` */
export function formatCents(cents: number | null | undefined): string {
	return currencyFormatter.format((cents ?? 0) / 100);
}

/** "vor 5 Minuten", "in 3 Tagen" */
export function formatRelative(ts: number | null | undefined): string {
	if (!ts) return "–";
	const diffSeconds = Math.round((ts - Date.now()) / 1000);
	const abs = Math.abs(diffSeconds);
	if (abs < 60) return relativeFormatter.format(diffSeconds, "second");
	if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
	if (abs < 86_400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
	if (abs < 30 * 86_400) return relativeFormatter.format(Math.round(diffSeconds / 86_400), "day");
	return formatDay(ts);
}

export function formatFileSize(bytes: number | null | undefined): string {
	if (!bytes) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let size = bytes;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}
	return `${size.toLocaleString(LOCALE, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

/** Local `YYYY-MM-DD` for a Date/timestamp (no UTC shift). */
export function toDayString(value: Date | number = new Date()): string {
	const date = typeof value === "number" ? new Date(value) : value;
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Local midnight of a `YYYY-MM-DD` string. */
export function parseDay(value: string): Date {
	const [y, m, d] = value.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d);
}

/** `<input type="datetime-local">` value for a timestamp, and back. */
export function toDateTimeInput(ts: number | null | undefined): string {
	if (!ts) return "";
	const d = new Date(ts);
	d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
	return d.toISOString().slice(0, 16);
}

export function fromDateTimeInput(value: string): number | null {
	if (!value) return null;
	const ts = new Date(value).getTime();
	return Number.isNaN(ts) ? null : ts;
}

/** Euro input string ("12,50") ↔ cents. */
export function centsToInput(cents: number | null | undefined): string {
	if (cents === null || cents === undefined) return "";
	return (cents / 100).toFixed(2).replace(".", ",");
}

export function inputToCents(value: string | number | null | undefined): number | null {
	if (value === null || value === undefined || value === "") return null;
	const normalized =
		typeof value === "number" ? value : Number(value.replace(/\./g, "").replace(",", "."));
	if (Number.isNaN(normalized)) return null;
	return Math.round(normalized * 100);
}

export function initials(name: string | null | undefined): string {
	if (!name) return "?";
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}

/** Long opaque IDs (API keys are 64 hex chars) shortened for display: `e705550f3103…`. */
export function shortId(id: string, length = 12) {
	return id.length > length ? `${id.slice(0, length)}…` : id;
}
