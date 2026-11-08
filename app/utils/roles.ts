/**
 * Labels, colours and rank checks for organisation roles (`users.role`) and event roles
 * (`event_members.role`). Mirrors `PermissionHelper` on the server; the server stays the
 * authority — the frontend only uses this to hide controls and navigation.
 */
export type OrgRole = "admin" | "core_team" | "volunteer" | "unverified";
export type EventRole = "leader" | "staff";

export type BadgeColor = "error" | "primary" | "info" | "neutral" | "success" | "warning";

const ORG_ROLE_RANK: Record<OrgRole, number> = {
	unverified: 0,
	volunteer: 1,
	core_team: 2,
	admin: 3,
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
	admin: "Admin",
	core_team: "Kernteam",
	volunteer: "Mitarbeiter:in",
	unverified: "Nicht freigeschaltet",
};

const ORG_ROLE_COLORS: Record<OrgRole, BadgeColor> = {
	admin: "error",
	core_team: "primary",
	volunteer: "info",
	unverified: "neutral",
};

export const EVENT_ROLE_LABELS: Record<EventRole, string> = {
	leader: "Leitung",
	staff: "Mitarbeiter:in",
};

const EVENT_ROLE_COLORS: Record<EventRole, BadgeColor> = {
	leader: "primary",
	staff: "neutral",
};

export function hasOrgRole(role: string | null | undefined, minimum: OrgRole) {
	if (!role || !(role in ORG_ROLE_RANK)) return false;
	return ORG_ROLE_RANK[role as OrgRole] >= ORG_ROLE_RANK[minimum];
}

export function getRoleColor(role: string | null | undefined): BadgeColor {
	return ORG_ROLE_COLORS[role as OrgRole] ?? "neutral";
}

export function getRoleLabel(role: string | null | undefined) {
	return ORG_ROLE_LABELS[role as OrgRole] ?? "Unbekannt";
}

export function getEventRoleColor(role: string | null | undefined): BadgeColor {
	return EVENT_ROLE_COLORS[role as EventRole] ?? "neutral";
}

export function getEventRoleLabel(role: string | null | undefined) {
	return EVENT_ROLE_LABELS[role as EventRole] ?? "Kein Zugriff";
}

export const ORG_ROLE_OPTIONS = (Object.keys(ORG_ROLE_LABELS) as OrgRole[]).map((value) => ({
	label: ORG_ROLE_LABELS[value],
	value,
}));

export const EVENT_ROLE_OPTIONS = (Object.keys(EVENT_ROLE_LABELS) as EventRole[]).map((value) => ({
	label: EVENT_ROLE_LABELS[value],
	value,
}));
