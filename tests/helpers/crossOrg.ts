import { getTableName } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { APIKeyHandler, SessionHandler } from "../../server/lib/api/utils/authHandler";
import { FileShares } from "../../server/lib/api/utils/fileShares";
import { DB } from "../../server/lib/db";
import { OrgContext } from "../../server/lib/orgs/context";
import type { OrgInfo } from "../../server/lib/orgs/registry";
import { LCrypt } from "../../server/lib/utils/crypto/lcrypt";

/** Ids of one complete data set of an org, keyed by the API's path parameter names. */
export type SeededIds = Record<string, number | string>;

export interface SeededOrg {
	readonly org: OrgInfo;
	readonly marker: string;
	readonly ids: SeededIds;
	/** Every user id of the set, for `*_ids` arrays in request bodies. */
	readonly userIds: number[];
	readonly adminToken: string;
	readonly volunteerToken: string;
}

/**
 * One of everything in `org`, written directly to the DB. Every text field carries `marker`, so
 * a response that contains it leaked this org's data.
 */
export async function seedOrgData(org: OrgInfo, marker: string): Promise<SeededOrg> {
	return OrgContext.run(org, async () => {
		const db = DB.instance();
		const org_id = org.id;
		const now = Date.now();
		const text = (label: string) => `${label} ${marker}`;

		const user = async (role: DB.Models.User["role"], name: string) =>
			db
				.insert(DB.Tables.users)
				.values({
					org_id,
					username: `${name}-${marker}`.toLowerCase().slice(0, 30),
					display_name: text(name),
					email: `${name}.${marker}@example.com`.toLowerCase(),
					password_hash: await Bun.password.hash("Leak!Probe1"),
					role,
				})
				.returning()
				.get();

		const admin = await user("admin", "admin");
		const core = await user("core_team", "core");
		const volunteer = await user("volunteer", "volunteer");

		const event = db
			.insert(DB.Tables.events)
			.values({
				org_id,
				name: text("Event"),
				description: text("Beschreibung"),
				start_date: "2027-07-01",
				end_date: "2027-07-10",
				created_by: admin.id,
			})
			.returning()
			.get();
		const room = db
			.insert(DB.Tables.rooms)
			.values({ org_id, event_id: event.id, name: text("Raum"), notes: text("Notiz") })
			.returning()
			.get();
		const member = db
			.insert(DB.Tables.eventMembers)
			.values({
				org_id,
				event_id: event.id,
				user_id: volunteer.id,
				role: "staff",
				position: text("Position"),
				leader_notes: text("Leiternotiz"),
				room_id: room.id,
			})
			.returning()
			.get();
		db
			.insert(DB.Tables.eventMembers)
			.values({ org_id, event_id: event.id, user_id: admin.id, role: "leader" })
			.run();
		const group = db
			.insert(DB.Tables.eventGroups)
			.values({ org_id, event_id: event.id, name: text("Gruppe"), description: text("Gruppe") })
			.returning()
			.get();
		db
			.insert(DB.Tables.eventGroupMembers)
			.values({ org_id, group_id: group.id, user_id: volunteer.id })
			.run();
		const participant = db
			.insert(DB.Tables.participants)
			.values({
				org_id,
				event_id: event.id,
				first_name: text("Vorname"),
				last_name: text("Nachname"),
				allergies: text("Allergie"),
				medical_notes: text("Medizin"),
				notes: text("Notiz"),
				room_id: room.id,
			})
			.returning()
			.get();
		db
			.insert(DB.Tables.participantEmergencyContacts)
			.values({ org_id, participant_id: participant.id, name: text("Kontakt"), phone: "0123" })
			.run();
		const participantNote = db
			.insert(DB.Tables.participantNotes)
			.values({ org_id, participant_id: participant.id, author_id: admin.id, content: text("Notiz") })
			.returning()
			.get();
		const folder = db
			.insert(DB.Tables.files)
			.values({ org_id, scope: "org", kind: "folder", name: text("Ordner"), uploaded_by: admin.id })
			.returning()
			.get();
		const eventFile = db
			.insert(DB.Tables.files)
			.values({
				org_id,
				scope: "event",
				event_id: event.id,
				kind: "folder",
				name: text("Eventordner"),
				uploaded_by: admin.id,
			})
			.returning()
			.get();
		const programItem = db
			.insert(DB.Tables.programItems)
			.values({
				org_id,
				event_id: event.id,
				title: text("Programm"),
				description: text("Programm"),
				start_at: Date.UTC(2027, 6, 2, 9),
				end_at: Date.UTC(2027, 6, 2, 11),
				created_by: admin.id,
			})
			.returning()
			.get();
		db
			.insert(DB.Tables.programItemResponsibles)
			.values({ org_id, program_item_id: programItem.id, user_id: volunteer.id })
			.run();
		db
			.insert(DB.Tables.programItemFiles)
			.values({ org_id, program_item_id: programItem.id, file_id: eventFile.id })
			.run();
		const responsibility = db
			.insert(DB.Tables.responsibilities)
			.values({ org_id, event_id: event.id, title: text("Zuständigkeit"), description: text("Z") })
			.returning()
			.get();
		db
			.insert(DB.Tables.responsibilityAssignees)
			.values({ org_id, responsibility_id: responsibility.id, user_id: volunteer.id })
			.run();
		const task = db
			.insert(DB.Tables.tasks)
			.values({
				org_id,
				event_id: event.id,
				title: text("Aufgabe"),
				description: text("Aufgabe"),
				assignee_id: volunteer.id,
				group_id: group.id,
				created_by: admin.id,
			})
			.returning()
			.get();
		const personalTask = db
			.insert(DB.Tables.tasks)
			.values({ org_id, user_id: volunteer.id, title: text("Privat"), created_by: volunteer.id })
			.returning()
			.get();
		const note = db
			.insert(DB.Tables.notes)
			.values({
				org_id,
				scope: "event",
				event_id: event.id,
				title: text("Notiz"),
				content: text("Inhalt"),
				created_by: admin.id,
			})
			.returning()
			.get();
		const personalNote = db
			.insert(DB.Tables.notes)
			.values({
				org_id,
				scope: "personal",
				user_id: volunteer.id,
				title: text("Privatnotiz"),
				content: text("Inhalt"),
				created_by: volunteer.id,
			})
			.returning()
			.get();
		const coreNote = db
			.insert(DB.Tables.notes)
			.values({
				org_id,
				scope: "core_team",
				title: text("Kernteam"),
				content: text("Inhalt"),
				created_by: core.id,
			})
			.returning()
			.get();
		const announcement = db
			.insert(DB.Tables.announcements)
			.values({
				org_id,
				event_id: event.id,
				title: text("Info"),
				content: text("Info"),
				created_by: admin.id,
			})
			.returning()
			.get();
		const orgAnnouncement = db
			.insert(DB.Tables.announcements)
			.values({ org_id, title: text("Orginfo"), content: text("Info"), created_by: admin.id })
			.returning()
			.get();
		const expense = db
			.insert(DB.Tables.expenses)
			.values({
				org_id,
				event_id: event.id,
				submitted_by: volunteer.id,
				title: text("Ausgabe"),
				description: text("Ausgabe"),
				amount_cents: 1234,
				spent_on: "2027-07-03",
			})
			.returning()
			.get();
		const budgetItem = db
			.insert(DB.Tables.budgetItems)
			.values({
				org_id,
				event_id: event.id,
				category: text("Kategorie"),
				planned_cents: 5000,
				description: text("B"),
			})
			.returning()
			.get();
		const resource = db
			.insert(DB.Tables.orgResources)
			.values({ org_id, name: text("Zelt"), location: text("Lager"), notes: text("R") })
			.returning()
			.get();
		const booking = db
			.insert(DB.Tables.resourceBookings)
			.values({ org_id, resource_id: resource.id, event_id: event.id, notes: text("Buchung") })
			.returning()
			.get();
		const conversation = db
			.insert(DB.Tables.conversations)
			.values({
				org_id,
				type: "group",
				name: text("Chat"),
				created_by: admin.id,
				last_message_at: now,
			})
			.returning()
			.get();
		db
			.insert(DB.Tables.conversationMembers)
			.values([
				{ org_id, conversation_id: conversation.id, user_id: admin.id },
				{ org_id, conversation_id: conversation.id, user_id: volunteer.id },
			])
			.run();
		const message = db
			.insert(DB.Tables.messages)
			.values({
				org_id,
				conversation_id: conversation.id,
				sender_id: admin.id,
				content: text("Nachricht"),
				created_at: now,
			})
			.returning()
			.get();
		const entry = db
			.insert(DB.Tables.calendarEntries)
			.values({
				org_id,
				user_id: volunteer.id,
				title: text("Termin"),
				description: text("Termin"),
				start_at: Date.UTC(2027, 6, 5, 9),
				end_at: Date.UTC(2027, 6, 5, 10),
			})
			.returning()
			.get();
		const notification = db
			.insert(DB.Tables.notifications)
			.values({
				org_id,
				user_id: volunteer.id,
				type: "task_assigned",
				title: text("Hinweis"),
				body: text("Hinweis"),
			})
			.returning()
			.get();
		const invitation = db
			.insert(DB.Tables.invitations)
			.values({
				org_id,
				token_hash: LCrypt.sha256(`${marker}-invite`).toHex(),
				email: `invite.${marker}@example.com`.toLowerCase(),
				display_name: text("Eingeladen"),
				invited_by: admin.id,
				expires_at: now + 86_400_000,
			})
			.returning()
			.get();
		db
			.insert(DB.Tables.auditLogs)
			.values({
				org_id,
				user_id: admin.id,
				event_id: event.id,
				action: "update",
				entity_type: "event",
				entity_id: event.id,
				summary: text("Audit"),
				created_at: now,
			})
			.run();

		const domain = db
			.insert(DB.Tables.orgDomains)
			.values({ org_id, domain: `${marker.toLowerCase()}.example.com`, verification_token: marker })
			.returning()
			.get();

		// A link that allows everything, so attacks through foreign tokens are tried with full rights.
		const share = db
			.insert(DB.Tables.fileShares)
			.values({
				org_id,
				file_id: folder.id,
				token: FileShares.createToken(),
				label: text("Freigabe"),
				can_upload: true,
				can_edit: true,
				can_delete: true,
				created_by: admin.id,
			})
			.returning()
			.get();

		const adminSession = await SessionHandler.createSession(admin.id);
		const apiKey = await APIKeyHandler.createApiKey(volunteer.id, text("Schlüssel"));
		const volunteerSession = await SessionHandler.createSession(volunteer.id);

		return {
			org,
			marker,
			userIds: [admin.id, core.id, volunteer.id],
			adminToken: adminSession.token,
			volunteerToken: volunteerSession.token,
			ids: {
				eventId: event.id,
				userId: volunteer.id,
				memberId: member.id,
				groupId: group.id,
				roomId: room.id,
				participantId: participant.id,
				programItemId: programItem.id,
				responsibilityId: responsibility.id,
				taskId: task.id,
				personalTaskId: personalTask.id,
				noteId: note.id,
				personalNoteId: personalNote.id,
				coreNoteId: coreNote.id,
				participantNoteId: participantNote.id,
				announcementId: announcement.id,
				orgAnnouncementId: orgAnnouncement.id,
				expenseId: expense.id,
				budgetItemId: budgetItem.id,
				resourceId: resource.id,
				bookingId: booking.id,
				conversationId: conversation.id,
				messageId: message.id,
				entryId: entry.id,
				notificationId: notification.id,
				invitationId: invitation.id,
				fileId: folder.id,
				eventFileId: eventFile.id,
				sessionId: adminSession.token.split(":")[0]!.split("_").at(-1)!,
				apiKeyID: apiKey.token.split(":")[0]!.split("_").at(-1)!,
				domainId: domain.id,
				shareId: share.id,
				shareToken: share.token,
			},
		};
	});
}

/** All rows of `org` in every org table, for "nothing changed" comparisons. */
export async function snapshotOrg(orgId: number): Promise<Record<string, unknown[]>> {
	const client = DB.instance().$client;
	const snapshot: Record<string, unknown[]> = {};
	for (const name of DB.orgTableNames()) {
		// Raw client query: test code, not app code, and deliberately across the guard.
		snapshot[name] = client
			.query(`select * from "${name}" where "org_id" = ? order by rowid`)
			.all(orgId);
	}
	return snapshot;
}

/**
 * Rows that reference a row of another org through a foreign key — the trace a cross-org IDOR
 * leaves in the DB. Empty when every reference stays within its org.
 */
export function findCrossOrgReferences(): string[] {
	const client = DB.instance().$client;
	const problems: string[] = [];
	const orgTables = DB.orgTableNames();

	for (const table of Object.values(DB.Tables) as SQLiteTable[]) {
		const child = getTableName(table);
		if (!orgTables.has(child)) continue;

		for (const fk of getTableConfig(table).foreignKeys) {
			const reference = fk.reference();
			const parent = getTableName(reference.foreignTable);
			if (!orgTables.has(parent)) continue;

			const column = reference.columns[0]!.name;
			const parentColumn = reference.foreignColumns[0]!.name;
			const row = client
				.query(
					`select count(*) as n from "${child}" c join "${parent}" p on p."${parentColumn}" = c."${column}" where p."org_id" != c."org_id"`,
				)
				.get() as { n: number };
			if (row.n > 0)
				problems.push(`${child}.${column} → ${parent}: ${row.n} row(s) point into another org`);
		}
	}
	return problems;
}
