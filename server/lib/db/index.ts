import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdir as fs_mkdir } from "fs/promises";
import { dirname as path_dirname, join as path_join } from "path";
import { OrgContext } from "../orgs/context";
import { TenantGuard } from "../orgs/guard";
import { Logger } from "../utils/logger";
import * as TableSchema from "./schema";
import type { DrizzleDB } from "./utils";

export class DB {
	protected static db: DrizzleDB.BunSQLite;

	/** Names of the tables that carry `org_id` — the ones the tenant guard checks. */
	static orgTableNames(): Set<string> {
		const names = new Set<string>();
		for (const table of Object.values(DB.Tables)) {
			if ("org_id" in getTableColumns(table)) names.add(getTableName(table));
		}
		return names;
	}

	static async init(
		path: string,
		autoMigrate: boolean,
		configBaseDir: string,
		migrationsFolder: string,
	) {
		await fs_mkdir(path_dirname(path), { recursive: true });
		await fs_mkdir(configBaseDir, { recursive: true });

		this.db = drizzle(path);

		// SQLite ignores FOREIGN KEY clauses (and their ON DELETE actions) unless enabled per
		// connection. WAL keeps readers from blocking the writer.
		this.db.$client.exec("PRAGMA foreign_keys = ON;");
		this.db.$client.exec("PRAGMA journal_mode = WAL;");

		// Every statement on an org table must filter by the current org (server/lib/orgs/guard.ts).
		TenantGuard.install(this.db.$client, DB.orgTableNames());

		if (autoMigrate) {
			Logger.info("Running database migrations...");

			//@ts-ignore
			if (Bun?.isStandaloneExecutable) {
				// `bun build --compile --asset ./drizzle/migrations` embeds the files as `migrations/...`
				// next to the entry (`/$bunfs/root/migrations` on Linux) — without the `drizzle/` segment.
				migrationsFolder = path_join(import.meta.dir, "migrations");
			}

			// Migrations copy whole tables (`insert into "__new_x" select … from "x"`): no org filter.
			await OrgContext.unscoped(() => migrate(this.db, { migrationsFolder }));

			Logger.info("Database migrations completed.");
		}

		Logger.info(`Database initialized at ${path}`);
	}

	static instance() {
		if (!this.db) {
			throw new Error("Database not initialized. Call DB.init() first.");
		}
		return DB.db;
	}

	static async close() {
		if (!this.db) return;

		Logger.info("Database connection closed.");
		await this.db.$client.close();

		// `close()` calls sqlite3_close_v2, which defers releasing the OS file
		// handle until any unfinalized prepared statements are garbage collected.
		// Force that now so the underlying file is actually free (e.g. for tests
		// that remove the DB file/directory right after closing).
		Bun.gc(true);
		await Bun.sleep(500);
	}
}

export namespace DB.Tables {
	export const orgs = TableSchema.orgs;
	export const orgDomains = TableSchema.orgDomains;
	export const orgAssets = TableSchema.orgAssets;

	export const users = TableSchema.users;
	export const sessions = TableSchema.sessions;
	export const passwordResets = TableSchema.passwordResets;
	export const apiKeys = TableSchema.apiKeys;
	export const invitations = TableSchema.invitations;

	export const userPreferences = TableSchema.userPreferences;

	export const events = TableSchema.events;
	export const eventMembers = TableSchema.eventMembers;
	export const eventGroups = TableSchema.eventGroups;
	export const eventGroupMembers = TableSchema.eventGroupMembers;
	export const rooms = TableSchema.rooms;

	export const participants = TableSchema.participants;
	export const participantEmergencyContacts = TableSchema.participantEmergencyContacts;
	export const participantNotes = TableSchema.participantNotes;

	export const files = TableSchema.files;
	export const fileShares = TableSchema.fileShares;

	export const programItems = TableSchema.programItems;
	export const programItemResponsibles = TableSchema.programItemResponsibles;
	export const programItemFiles = TableSchema.programItemFiles;
	export const responsibilities = TableSchema.responsibilities;
	export const responsibilityAssignees = TableSchema.responsibilityAssignees;

	export const tasks = TableSchema.tasks;
	export const notes = TableSchema.notes;
	export const announcements = TableSchema.announcements;

	export const expenses = TableSchema.expenses;
	export const budgetItems = TableSchema.budgetItems;

	export const orgResources = TableSchema.orgResources;
	export const resourceBookings = TableSchema.resourceBookings;

	export const conversations = TableSchema.conversations;
	export const conversationMembers = TableSchema.conversationMembers;
	export const messages = TableSchema.messages;

	export const calendarEntries = TableSchema.calendarEntries;
	export const notifications = TableSchema.notifications;

	export const auditLogs = TableSchema.auditLogs;

	export const scheduled_tasks = TableSchema.scheduled_tasks;
	export const scheduled_tasks_paused_state = TableSchema.scheduled_tasks_paused_state;

	export const metadata = TableSchema.metadata;
}

export namespace DB.Models {
	export type Org = typeof DB.Tables.orgs.$inferSelect;
	export type OrgDomain = typeof DB.Tables.orgDomains.$inferSelect;
	export type OrgAsset = typeof DB.Tables.orgAssets.$inferSelect;

	export type User = typeof DB.Tables.users.$inferSelect;
	export type Session = typeof DB.Tables.sessions.$inferSelect;
	export type PasswordReset = typeof DB.Tables.passwordResets.$inferSelect;
	export type ApiKey = typeof DB.Tables.apiKeys.$inferSelect;
	export type Invitation = typeof DB.Tables.invitations.$inferSelect;

	export type UserPreference = typeof DB.Tables.userPreferences.$inferSelect;

	export type Event = typeof DB.Tables.events.$inferSelect;
	export type EventMember = typeof DB.Tables.eventMembers.$inferSelect;
	export type EventGroup = typeof DB.Tables.eventGroups.$inferSelect;
	export type EventGroupMember = typeof DB.Tables.eventGroupMembers.$inferSelect;
	export type Room = typeof DB.Tables.rooms.$inferSelect;

	export type Participant = typeof DB.Tables.participants.$inferSelect;
	export type ParticipantEmergencyContact =
		typeof DB.Tables.participantEmergencyContacts.$inferSelect;
	export type ParticipantNote = typeof DB.Tables.participantNotes.$inferSelect;

	export type File = typeof DB.Tables.files.$inferSelect;
	export type FileShare = typeof DB.Tables.fileShares.$inferSelect;

	export type ProgramItem = typeof DB.Tables.programItems.$inferSelect;
	export type Responsibility = typeof DB.Tables.responsibilities.$inferSelect;

	export type Task = typeof DB.Tables.tasks.$inferSelect;
	export type Note = typeof DB.Tables.notes.$inferSelect;
	export type Announcement = typeof DB.Tables.announcements.$inferSelect;

	export type Expense = typeof DB.Tables.expenses.$inferSelect;
	export type BudgetItem = typeof DB.Tables.budgetItems.$inferSelect;

	export type OrgResource = typeof DB.Tables.orgResources.$inferSelect;
	export type ResourceBooking = typeof DB.Tables.resourceBookings.$inferSelect;

	export type Conversation = typeof DB.Tables.conversations.$inferSelect;
	export type ConversationMember = typeof DB.Tables.conversationMembers.$inferSelect;
	export type Message = typeof DB.Tables.messages.$inferSelect;

	export type CalendarEntry = typeof DB.Tables.calendarEntries.$inferSelect;
	export type Notification = typeof DB.Tables.notifications.$inferSelect;

	export type AuditLog = typeof DB.Tables.auditLogs.$inferSelect;

	export type ScheduledTask = typeof DB.Tables.scheduled_tasks.$inferSelect;
	export type ScheduledTaskPausedState = typeof DB.Tables.scheduled_tasks_paused_state.$inferSelect;

	export type Metadata = typeof DB.Tables.metadata.$inferSelect;
}
