/**
 * German labels, icons and badge colours for enum values used across pages. Static maps only —
 * never build class names like `text-${color}-400` dynamically (Tailwind can't see them).
 */
import type { TaskPriority, TaskStatus } from "./types";

type BadgeColor = "error" | "primary" | "info" | "neutral" | "success" | "warning";

function toOptions<T extends string>(labels: Record<T, string>, order?: readonly T[]) {
	return (order ?? (Object.keys(labels) as T[])).map((value) => ({ label: labels[value], value }));
}

// --- tasks ------------------------------------------------------------------------------------

export const TASK_STATUS_ORDER = [
	"open",
	"in_progress",
	"done",
] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
	open: "Offen",
	in_progress: "In Arbeit",
	done: "Erledigt",
};

export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
	open: "i-lucide-circle",
	in_progress: "i-lucide-circle-dot",
	done: "i-lucide-circle-check",
};

export const TASK_STATUS_OPTIONS = toOptions(TASK_STATUS_LABELS, TASK_STATUS_ORDER);

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
	low: "Niedrig",
	normal: "Normal",
	high: "Hoch",
	urgent: "Dringend",
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, BadgeColor> = {
	low: "neutral",
	normal: "info",
	high: "warning",
	urgent: "error",
};

export const TASK_PRIORITY_OPTIONS = toOptions(TASK_PRIORITY_LABELS, [
	"low",
	"normal",
	"high",
	"urgent",
]);

// --- events -----------------------------------------------------------------------------------

export const EVENT_TYPE_LABELS = { camp: "Freizeit", event: "Event" } as const;
export const EVENT_TYPE_OPTIONS = toOptions(EVENT_TYPE_LABELS);
export const EVENT_TYPE_ICONS = { camp: "i-lucide-tent", event: "i-lucide-calendar-days" } as const;

export const EVENT_STATUS_LABELS = {
	planning: "In Planung",
	confirmed: "Bestätigt",
	cancelled: "Abgesagt",
	archived: "Archiviert",
} as const;
export const EVENT_STATUS_COLORS: Record<keyof typeof EVENT_STATUS_LABELS, BadgeColor> = {
	planning: "warning",
	confirmed: "success",
	cancelled: "error",
	archived: "neutral",
};
export const EVENT_STATUS_OPTIONS = toOptions(EVENT_STATUS_LABELS);

// --- participants -----------------------------------------------------------------------------

export const PARTICIPANT_STATUS_LABELS = {
	registered: "Angemeldet",
	confirmed: "Bestätigt",
	waitlist: "Warteliste",
	cancelled: "Abgemeldet",
} as const;
export const PARTICIPANT_STATUS_COLORS: Record<keyof typeof PARTICIPANT_STATUS_LABELS, BadgeColor> =
	{
		registered: "info",
		confirmed: "success",
		waitlist: "warning",
		cancelled: "neutral",
	};
export const PARTICIPANT_STATUS_OPTIONS = toOptions(PARTICIPANT_STATUS_LABELS);

export const GENDER_LABELS = { female: "weiblich", male: "männlich", diverse: "divers" } as const;
export const GENDER_OPTIONS = toOptions(GENDER_LABELS);

// --- finances ---------------------------------------------------------------------------------

export const EXPENSE_STATUS_LABELS = {
	submitted: "Eingereicht",
	approved: "Genehmigt",
	rejected: "Abgelehnt",
	reimbursed: "Erstattet",
} as const;
export const EXPENSE_STATUS_COLORS: Record<keyof typeof EXPENSE_STATUS_LABELS, BadgeColor> = {
	submitted: "warning",
	approved: "info",
	rejected: "error",
	reimbursed: "success",
};
export const EXPENSE_STATUS_OPTIONS = toOptions(EXPENSE_STATUS_LABELS);

export const EXPENSE_CATEGORIES = [
	"Lebensmittel",
	"Material",
	"Programm",
	"Fahrtkosten",
	"Unterkunft",
	"Druck & Werbung",
	"Erste Hilfe",
	"Sonstiges",
] as const;

// --- announcements ----------------------------------------------------------------------------

export const ANNOUNCEMENT_PRIORITY_LABELS = { normal: "Normal", important: "Wichtig" } as const;
export const ANNOUNCEMENT_PRIORITY_OPTIONS = toOptions(ANNOUNCEMENT_PRIORITY_LABELS);

// --- colours offered in pickers (program items, groups, events) --------------------------------

export const COLOR_PRESETS = [
	"#f97316",
	"#ef4444",
	"#eab308",
	"#22c55e",
	"#14b8a6",
	"#0ea5e9",
	"#6366f1",
	"#a855f7",
	"#ec4899",
	"#64748b",
] as const;
