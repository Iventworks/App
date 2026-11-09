import type { GetAdminAuditLogResponses } from "~/api-client";
import { formatCents, formatDate } from "./format";
import { type BadgeColor, ORG_ROLE_LABELS } from "./roles";

export type AuditEntry = GetAdminAuditLogResponses["200"]["data"]["entries"][number];
export type AuditAction = AuditEntry["action"];

/** Label, badge colour and icon per audit action. */
export const AUDIT_ACTIONS: Record<
	AuditAction,
	{ label: string; color: BadgeColor; icon: string }
> = {
	create: { label: "Angelegt", color: "success", icon: "i-lucide-plus" },
	update: { label: "Geändert", color: "primary", icon: "i-lucide-pencil" },
	delete: { label: "Gelöscht", color: "error", icon: "i-lucide-trash-2" },
	assign: { label: "Zugeteilt", color: "info", icon: "i-lucide-user-plus" },
	unassign: { label: "Entfernt", color: "neutral", icon: "i-lucide-user-minus" },
	review: { label: "Geprüft", color: "warning", icon: "i-lucide-clipboard-check" },
	invite: { label: "Eingeladen", color: "primary", icon: "i-lucide-mail-plus" },
	login: { label: "Anmeldung", color: "neutral", icon: "i-lucide-log-in" },
	suspend: { label: "Gesperrt", color: "error", icon: "i-lucide-ban" },
	unsuspend: { label: "Entsperrt", color: "success", icon: "i-lucide-lock-open" },
	revoke: { label: "Abgemeldet", color: "warning", icon: "i-lucide-log-out" },
	password_link: { label: "Passwort-Link", color: "warning", icon: "i-lucide-link" },
};

/** Label and icon per audited object type (`entity_type`). */
export const AUDIT_ENTITIES: Record<string, { label: string; icon: string }> = {
	event: { label: "Event", icon: "i-lucide-tent" },
	event_member: { label: "Team", icon: "i-lucide-user-check" },
	event_group: { label: "Gruppe", icon: "i-lucide-users-round" },
	room: { label: "Zimmer", icon: "i-lucide-bed-double" },
	participant: { label: "Teilnehmende", icon: "i-lucide-user-round" },
	participant_note: { label: "Teilnehmer-Notiz", icon: "i-lucide-notebook-pen" },
	program_item: { label: "Programmpunkt", icon: "i-lucide-calendar-clock" },
	responsibility: { label: "Zuständigkeit", icon: "i-lucide-clipboard-list" },
	task: { label: "Aufgabe", icon: "i-lucide-square-check" },
	note: { label: "Notiz", icon: "i-lucide-sticky-note" },
	announcement: { label: "Neuigkeit", icon: "i-lucide-megaphone" },
	file: { label: "Dokument", icon: "i-lucide-file" },
	expense: { label: "Ausgabe", icon: "i-lucide-receipt" },
	budget_item: { label: "Budgetposten", icon: "i-lucide-wallet" },
	resource: { label: "Ressource", icon: "i-lucide-package" },
	resource_booking: { label: "Reservierung", icon: "i-lucide-calendar-check" },
	user: { label: "Benutzer", icon: "i-lucide-user" },
	invitation: { label: "Einladung", icon: "i-lucide-mail" },
	organization: { label: "Organisation", icon: "i-lucide-building" },
	org_domain: { label: "Domain", icon: "i-lucide-globe" },
	org: { label: "Organisation", icon: "i-lucide-building" },
};

export function auditEntity(type: string) {
	return AUDIT_ENTITIES[type] ?? { label: type, icon: "i-lucide-circle" };
}

/**
 * Where the affected object can be opened, or `null` (deleted objects, or pages the viewer can't
 * reach — user and invitation pages are admin-only).
 */
export function auditObjectLink(entry: AuditEntry, options: { isAdmin: boolean }): string | null {
	if (entry.action === "delete") return null;
	const id = entry.entity_id;
	const eventPath = entry.event_id ? `/events/${entry.event_id}` : null;

	switch (entry.entity_type) {
		case "user":
			return options.isAdmin && id ? `/admin/users/${id}` : null;
		case "invitation":
			return options.isAdmin ? "/admin/invitations" : null;
		case "event":
			return id ? `/events/${id}` : null;
		case "participant":
			return eventPath && id ? `${eventPath}/participants/${id}` : null;
		case "participant_note":
			return eventPath ? `${eventPath}/participants` : null;
		case "event_member":
			return eventPath ? `${eventPath}/staff` : null;
		case "event_group":
			return eventPath ? `${eventPath}/groups` : null;
		case "room":
			return eventPath ? `${eventPath}/rooms` : null;
		case "program_item":
			return eventPath ? `${eventPath}/program` : null;
		case "responsibility":
			return eventPath ? `${eventPath}/responsibilities` : null;
		case "task":
			return eventPath ? `${eventPath}/tasks` : "/tasks";
		case "note":
			return eventPath && id ? `${eventPath}/notes?note=${id}` : null;
		case "expense":
			return eventPath ? `${eventPath}/finances/all` : null;
		case "budget_item":
			return eventPath ? `${eventPath}/finances/budget` : null;
		case "file":
			return eventPath ? `${eventPath}/documents` : "/documents";
		case "announcement":
			return eventPath ? eventPath : "/news";
		case "resource":
		case "resource_booking":
			return "/core-team/resources";
		case "organization":
			return options.isAdmin ? "/admin/organization" : null;
		case "org_domain":
			return options.isAdmin ? "/admin/organization/domains" : null;
		case "org":
			// System log: the org's page on the system dashboard.
			return options.isAdmin && id ? `/admin/orgs/${id}` : null;
		default:
			return null;
	}
}

const METADATA_LABELS: Record<string, string> = {
	reason: "Grund",
	fields: "Geänderte Felder",
	role: "Rolle",
	password: "Passwort",
	sessions: "Sitzungen",
	expires_at: "Gültig bis",
	status: "Status",
	amount_cents: "Betrag",
	from: "Vorher",
	to: "Nachher",
};

const METADATA_VALUES: Record<string, string> = {
	link: "per Einrichtungs-Link",
	set: "von Admin festgelegt",
	...ORG_ROLE_LABELS,
};

function formatMetadataValue(key: string, value: unknown): string {
	if (value === null || value === undefined || value === "") return "–";
	if (key.endsWith("_at") && typeof value === "number") return formatDate(value);
	if (key.endsWith("_cents") && typeof value === "number") return formatCents(value);
	if (Array.isArray(value)) return value.map((item) => formatMetadataValue("", item)).join(", ");
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		// `{ from, to }` reads as a change.
		if (entries.length === 2 && "from" in value && "to" in value) {
			const change = value as { from: unknown; to: unknown };
			return `${formatMetadataValue(key, change.from)} → ${formatMetadataValue(key, change.to)}`;
		}
		return JSON.stringify(value);
	}
	return METADATA_VALUES[String(value)] ?? String(value);
}

/** Metadata as label/value rows for the expanded row, in German where the key is known. */
export function auditMetadataRows(metadata: AuditEntry["metadata"]) {
	return Object.entries(metadata ?? {}).map(([key, value]) => ({
		key: METADATA_LABELS[key] ?? key,
		value: formatMetadataValue(key, value),
	}));
}
