import { and, count, eq, inArray, ne, sum } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileStorage } from "../../utils/fileStorage";
import { Logger } from "../../utils/logger";
import { TimeUtils } from "../../utils/time";
import { EventSchedule } from "./eventSchedule";
import { FileService } from "./fileService";
import { Occurrences } from "./occurrences";

/**
 * Copy an event — "the same camp again next year". The master data always comes along; what else
 * does is chosen per part (`EventCopier.Parts`). Everything that has a time moves with the new
 * start date; nothing that records what happened (expenses, audit log, chats, participants' notes)
 * is copied.
 */
export class EventCopier {
	/** How much there is to copy, per part. */
	static async summary(event: DB.Models.Event): Promise<EventCopier.Summary> {
		const db = DB.instance();
		const T = DB.Tables;
		const countOf = (table: SQLiteTable & { org_id: AnySQLiteColumn; event_id: AnySQLiteColumn }) =>
			db
				.select({ value: count() })
				.from(table)
				.where(and(inOrg(table), eq(table.event_id, event.id)))
				.get()?.value ?? 0;

		const documents = db
			.select({ value: count(), size: sum(T.files.size) })
			.from(T.files)
			.where(and(inOrg(T.files), eq(T.files.scope, "event"), eq(T.files.event_id, event.id)))
			.get();

		return {
			team: countOf(T.eventMembers),
			groups: countOf(T.eventGroups),
			rooms: countOf(T.rooms),
			responsibilities: countOf(T.responsibilities),
			program: countOf(T.programItems),
			tasks: countOf(T.tasks),
			notes:
				db
					.select({ value: count() })
					.from(T.notes)
					.where(
						and(
							inOrg(T.notes),
							eq(T.notes.event_id, event.id),
							inArray(T.notes.scope, ["event", "group"]),
						),
					)
					.get()?.value ?? 0,
			announcements: countOf(T.announcements),
			budget: countOf(T.budgetItems),
			documents: documents?.value ?? 0,
			documents_size: Number(documents?.size ?? 0),
			resources: countOf(T.resourceBookings),
			participants:
				db
					.select({ value: count() })
					.from(T.participants)
					.where(
						and(
							inOrg(T.participants),
							eq(T.participants.event_id, event.id),
							ne(T.participants.status, "cancelled"),
						),
					)
					.get()?.value ?? 0,
		};
	}

	/**
	 * Create the copy. The rows are written in one (synchronous, so really atomic) transaction;
	 * file contents are duplicated before it and removed again if it fails. Resource bookings are
	 * added afterwards, each only if the resource is free on the new days.
	 */
	static async copy(
		source: DB.Models.Event,
		options: EventCopier.Options,
	): Promise<EventCopier.Result> {
		const T = DB.Tables;
		const include = options.include;
		const org_id = OrgContext.id();
		const offset = TimeUtils.diffDays(source.start_date, options.start_date);
		const shift = (ts: number) => TimeUtils.shiftDays(ts, offset);

		// --- file contents first: copying blobs is the only asynchronous part ---------------------
		const sourceFiles = include.documents
			? DB.instance()
					.select()
					.from(T.files)
					.where(and(inOrg(T.files), eq(T.files.scope, "event"), eq(T.files.event_id, source.id)))
					.all()
			: [];
		const blobs = new Map<number, { storageKey: string; size: number }>();
		let skippedFiles = 0;
		for (const file of sourceFiles) {
			if (file.kind !== "file" || !file.storage_key) continue;
			const copy = await FileStorage.copy(file.storage_key);
			if (copy) blobs.set(file.id, copy);
			else skippedFiles++;
		}

		let created: DB.Models.Event;
		const notify: { user_id: number; role: DB.Models.EventMember["role"] }[] = [];

		try {
			created = DB.instance().transaction((tx) => {
				const event = tx
					.insert(T.events)
					.values({
						org_id,
						name: options.name,
						type: source.type,
						status: "planning",
						description: source.description,
						location: source.location,
						start_date: options.start_date,
						end_date: options.end_date,
						recurrence: source.recurrence,
						color: source.color,
						max_participants: source.max_participants,
						participant_fee_cents: source.participant_fee_cents,
						budget_cents: source.budget_cents,
						created_by: options.userId,
					})
					.returning()
					.get();

				// --- rooms ---------------------------------------------------------------------------
				const roomIds = new Map<number, number>();
				if (include.rooms) {
					for (const room of tx
						.select()
						.from(T.rooms)
						.where(and(inOrg(T.rooms), eq(T.rooms.event_id, source.id)))
						.all()) {
						const copy = tx
							.insert(T.rooms)
							.values({
								org_id,
								event_id: event.id,
								name: room.name,
								capacity: room.capacity,
								notes: room.notes,
							})
							.returning()
							.get();
						roomIds.set(room.id, copy.id);
					}
				}
				const roomOf = (id: number | null) => (id === null ? null : (roomIds.get(id) ?? null));

				// --- team: people who can still sign in -----------------------------------------------
				const team = new Set<number>();
				if (include.team) {
					const members = tx
						.select({ member: T.eventMembers, user: T.users })
						.from(T.eventMembers)
						.innerJoin(T.users, and(inOrg(T.users), eq(T.users.id, T.eventMembers.user_id)))
						.where(and(inOrg(T.eventMembers), eq(T.eventMembers.event_id, source.id)))
						.all()
						.filter(({ user }) => user.role !== "unverified" && user.suspended_at === null);
					for (const { member } of members) {
						tx
							.insert(T.eventMembers)
							.values({
								org_id,
								event_id: event.id,
								user_id: member.user_id,
								role: member.role,
								position: member.position,
								room_id: roomOf(member.room_id),
							})
							.run();
						team.add(member.user_id);
						notify.push({ user_id: member.user_id, role: member.role });
					}
				}

				// --- groups --------------------------------------------------------------------------
				const groupIds = new Map<number, number>();
				if (include.groups) {
					const groups = tx
						.select()
						.from(T.eventGroups)
						.where(and(inOrg(T.eventGroups), eq(T.eventGroups.event_id, source.id)))
						.all();
					for (const group of groups) {
						const copy = tx
							.insert(T.eventGroups)
							.values({
								org_id,
								event_id: event.id,
								name: group.name,
								description: group.description,
								color: group.color,
							})
							.returning()
							.get();
						groupIds.set(group.id, copy.id);
					}
					if (groups.length && team.size) {
						const memberships = tx
							.select()
							.from(T.eventGroupMembers)
							.where(
								and(
									inOrg(T.eventGroupMembers),
									inArray(
										T.eventGroupMembers.group_id,
										groups.map((group) => group.id),
									),
								),
							)
							.all()
							.filter((row) => team.has(row.user_id));
						for (const row of memberships) {
							tx
								.insert(T.eventGroupMembers)
								.values({ org_id, group_id: groupIds.get(row.group_id) as number, user_id: row.user_id })
								.run();
						}
					}
				}
				const groupOf = (id: number | null) => (id === null ? null : (groupIds.get(id) ?? null));

				// --- responsibilities ------------------------------------------------------------------
				if (include.responsibilities) {
					const responsibilities = tx
						.select()
						.from(T.responsibilities)
						.where(and(inOrg(T.responsibilities), eq(T.responsibilities.event_id, source.id)))
						.all();
					const assignees = responsibilities.length
						? tx
								.select()
								.from(T.responsibilityAssignees)
								.where(
									and(
										inOrg(T.responsibilityAssignees),
										inArray(
											T.responsibilityAssignees.responsibility_id,
											responsibilities.map((entry) => entry.id),
										),
									),
								)
								.all()
						: [];
					for (const responsibility of responsibilities) {
						const copy = tx
							.insert(T.responsibilities)
							.values({
								org_id,
								event_id: event.id,
								title: responsibility.title,
								description: responsibility.description,
								location: responsibility.location,
							})
							.returning()
							.get();
						for (const row of assignees) {
							if (row.responsibility_id !== responsibility.id || !team.has(row.user_id)) continue;
							tx
								.insert(T.responsibilityAssignees)
								.values({ org_id, responsibility_id: copy.id, user_id: row.user_id })
								.run();
						}
					}
				}

				// --- documents: folders before what is inside them ------------------------------------
				const fileIds = new Map<number, number>();
				if (include.documents) {
					const pending = [...sourceFiles];
					// A file whose blob could not be copied is left out.
					const usable = (file: DB.Models.File) => file.kind === "folder" || blobs.has(file.id);
					for (let round = 0; pending.length > 0 && round < 64; round++) {
						for (const file of [...pending]) {
							if (file.parent_id !== null && !fileIds.has(file.parent_id)) continue;
							pending.splice(pending.indexOf(file), 1);
							if (!usable(file)) continue;
							const blob = blobs.get(file.id);
							const copy = tx
								.insert(T.files)
								.values({
									org_id,
									scope: "event",
									event_id: event.id,
									parent_id: file.parent_id === null ? null : (fileIds.get(file.parent_id) as number),
									kind: file.kind,
									name: file.name,
									mime_type: file.mime_type,
									size: blob?.size ?? 0,
									storage_key: blob?.storageKey ?? null,
									uploaded_by: options.userId,
								})
								.returning()
								.get();
							fileIds.set(file.id, copy.id);
						}
					}
				}

				// --- program: same time of day, moved with the start date -------------------------------
				if (include.program) {
					const items = tx
						.select()
						.from(T.programItems)
						.where(and(inOrg(T.programItems), eq(T.programItems.event_id, source.id)))
						.all();
					const itemIds = items.map((item) => item.id);
					const responsibles = itemIds.length
						? tx
								.select()
								.from(T.programItemResponsibles)
								.where(
									and(
										inOrg(T.programItemResponsibles),
										inArray(T.programItemResponsibles.program_item_id, itemIds),
									),
								)
								.all()
						: [];
					const links = itemIds.length
						? tx
								.select({ link: T.programItemFiles, file: T.files })
								.from(T.programItemFiles)
								.innerJoin(T.files, and(inOrg(T.files), eq(T.files.id, T.programItemFiles.file_id)))
								.where(and(inOrg(T.programItemFiles), inArray(T.programItemFiles.program_item_id, itemIds)))
								.all()
						: [];

					for (const item of items) {
						const copy = tx
							.insert(T.programItems)
							.values({
								org_id,
								event_id: event.id,
								title: item.title,
								description: item.description,
								location: item.location,
								category: item.category,
								color: item.color,
								start_at: shift(item.start_at),
								end_at: shift(item.end_at),
								created_by: options.userId,
							})
							.returning()
							.get();
						for (const row of responsibles) {
							if (row.program_item_id !== item.id || !team.has(row.user_id)) continue;
							tx
								.insert(T.programItemResponsibles)
								.values({ org_id, program_item_id: copy.id, user_id: row.user_id })
								.run();
						}
						for (const { link, file } of links) {
							if (link.program_item_id !== item.id) continue;
							// Organisation documents stay linked; event documents follow their copy.
							const target = file.scope === "org" ? file.id : fileIds.get(file.id);
							if (target === undefined) continue;
							tx
								.insert(T.programItemFiles)
								.values({ org_id, program_item_id: copy.id, file_id: target })
								.run();
						}
					}
				}

				// --- tasks: open again ------------------------------------------------------------------
				if (include.tasks) {
					for (const task of tx
						.select()
						.from(T.tasks)
						.where(and(inOrg(T.tasks), eq(T.tasks.event_id, source.id)))
						.all()) {
						tx
							.insert(T.tasks)
							.values({
								org_id,
								event_id: event.id,
								group_id: groupOf(task.group_id),
								assignee_id:
									task.assignee_id !== null && team.has(task.assignee_id) ? task.assignee_id : null,
								title: task.title,
								description: task.description,
								status: "open",
								priority: task.priority,
								due_at: task.due_at === null ? null : shift(task.due_at),
								created_by: options.userId,
							})
							.run();
					}
				}

				// --- notes: the event's, and the groups' when the groups come along --------------------
				if (include.notes) {
					for (const note of tx
						.select()
						.from(T.notes)
						.where(
							and(
								inOrg(T.notes),
								eq(T.notes.event_id, source.id),
								inArray(T.notes.scope, ["event", "group"]),
							),
						)
						.all()) {
						const groupId = groupOf(note.group_id);
						if (note.scope === "group" && groupId === null) continue;
						tx
							.insert(T.notes)
							.values({
								org_id,
								scope: note.scope,
								event_id: event.id,
								group_id: groupId,
								title: note.title,
								content: note.content,
								pinned: note.pinned,
								created_by: options.userId,
								updated_by: options.userId,
							})
							.run();
					}
				}

				if (include.announcements) {
					for (const announcement of tx
						.select()
						.from(T.announcements)
						.where(and(inOrg(T.announcements), eq(T.announcements.event_id, source.id)))
						.all()) {
						tx
							.insert(T.announcements)
							.values({
								org_id,
								event_id: event.id,
								title: announcement.title,
								content: announcement.content,
								priority: announcement.priority,
								pinned: announcement.pinned,
								created_by: options.userId,
							})
							.run();
					}
				}

				if (include.budget) {
					for (const item of tx
						.select()
						.from(T.budgetItems)
						.where(and(inOrg(T.budgetItems), eq(T.budgetItems.event_id, source.id)))
						.all()) {
						tx
							.insert(T.budgetItems)
							.values({
								org_id,
								event_id: event.id,
								kind: item.kind,
								category: item.category,
								description: item.description,
								planned_cents: item.planned_cents,
							})
							.run();
					}
				}

				// --- participants: registered again, nothing about the old event ------------------------
				if (include.participants) {
					const participants = tx
						.select()
						.from(T.participants)
						.where(
							and(
								inOrg(T.participants),
								eq(T.participants.event_id, source.id),
								ne(T.participants.status, "cancelled"),
							),
						)
						.all();
					const contacts = participants.length
						? tx
								.select()
								.from(T.participantEmergencyContacts)
								.where(
									and(
										inOrg(T.participantEmergencyContacts),
										inArray(
											T.participantEmergencyContacts.participant_id,
											participants.map((participant) => participant.id),
										),
									),
								)
								.all()
						: [];
					for (const participant of participants) {
						const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...fields } = participant;
						const copy = tx
							.insert(T.participants)
							.values({
								...fields,
								org_id,
								event_id: event.id,
								room_id: roomOf(participant.room_id),
								status: "registered",
								fee_paid: false,
							})
							.returning()
							.get();
						for (const contact of contacts) {
							if (contact.participant_id !== participant.id) continue;
							tx
								.insert(T.participantEmergencyContacts)
								.values({
									org_id,
									participant_id: copy.id,
									name: contact.name,
									relation: contact.relation,
									phone: contact.phone,
								})
								.run();
						}
					}
				}

				return event;
			});
		} catch (error) {
			await FileStorage.remove([...blobs.values()].map((blob) => blob.storageKey));
			throw error;
		}

		// The dates of a recurring event come from its rule and the new range.
		try {
			await Occurrences.syncWithRule(created);
		} catch (error) {
			Logger.error("Failed to create the dates of a copied event:", error);
			await FileService.deleteAllForEvent(created.id);
			await DB.instance()
				.delete(T.events)
				.where(and(inOrg(T.events), eq(T.events.id, created.id)))
				.run();
			throw error;
		}

		const skippedBookings = include.resources ? await EventCopier.copyBookings(source, created) : [];

		return {
			event: created,
			team: notify,
			skipped_bookings: skippedBookings,
			skipped_files: skippedFiles,
		};
	}

	/**
	 * Book what the source had booked — each resource only if enough units are free on the days of
	 * the copy. Returns the names of the resources that were not.
	 */
	protected static async copyBookings(source: DB.Models.Event, target: DB.Models.Event) {
		const T = DB.Tables;
		const db = DB.instance();
		const skipped: string[] = [];

		const bookings = await db
			.select({ booking: T.resourceBookings, resource: T.orgResources })
			.from(T.resourceBookings)
			.innerJoin(
				T.orgResources,
				and(inOrg(T.orgResources), eq(T.orgResources.id, T.resourceBookings.resource_id)),
			)
			.where(and(inOrg(T.resourceBookings), eq(T.resourceBookings.event_id, source.id)))
			.all();

		for (const { booking, resource } of bookings) {
			const others = await db
				.select({ quantity: T.resourceBookings.quantity, event: T.events })
				.from(T.resourceBookings)
				.innerJoin(T.events, and(inOrg(T.events), eq(T.events.id, T.resourceBookings.event_id)))
				.where(and(inOrg(T.resourceBookings), eq(T.resourceBookings.resource_id, resource.id)))
				.all();
			const schedule = await EventSchedule.load([target, ...others.map((row) => row.event)]);
			const taken = others
				.filter((row) => schedule.overlap(row.event, target))
				.reduce((total, row) => total + row.quantity, 0);

			if (taken + booking.quantity > resource.quantity) {
				skipped.push(resource.name);
				continue;
			}
			await db
				.insert(T.resourceBookings)
				.values({
					org_id: OrgContext.id(),
					resource_id: resource.id,
					event_id: target.id,
					quantity: booking.quantity,
					notes: booking.notes,
				})
				.run();
		}
		return skipped;
	}
}

export namespace EventCopier {
	export const PARTS = [
		"team",
		"groups",
		"rooms",
		"responsibilities",
		"program",
		"tasks",
		"notes",
		"announcements",
		"budget",
		"documents",
		"resources",
		"participants",
	] as const;
	export type Part = (typeof PARTS)[number];

	/** What to take along. Everything that names people needs `team` to keep them. */
	export const PartsSchema = z.object({
		/** Leaders and staff with their role and function (not the leaders' notes about them). */
		team: z.boolean().default(true),
		/** Groups; their members when `team` is copied. */
		groups: z.boolean().default(true),
		/** Rooms; who sleeps where when `team` / `participants` are copied. */
		rooms: z.boolean().default(true),
		/** Responsibilities; who has them when `team` is copied. */
		responsibilities: z.boolean().default(true),
		/** Program items at the same time of day, moved with the start date. */
		program: z.boolean().default(true),
		/** Tasks, open again, due dates moved with the start date. */
		tasks: z.boolean().default(true),
		/** Event notes, and group notes when `groups` are copied. */
		notes: z.boolean().default(false),
		announcements: z.boolean().default(false),
		/** Planned budget lines (not the expenses). */
		budget: z.boolean().default(true),
		/** Folders and files of the event's documents. */
		documents: z.boolean().default(false),
		/** Resource bookings, where the resource is free on the new days. */
		resources: z.boolean().default(false),
		/** Participants (not cancelled) with their details, registered again and unpaid. */
		participants: z.boolean().default(false),
	});
	export type Parts = z.infer<typeof PartsSchema>;

	export const SummarySchema = z.object({
		team: z.number(),
		groups: z.number(),
		rooms: z.number(),
		responsibilities: z.number(),
		program: z.number(),
		tasks: z.number(),
		notes: z.number(),
		announcements: z.number(),
		budget: z.number(),
		documents: z.number(),
		/** Bytes of all files among the documents. */
		documents_size: z.number(),
		resources: z.number(),
		participants: z.number(),
	});
	export type Summary = z.infer<typeof SummarySchema>;

	export interface Options {
		name: string;
		start_date: string;
		end_date: string;
		include: Parts;
		userId: number;
	}

	export interface Result {
		event: DB.Models.Event;
		/** The people on the copied team (to tell them). */
		team: { user_id: number; role: DB.Models.EventMember["role"] }[];
		/** Resources that were not free on the new days. */
		skipped_bookings: string[];
		/** Files whose contents were missing on disk. */
		skipped_files: number;
	}
}
