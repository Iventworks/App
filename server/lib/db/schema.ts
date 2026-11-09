import type { TaskHandler } from "@cleverjs/utils";
import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	blob,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { UserAccountSettings } from "../api/utils/shared-models/accountData";
import { SQLUtils } from "./utils";

// Conventions: snake_case tables/columns, integer autoincrement ids, unix-ms timestamps,
// date-only values as ISO `YYYY-MM-DD` text, money as integer cents.
// Foreign keys are enforced (`PRAGMA foreign_keys = ON` in DB.init), so `onDelete` actions apply.

// ---------------------------------------------------------------------------
// Organisations (tenants)
// ---------------------------------------------------------------------------

export const ORG_KINDS = ["org", "system"] as const;

/**
 * Tailwind palettes an org can pick as its primary colour (Nuxt UI `ui.colors.primary`).
 * Neutral greys are left out: they would look like the slate UI around them.
 */
export const ORG_PRIMARY_COLORS = [
	"red",
	"orange",
	"amber",
	"yellow",
	"lime",
	"green",
	"emerald",
	"teal",
	"cyan",
	"sky",
	"blue",
	"indigo",
	"violet",
	"purple",
	"fuchsia",
	"pink",
	"rose",
] as const;

export const ORG_ASSET_KINDS = ["logo", "icon"] as const;

/**
 * Every tenant. All org data carries `org_id` (see `orgIdColumn`) and every query filters by it
 * (`inOrg`, enforced by the tenant guard in `server/lib/orgs/guard.ts`).
 * `kind = "system"` is the one internal org of the system admins (multi-org mode): it owns no
 * events, only its users, sessions, invitations and audit log.
 * @deprecated Use DB.Tables.orgs to access this table.
 */
export const orgs = sqliteTable("orgs", {
	id: SQLUtils.primaryKeyIntAutoIncrement("id"),
	// Lower-case DNS label used in the default domain `<slug>.<base host>`. Never changes.
	slug: text().notNull().unique(),
	kind: text({ enum: ORG_KINDS }).notNull().default("org"),
	display_name: text().notNull(),
	primary_color: text({ enum: ORG_PRIMARY_COLORS }).notNull().default("fuchsia"),
	created_at: SQLUtils.getCreatedAtColumn(),
	updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
});

/** `org_id` of an org-owned table: required, and deleting the org deletes the row. */
function orgIdColumn() {
	return integer()
		.notNull()
		.references(() => orgs.id, { onDelete: "cascade" });
}

/**
 * Custom domains of an org (multi-org mode). A domain only serves the org once both DNS checks
 * passed: the TXT record `_iventworks-challenge.<domain>` with `verification_token`, and a CNAME
 * to the org's default domain. While a verified primary domain exists, every other domain of the
 * org redirects page loads to it.
 * @deprecated Use DB.Tables.orgDomains to access this table.
 */
export const orgDomains = sqliteTable(
	"org_domains",
	{
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		org_id: orgIdColumn(),
		// Lower-case, no port, no trailing dot. One org per domain.
		domain: text().notNull().unique(),
		verification_token: text().notNull(),
		verified_at: integer(),
		is_primary: integer({ mode: "boolean" }).notNull().default(false),
		last_checked_at: integer(),
		// German explanation of the last failed check, shown next to the domain.
		last_check_error: text(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [index("org_domains_org_id_idx").on(table.org_id)],
);

/**
 * Branding images of an org: the logo (sidebar, login) and the square icon (favicon, app icon).
 * Small enough (see `OrgBranding.MAX_ASSET_BYTES`) to live in the database.
 * @deprecated Use DB.Tables.orgAssets to access this table.
 */
export const orgAssets = sqliteTable(
	"org_assets",
	{
		org_id: orgIdColumn(),
		kind: text({ enum: ORG_ASSET_KINDS }).notNull(),
		mime_type: text().notNull(),
		data: blob({ mode: "buffer" }).notNull(),
		// Square icons: the PNG's width in px (manifest `sizes`); null for SVG.
		size_px: integer(),
		updated_at: integer().notNull(),
	},
	(table) => [primaryKey({ columns: [table.org_id, table.kind] })],
);

// ---------------------------------------------------------------------------
// Accounts & auth
// ---------------------------------------------------------------------------

/**
 * @deprecated Use DB.Tables.users to access this table.
 */
export const users = sqliteTable(
	"users",
	{
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		org_id: orgIdColumn(),

		// Unique per org (see the indexes below): every org has its own accounts.
		username: text().notNull(),
		display_name: text().notNull(),
		email: text().notNull(),
		password_hash: text().notNull(),

		role: text({
			enum: UserAccountSettings.Roles,
		})
			.default("unverified")
			.notNull(),

		phone: text(),

		// Set while an admin has suspended the account: no login, all sessions and API keys revoked.
		suspended_at: integer(),
		suspended_reason: text(),

		last_login_at: integer(),

		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		uniqueIndex("users_org_username_unique").on(table.org_id, table.username),
		uniqueIndex("users_org_email_unique").on(table.org_id, table.email),
	],
);

/**
 * @deprecated Use DB.Tables.passwordResets to access this table.
 */
export const passwordResets = sqliteTable("password_resets", {
	org_id: orgIdColumn(),
	token: text().primaryKey(),
	user_id: integer()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	created_at: SQLUtils.getCreatedAtColumn(),
	expires_at: integer().notNull(),
});

/**
 * @deprecated Use DB.Tables.sessions to access this table.
 */
export const sessions = sqliteTable("sessions", {
	org_id: orgIdColumn(),
	id: text().primaryKey(),
	hashed_token: text().notNull(),
	user_id: integer()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	// we cache user role here for easier permission checking without having to join the users table, and we will check the role in users table on every update to make sure it's still valid
	user_role: text({
		enum: UserAccountSettings.Roles,
	}).notNull(),
	created_at: SQLUtils.getCreatedAtColumn(),
	expires_at: integer().notNull(),
});

/**
 * @deprecated Use DB.Tables.apiKeys to access this table.
 */
export const apiKeys = sqliteTable("api_keys", {
	org_id: orgIdColumn(),
	id: text().primaryKey(),
	hashed_token: text().notNull(),
	user_id: integer()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	// we cache user role here for easier permission checking without having to join the users table, and we will check the role in users table on every update to make sure it's still valid
	user_role: text({
		enum: UserAccountSettings.Roles,
	}).notNull(),
	description: text().notNull(),
	created_at: SQLUtils.getCreatedAtColumn(),
	expires_at: integer(),
});

/**
 * @deprecated Use DB.Tables.userPreferences to access this table.
 */
export const userPreferences = sqliteTable(
	"user_preferences",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		created_at: SQLUtils.getCreatedAtColumn(),

		// Preference key, e.g. "onboarding".
		key: text().notNull(),
		data: text({ mode: "json" }).$type<Record<string, any> | Array<any>>().notNull(),
	},
	(table) => [uniqueIndex("user_preferences_user_id_key_unique").on(table.user_id, table.key)],
);

/**
 * Admin-issued invitations. Signup is invite-only: the token (stored hashed) lets the invitee
 * pick a username and password once.
 * @deprecated Use DB.Tables.invitations to access this table.
 */
export const invitations = sqliteTable(
	"invitations",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		token_hash: text().notNull().unique(),
		email: text().notNull(),
		display_name: text(),
		role: text({ enum: UserAccountSettings.Roles }).notNull().default("volunteer"),
		invited_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		expires_at: integer().notNull(),
		accepted_at: integer(),
		accepted_user_id: integer().references(() => users.id, { onDelete: "set null" }),
	},
	(table) => [index("invitations_org_id_idx").on(table.org_id)],
);

// ---------------------------------------------------------------------------
// Events (camps & events) and their staff
// ---------------------------------------------------------------------------

export const EVENT_TYPES = ["camp", "event"] as const;
export const EVENT_STATUSES = ["planning", "confirmed", "cancelled", "archived"] as const;
export const EVENT_MEMBER_ROLES = ["leader", "staff"] as const;

/**
 * @deprecated Use DB.Tables.events to access this table.
 */
export const events = sqliteTable(
	"events",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		name: text().notNull(),
		type: text({ enum: EVENT_TYPES }).notNull().default("camp"),
		status: text({ enum: EVENT_STATUSES }).notNull().default("planning"),
		description: text().notNull().default(""),
		location: text(),
		// Date-only, inclusive: `YYYY-MM-DD`.
		start_date: text().notNull(),
		end_date: text().notNull(),
		color: text(),
		max_participants: integer(),
		participant_fee_cents: integer(),
		budget_cents: integer().notNull().default(0),
		created_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [index("events_org_id_idx").on(table.org_id)],
);

/**
 * @deprecated Use DB.Tables.rooms to access this table.
 */
export const rooms = sqliteTable(
	"rooms",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text().notNull(),
		capacity: integer(),
		notes: text().notNull().default(""),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [index("rooms_event_id_idx").on(table.event_id)],
);

/**
 * Staff of an event: "Leiter" (leader) or "Mitarbeiter" (staff).
 * @deprecated Use DB.Tables.eventMembers to access this table.
 */
export const eventMembers = sqliteTable(
	"event_members",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text({ enum: EVENT_MEMBER_ROLES }).notNull().default("staff"),
		// Free-text function, e.g. "Küchenchef", "Erste Hilfe".
		position: text(),
		room_id: integer().references(() => rooms.id, { onDelete: "set null" }),
		// Leader-only notes about this staff member.
		leader_notes: text().notNull().default(""),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		uniqueIndex("event_members_event_user_unique").on(table.event_id, table.user_id),
		index("event_members_user_id_idx").on(table.user_id),
	],
);

/**
 * Sub-groups of an event's staff, e.g. "Leitungsteam", "Küchenteam", "Musikteam".
 * Each group has its own chat channel and notes.
 * @deprecated Use DB.Tables.eventGroups to access this table.
 */
export const eventGroups = sqliteTable(
	"event_groups",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		name: text().notNull(),
		description: text().notNull().default(""),
		color: text(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [index("event_groups_event_id_idx").on(table.event_id)],
);

/**
 * @deprecated Use DB.Tables.eventGroupMembers to access this table.
 */
export const eventGroupMembers = sqliteTable(
	"event_group_members",
	{
		org_id: orgIdColumn(),
		group_id: integer()
			.notNull()
			.references(() => eventGroups.id, { onDelete: "cascade" }),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [primaryKey({ columns: [table.group_id, table.user_id] })],
);

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export const PARTICIPANT_STATUSES = ["registered", "confirmed", "waitlist", "cancelled"] as const;
export const GENDERS = ["female", "male", "diverse"] as const;

/**
 * @deprecated Use DB.Tables.participants to access this table.
 */
export const participants = sqliteTable(
	"participants",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		first_name: text().notNull(),
		last_name: text().notNull(),
		birth_date: text(),
		gender: text({ enum: GENDERS }),
		email: text(),
		phone: text(),
		address: text(),
		guardian_name: text(),
		guardian_phone: text(),

		// Medical & care information (visible to the event's staff only).
		allergies: text().notNull().default(""),
		medications: text().notNull().default(""),
		dietary_requirements: text().notNull().default(""),
		medical_notes: text().notNull().default(""),
		can_swim: integer({ mode: "boolean" }),
		photo_consent: integer({ mode: "boolean" }).notNull().default(false),

		notes: text().notNull().default(""),
		room_id: integer().references(() => rooms.id, { onDelete: "set null" }),
		status: text({ enum: PARTICIPANT_STATUSES }).notNull().default("registered"),
		fee_paid: integer({ mode: "boolean" }).notNull().default(false),

		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [index("participants_event_id_idx").on(table.event_id)],
);

/**
 * @deprecated Use DB.Tables.participantEmergencyContacts to access this table.
 */
export const participantEmergencyContacts = sqliteTable("participant_emergency_contacts", {
	org_id: orgIdColumn(),
	id: SQLUtils.primaryKeyIntAutoIncrement("id"),
	participant_id: integer()
		.notNull()
		.references(() => participants.id, { onDelete: "cascade" }),
	name: text().notNull(),
	relation: text(),
	phone: text().notNull(),
	created_at: SQLUtils.getCreatedAtColumn(),
});

/**
 * Notes by staff members about a participant.
 * @deprecated Use DB.Tables.participantNotes to access this table.
 */
export const participantNotes = sqliteTable("participant_notes", {
	org_id: orgIdColumn(),
	id: SQLUtils.primaryKeyIntAutoIncrement("id"),
	participant_id: integer()
		.notNull()
		.references(() => participants.id, { onDelete: "cascade" }),
	author_id: integer().references(() => users.id, { onDelete: "set null" }),
	content: text().notNull(),
	created_at: SQLUtils.getCreatedAtColumn(),
});

// ---------------------------------------------------------------------------
// Files (documents & folders, receipts)
// ---------------------------------------------------------------------------

export const FILE_SCOPES = ["org", "event", "receipt"] as const;
export const FILE_KINDS = ["folder", "file"] as const;

/**
 * Documents and folders. `scope = org` is the organisation-wide library (read: everyone,
 * write: core team), `scope = event` an event's documents, `scope = receipt` expense proofs.
 * Blobs live on disk under `<DATA_DIR>/uploads/<storage_key>`.
 * @deprecated Use DB.Tables.files to access this table.
 */
export const files = sqliteTable(
	"files",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		scope: text({ enum: FILE_SCOPES }).notNull(),
		event_id: integer().references(() => events.id, { onDelete: "cascade" }),
		parent_id: integer().references((): AnySQLiteColumn => files.id, { onDelete: "cascade" }),
		kind: text({ enum: FILE_KINDS }).notNull(),
		name: text().notNull(),
		mime_type: text(),
		size: integer().notNull().default(0),
		storage_key: text(),
		uploaded_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [
		index("files_org_id_idx").on(table.org_id),
		index("files_scope_event_idx").on(table.scope, table.event_id),
		index("files_parent_id_idx").on(table.parent_id),
	],
);

// ---------------------------------------------------------------------------
// Program (schedule), responsibilities
// ---------------------------------------------------------------------------

/**
 * A "Programmpunkt" in an event's schedule.
 * @deprecated Use DB.Tables.programItems to access this table.
 */
export const programItems = sqliteTable(
	"program_items",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		title: text().notNull(),
		description: text().notNull().default(""),
		location: text(),
		category: text(),
		color: text(),
		start_at: integer().notNull(),
		end_at: integer().notNull(),
		created_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [index("program_items_event_start_idx").on(table.event_id, table.start_at)],
);

/**
 * @deprecated Use DB.Tables.programItemResponsibles to access this table.
 */
export const programItemResponsibles = sqliteTable(
	"program_item_responsibles",
	{
		org_id: orgIdColumn(),
		program_item_id: integer()
			.notNull()
			.references(() => programItems.id, { onDelete: "cascade" }),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.program_item_id, table.user_id] })],
);

/**
 * Documents or folders attached to a program item (e.g. slides, rules).
 * @deprecated Use DB.Tables.programItemFiles to access this table.
 */
export const programItemFiles = sqliteTable(
	"program_item_files",
	{
		org_id: orgIdColumn(),
		program_item_id: integer()
			.notNull()
			.references(() => programItems.id, { onDelete: "cascade" }),
		file_id: integer()
			.notNull()
			.references(() => files.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.program_item_id, table.file_id] })],
);

/**
 * Standing responsibilities ("Zuständigkeiten"), e.g. "Erste Hilfe", "Getränke", "Haus 2".
 * @deprecated Use DB.Tables.responsibilities to access this table.
 */
export const responsibilities = sqliteTable(
	"responsibilities",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		title: text().notNull(),
		description: text().notNull().default(""),
		location: text(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [index("responsibilities_event_id_idx").on(table.event_id)],
);

/**
 * @deprecated Use DB.Tables.responsibilityAssignees to access this table.
 */
export const responsibilityAssignees = sqliteTable(
	"responsibility_assignees",
	{
		org_id: orgIdColumn(),
		responsibility_id: integer()
			.notNull()
			.references(() => responsibilities.id, { onDelete: "cascade" }),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.responsibility_id, table.user_id] })],
);

// ---------------------------------------------------------------------------
// Tasks, notes, announcements
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["open", "in_progress", "done"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/**
 * Personal tasks (`event_id IS NULL`, owned by `user_id`) and event tasks (`event_id` set,
 * optionally assigned to a user and/or a group).
 * @deprecated Use DB.Tables.tasks to access this table.
 */
export const tasks = sqliteTable(
	"tasks",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer().references(() => events.id, { onDelete: "cascade" }),
		user_id: integer().references(() => users.id, { onDelete: "cascade" }),
		group_id: integer().references(() => eventGroups.id, { onDelete: "set null" }),
		assignee_id: integer().references(() => users.id, { onDelete: "set null" }),
		title: text().notNull(),
		description: text().notNull().default(""),
		status: text({ enum: TASK_STATUSES }).notNull().default("open"),
		priority: text({ enum: TASK_PRIORITIES }).notNull().default("normal"),
		due_at: integer(),
		completed_at: integer(),
		created_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [
		index("tasks_org_id_idx").on(table.org_id),
		index("tasks_event_id_idx").on(table.event_id),
		index("tasks_user_id_idx").on(table.user_id),
		index("tasks_assignee_id_idx").on(table.assignee_id),
	],
);

export const NOTE_SCOPES = ["personal", "event", "group", "core_team"] as const;

/**
 * Notes: personal (`user_id`), event-wide (`event_id`), group-level (`group_id`) or the core
 * team's internal notes (`scope = core_team`).
 * @deprecated Use DB.Tables.notes to access this table.
 */
export const notes = sqliteTable(
	"notes",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		scope: text({ enum: NOTE_SCOPES }).notNull(),
		user_id: integer().references(() => users.id, { onDelete: "cascade" }),
		event_id: integer().references(() => events.id, { onDelete: "cascade" }),
		group_id: integer().references(() => eventGroups.id, { onDelete: "cascade" }),
		title: text().notNull(),
		content: text().notNull().default(""),
		pinned: integer({ mode: "boolean" }).notNull().default(false),
		created_by: integer().references(() => users.id, { onDelete: "set null" }),
		updated_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [
		index("notes_org_id_idx").on(table.org_id),
		index("notes_scope_idx").on(table.scope),
		index("notes_user_id_idx").on(table.user_id),
		index("notes_event_id_idx").on(table.event_id),
	],
);

export const ANNOUNCEMENT_PRIORITIES = ["normal", "important"] as const;

/**
 * News/infos: per event (`event_id`) or organisation-wide (`event_id IS NULL`).
 * @deprecated Use DB.Tables.announcements to access this table.
 */
export const announcements = sqliteTable(
	"announcements",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer().references(() => events.id, { onDelete: "cascade" }),
		title: text().notNull(),
		content: text().notNull().default(""),
		priority: text({ enum: ANNOUNCEMENT_PRIORITIES }).notNull().default("normal"),
		pinned: integer({ mode: "boolean" }).notNull().default(false),
		created_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		index("announcements_org_id_idx").on(table.org_id),
		index("announcements_event_id_idx").on(table.event_id),
	],
);

// ---------------------------------------------------------------------------
// Finances
// ---------------------------------------------------------------------------

export const EXPENSE_STATUSES = ["submitted", "approved", "rejected", "reimbursed"] as const;
export const BUDGET_ITEM_KINDS = ["expense", "income"] as const;

/**
 * Expenses/receipts submitted by staff, reviewed by the event's leaders.
 * @deprecated Use DB.Tables.expenses to access this table.
 */
export const expenses = sqliteTable(
	"expenses",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		submitted_by: integer().references(() => users.id, { onDelete: "set null" }),
		title: text().notNull(),
		description: text().notNull().default(""),
		category: text().notNull().default("Sonstiges"),
		amount_cents: integer().notNull(),
		spent_on: text().notNull(),
		receipt_file_id: integer().references(() => files.id, { onDelete: "set null" }),
		status: text({ enum: EXPENSE_STATUSES }).notNull().default("submitted"),
		reviewed_by: integer().references(() => users.id, { onDelete: "set null" }),
		reviewed_at: integer(),
		review_note: text(),
		created_at: SQLUtils.getCreatedAtColumn(),
		updated_at: SQLUtils.getCreatedAtColumn("updated_at"),
	},
	(table) => [index("expenses_event_id_idx").on(table.event_id)],
);

/**
 * Planned budget lines of an event (leaders only).
 * @deprecated Use DB.Tables.budgetItems to access this table.
 */
export const budgetItems = sqliteTable(
	"budget_items",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		kind: text({ enum: BUDGET_ITEM_KINDS }).notNull().default("expense"),
		category: text().notNull(),
		description: text().notNull().default(""),
		planned_cents: integer().notNull(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [index("budget_items_event_id_idx").on(table.event_id)],
);

// ---------------------------------------------------------------------------
// Organisation resources (inventory) & bookings
// ---------------------------------------------------------------------------

/**
 * @deprecated Use DB.Tables.orgResources to access this table.
 */
export const orgResources = sqliteTable(
	"org_resources",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		name: text().notNull(),
		category: text().notNull().default("Allgemein"),
		quantity: integer().notNull().default(1),
		location: text(),
		notes: text().notNull().default(""),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [index("org_resources_org_id_idx").on(table.org_id)],
);

/**
 * A resource reserved for an event (for the event's date range).
 * @deprecated Use DB.Tables.resourceBookings to access this table.
 */
export const resourceBookings = sqliteTable(
	"resource_bookings",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		resource_id: integer()
			.notNull()
			.references(() => orgResources.id, { onDelete: "cascade" }),
		event_id: integer()
			.notNull()
			.references(() => events.id, { onDelete: "cascade" }),
		quantity: integer().notNull().default(1),
		notes: text().notNull().default(""),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		index("resource_bookings_resource_id_idx").on(table.resource_id),
		index("resource_bookings_event_id_idx").on(table.event_id),
	],
);

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export const CONVERSATION_TYPES = ["direct", "group", "event", "event_group", "core_team"] as const;

/**
 * Chats. `direct`/`group` have explicit members; `event` (all staff of an event),
 * `event_group` (members of an event group) and `core_team` derive access from those memberships.
 * @deprecated Use DB.Tables.conversations to access this table.
 */
export const conversations = sqliteTable(
	"conversations",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		type: text({ enum: CONVERSATION_TYPES }).notNull(),
		name: text(),
		event_id: integer().references(() => events.id, { onDelete: "cascade" }),
		group_id: integer().references(() => eventGroups.id, { onDelete: "cascade" }),
		created_by: integer().references(() => users.id, { onDelete: "set null" }),
		created_at: SQLUtils.getCreatedAtColumn(),
		last_message_at: integer(),
	},
	(table) => [
		index("conversations_org_id_idx").on(table.org_id),
		index("conversations_event_id_idx").on(table.event_id),
		uniqueIndex("conversations_group_id_unique").on(table.group_id),
	],
);

/**
 * Explicit members (direct/group chats) and per-user read state for every conversation type.
 * @deprecated Use DB.Tables.conversationMembers to access this table.
 */
export const conversationMembers = sqliteTable(
	"conversation_members",
	{
		org_id: orgIdColumn(),
		conversation_id: integer()
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		// Explicit member (direct/group); false = read-state row only (derived-access chats).
		is_member: integer({ mode: "boolean" }).notNull().default(true),
		last_read_at: integer().notNull().default(0),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		primaryKey({ columns: [table.conversation_id, table.user_id] }),
		index("conversation_members_user_id_idx").on(table.user_id),
	],
);

/**
 * @deprecated Use DB.Tables.messages to access this table.
 */
export const messages = sqliteTable(
	"messages",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		conversation_id: integer()
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		sender_id: integer().references(() => users.id, { onDelete: "set null" }),
		content: text().notNull(),
		created_at: SQLUtils.getCreatedAtColumn(),
		edited_at: integer(),
		// Soft delete: a tombstone (content cleared) so polling clients learn about deletions.
		deleted_at: integer(),
	},
	(table) => [
		index("messages_conversation_created_idx").on(table.conversation_id, table.created_at),
	],
);

// ---------------------------------------------------------------------------
// Personal calendar & notifications
// ---------------------------------------------------------------------------

/**
 * @deprecated Use DB.Tables.calendarEntries to access this table.
 */
export const calendarEntries = sqliteTable(
	"calendar_entries",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		title: text().notNull(),
		description: text().notNull().default(""),
		location: text(),
		start_at: integer().notNull(),
		end_at: integer().notNull(),
		all_day: integer({ mode: "boolean" }).notNull().default(false),
		color: text(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		index("calendar_entries_org_id_idx").on(table.org_id),
		index("calendar_entries_user_start_idx").on(table.user_id, table.start_at),
	],
);

/**
 * @deprecated Use DB.Tables.notifications to access this table.
 */
export const notifications = sqliteTable(
	"notifications",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		user_id: integer()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		type: text().notNull(),
		title: text().notNull(),
		body: text().notNull().default(""),
		link: text(),
		read_at: integer(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		index("notifications_org_id_idx").on(table.org_id),
		index("notifications_user_created_idx").on(table.user_id, table.created_at),
	],
);

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Who changed what. Event-scoped entries (`event_id` set) are visible to that event's leaders;
 * the full log to admins.
 * @deprecated Use DB.Tables.auditLogs to access this table.
 */
export const auditLogs = sqliteTable(
	"audit_logs",
	{
		org_id: orgIdColumn(),
		id: SQLUtils.primaryKeyIntAutoIncrement("id"),
		user_id: integer().references(() => users.id, { onDelete: "set null" }),
		event_id: integer().references(() => events.id, { onDelete: "set null" }),
		action: text().notNull(),
		entity_type: text().notNull(),
		entity_id: integer(),
		summary: text().notNull(),
		metadata: text({ mode: "json" }).$type<Record<string, any>>(),
		created_at: SQLUtils.getCreatedAtColumn(),
	},
	(table) => [
		index("audit_logs_org_id_idx").on(table.org_id),
		index("audit_logs_event_created_idx").on(table.event_id, table.created_at),
		index("audit_logs_created_idx").on(table.created_at),
		index("audit_logs_entity_idx").on(table.entity_type, table.entity_id),
		index("audit_logs_user_created_idx").on(table.user_id, table.created_at),
	],
);

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

/**
 * @deprecated Use DB.Tables.scheduled_tasks to access this table.
 */
export const scheduled_tasks = sqliteTable("scheduled_tasks", {
	id: integer().primaryKey({ autoIncrement: true }),
	function: text().notNull(),
	created_by_user_id: integer().references(() => users.id, { onDelete: "set null" }),
	args: text({ mode: "json" }).$type<Record<string, any>>().notNull(),
	autoDelete: integer({ mode: "boolean" }).notNull().default(sql`0`),
	storeLogs: integer({ mode: "boolean" }).notNull().default(sql`0`),
	status: text({ enum: ["pending", "running", "paused", "failed", "completed"] })
		.notNull()
		.default("pending"),
	created_at: integer().notNull(),
	finished_at: integer(),
	result: text({ mode: "json" }).$type<Record<string, any>>(),
	message: text(),
});

/**
 * @deprecated Use DB.Tables.scheduled_tasks_paused_state to access this table.
 */
export const scheduled_tasks_paused_state = sqliteTable("scheduled_tasks_paused_state", {
	task_id: integer()
		.primaryKey()
		.references(() => scheduled_tasks.id, { onDelete: "cascade" }),
	next_step_to_execute: integer().notNull(),
	data: text({ mode: "json" }).$type<TaskHandler.TempPausedTaskState["data"]>().notNull(),
});

/**
 * @deprecated Use DB.Tables.metadata to access this table.
 */
export const metadata = sqliteTable("metadata", {
	key: text().primaryKey(),
	data: text({ mode: "json" }).$type<Record<string, any> | Array<any>>().notNull(),
});
