import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdir as fs_mkdir } from "fs/promises";
import { dirname as path_dirname, join as path_join } from "path";
import { ConfigHandler } from "../utils/config";
import { AppConstants } from "../utils/constants";
import { LCrypt } from "../utils/crypto/lcrypt";
import { Logger } from "../utils/logger";
import * as TableSchema from "./schema";
import type { DrizzleDB } from "./utils";

export class DB {
	protected static db: DrizzleDB.BunSQLite;

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

		if (autoMigrate) {
			Logger.info("Running database migrations...");

			//@ts-ignore
			if (Bun?.isStandaloneExecutable) {
				// `bun build --compile --asset ./drizzle/migrations` embeds the files as `migrations/...`
				// next to the entry (`/$bunfs/root/migrations` on Linux) — without the `drizzle/` segment.
				migrationsFolder = path_join(import.meta.dir, "migrations");
			}

			await migrate(this.db, { migrationsFolder });

			Logger.info("Database migrations completed.");
		}

		await this.createInitialAdminUserIfNeeded(configBaseDir);

		Logger.info(`Database initialized at ${path}`);
	}

	private static async createInitialAdminUserIfNeeded(configBaseDir: string) {
		const usersTableEmpty = (await this.db.select().from(DB.Tables.users).limit(1)).length === 0;
		if (!usersTableEmpty) return;

		const username = "admin";
		const passwordResetToken = LCrypt.randomBytes(64).toString("hex");

		let admin_user_id: number;

		try {
			admin_user_id = await this.db.transaction(async (tx) => {
				const admin_user_id = await tx
					.insert(DB.Tables.users)
					.values({
						username,
						email: `${username}@${AppConstants.DEFAULT_EMAIL_FROM_HOST}`,
						password_hash: await Bun.password.hash(LCrypt.randomBytes(32).toString("hex")),
						display_name: "Default Administrator",
						role: "admin",
					})
					.returning()
					.get().id;

				await tx.insert(DB.Tables.passwordResets).values({
					token: LCrypt.sha256(passwordResetToken).toHex(),
					user_id: admin_user_id,
					expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 Days
				});

				return admin_user_id;
			});
		} catch (error) {
			Logger.critical("Failed to create initial admin user:", error);
			throw error;
		}

		// APP_URL is a required config value; the fallback only covers the
		// impossible-after-loadConfig undefined case so the token file is still usable.
		const APP_URL = ConfigHandler.getConfig()?.APP_URL || "https://<app-url>";

		await Bun.write(
			`${configBaseDir}/initial_admin_password_reset_token.txt`,
			`${APP_URL}/auth/reset-password?token=${passwordResetToken}`,
			{
				mode: 0o600,
				createPath: true,
			},
		);

		Logger.info(
			`Initial admin user created with username: ${username}.\n` +
				`You can set the password under ${APP_URL}/auth/reset-password?token=${passwordResetToken}\n` +
				`The url is also saved at ${configBaseDir}/initial_admin_password_reset_token.txt\n`,
		);

		return admin_user_id;
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
