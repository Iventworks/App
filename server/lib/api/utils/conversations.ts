import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import { CONVERSATION_TYPES } from "../../db/schema";
import { inOrg, OrgContext } from "../../orgs/context";
import { PermissionHelper } from "./permissions";
import type { UserAccountSettings } from "./shared-models/accountData";
import { UserSummary } from "./shared-models/userSummary";

/**
 * Messaging access rules ("Teams-like" chats):
 * - `direct` / `group`: explicit `conversation_members` row with `is_member = true`
 * - `event`: the caller is staff of the event (`event_members`)
 * - `event_group`: the caller is a member of the group (`event_group_members`)
 * - `core_team`: org role ≥ core_team
 *
 * Derived channels (event, event_group, core_team) are created lazily by
 * `ensureDerivedConversations`. Read state and the caller's own settings (pinned, muted) live in
 * `conversation_members`; for derived channels that row has `is_member = false`.
 *
 * All queries here run on bun-sqlite synchronously (no awaits between read and insert), so the
 * lazy creation cannot race within this process.
 */
export class ConversationAccess {
	static readonly CORE_TEAM_CHANNEL_NAME = "Kernteam";

	/** Event ids the user is staff of. */
	static getMemberEventIds(userId: number): number[] {
		return DB.instance()
			.select({ event_id: DB.Tables.eventMembers.event_id })
			.from(DB.Tables.eventMembers)
			.where(and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.user_id, userId)))
			.all()
			.map((row) => row.event_id);
	}

	/** Group ids the user belongs to (in any event). */
	static getMemberGroupIds(userId: number): number[] {
		return DB.instance()
			.select({ group_id: DB.Tables.eventGroupMembers.group_id })
			.from(DB.Tables.eventGroupMembers)
			.where(and(inOrg(DB.Tables.eventGroupMembers), eq(DB.Tables.eventGroupMembers.user_id, userId)))
			.all()
			.map((row) => row.group_id);
	}

	static canAccess(
		conversation: DB.Models.Conversation,
		userId: number,
		role: UserAccountSettings.Role,
	): boolean {
		const db = DB.instance();
		switch (conversation.type) {
			case "direct":
			case "group":
				return Boolean(
					db
						.select({ id: DB.Tables.conversationMembers.user_id })
						.from(DB.Tables.conversationMembers)
						.where(
							and(
								inOrg(DB.Tables.conversationMembers),
								eq(DB.Tables.conversationMembers.conversation_id, conversation.id),
								eq(DB.Tables.conversationMembers.user_id, userId),
								eq(DB.Tables.conversationMembers.is_member, true),
							),
						)
						.get(),
				);
			case "event":
				return (
					conversation.event_id !== null &&
					Boolean(
						db
							.select({ id: DB.Tables.eventMembers.id })
							.from(DB.Tables.eventMembers)
							.where(
								and(
									inOrg(DB.Tables.eventMembers),
									eq(DB.Tables.eventMembers.event_id, conversation.event_id),
									eq(DB.Tables.eventMembers.user_id, userId),
								),
							)
							.get(),
					)
				);
			case "event_group":
				return (
					conversation.group_id !== null &&
					Boolean(
						db
							.select({ id: DB.Tables.eventGroupMembers.user_id })
							.from(DB.Tables.eventGroupMembers)
							.where(
								and(
									inOrg(DB.Tables.eventGroupMembers),
									eq(DB.Tables.eventGroupMembers.group_id, conversation.group_id),
									eq(DB.Tables.eventGroupMembers.user_id, userId),
								),
							)
							.get(),
					)
				);
			case "core_team":
				return PermissionHelper.hasOrgRole(role, "core_team");
			default:
				return false;
		}
	}

	/** Create the event, group and core-team channels the user should see but that don't exist yet. */
	static ensureDerivedConversations(userId: number, role: UserAccountSettings.Role) {
		const db = DB.instance();

		const eventIds = ConversationAccess.getMemberEventIds(userId);
		if (eventIds.length > 0) {
			const existing = new Set(
				db
					.select({ event_id: DB.Tables.conversations.event_id })
					.from(DB.Tables.conversations)
					.where(
						and(
							inOrg(DB.Tables.conversations),
							eq(DB.Tables.conversations.type, "event"),
							inArray(DB.Tables.conversations.event_id, eventIds),
						),
					)
					.all()
					.map((row) => row.event_id),
			);
			const missing = eventIds.filter((id) => !existing.has(id));
			if (missing.length > 0) {
				const events = db
					.select({ id: DB.Tables.events.id, name: DB.Tables.events.name })
					.from(DB.Tables.events)
					.where(and(inOrg(DB.Tables.events), inArray(DB.Tables.events.id, missing)))
					.all();
				if (events.length > 0) {
					db
						.insert(DB.Tables.conversations)
						.values(
							events.map((event) => ({
								org_id: OrgContext.id(),
								type: "event" as const,
								name: event.name,
								event_id: event.id,
							})),
						)
						.run();
				}
			}
		}

		const groupIds = ConversationAccess.getMemberGroupIds(userId);
		if (groupIds.length > 0) {
			const existing = new Set(
				db
					.select({ group_id: DB.Tables.conversations.group_id })
					.from(DB.Tables.conversations)
					.where(
						and(inOrg(DB.Tables.conversations), inArray(DB.Tables.conversations.group_id, groupIds)),
					)
					.all()
					.map((row) => row.group_id),
			);
			const missing = groupIds.filter((id) => !existing.has(id));
			if (missing.length > 0) {
				const groups = db
					.select({
						id: DB.Tables.eventGroups.id,
						name: DB.Tables.eventGroups.name,
						event_id: DB.Tables.eventGroups.event_id,
					})
					.from(DB.Tables.eventGroups)
					.where(and(inOrg(DB.Tables.eventGroups), inArray(DB.Tables.eventGroups.id, missing)))
					.all();
				if (groups.length > 0) {
					db
						.insert(DB.Tables.conversations)
						.values(
							groups.map((group) => ({
								org_id: OrgContext.id(),
								type: "event_group" as const,
								name: group.name,
								event_id: group.event_id,
								group_id: group.id,
							})),
						)
						.onConflictDoNothing()
						.run();
				}
			}
		}

		if (PermissionHelper.hasOrgRole(role, "core_team")) {
			const existing = db
				.select({ id: DB.Tables.conversations.id })
				.from(DB.Tables.conversations)
				.where(and(inOrg(DB.Tables.conversations), eq(DB.Tables.conversations.type, "core_team")))
				.get();
			if (!existing) {
				db
					.insert(DB.Tables.conversations)
					.values({
						org_id: OrgContext.id(),
						type: "core_team",
						name: ConversationAccess.CORE_TEAM_CHANNEL_NAME,
					})
					.run();
			}
		}
	}

	/** Ids of every conversation the user can open. */
	static getAccessibleConversationIds(userId: number, role: UserAccountSettings.Role): number[] {
		const db = DB.instance();
		const eventIds = ConversationAccess.getMemberEventIds(userId);
		const groupIds = ConversationAccess.getMemberGroupIds(userId);

		const explicit = db
			.select({ id: DB.Tables.conversationMembers.conversation_id })
			.from(DB.Tables.conversationMembers)
			.innerJoin(
				DB.Tables.conversations,
				and(
					inOrg(DB.Tables.conversations),
					eq(DB.Tables.conversations.id, DB.Tables.conversationMembers.conversation_id),
				),
			)
			.where(
				and(
					inOrg(DB.Tables.conversationMembers),
					eq(DB.Tables.conversationMembers.user_id, userId),
					eq(DB.Tables.conversationMembers.is_member, true),
					inArray(DB.Tables.conversations.type, ["direct", "group"]),
				),
			)
			.all()
			.map((row) => row.id);

		const derivedConditions = [
			eventIds.length
				? and(
						eq(DB.Tables.conversations.type, "event"),
						inArray(DB.Tables.conversations.event_id, eventIds),
					)
				: undefined,
			groupIds.length
				? and(
						eq(DB.Tables.conversations.type, "event_group"),
						inArray(DB.Tables.conversations.group_id, groupIds),
					)
				: undefined,
			PermissionHelper.hasOrgRole(role, "core_team")
				? eq(DB.Tables.conversations.type, "core_team")
				: undefined,
		].filter((condition) => condition !== undefined);

		const derived = derivedConditions.length
			? db
					.select({ id: DB.Tables.conversations.id })
					.from(DB.Tables.conversations)
					.where(and(inOrg(DB.Tables.conversations), or(...derivedConditions)))
					.all()
					.map((row) => row.id)
			: [];

		return [...new Set([...explicit, ...derived])];
	}

	/** Unread message counts per conversation (messages from others after `last_read_at`). */
	static getUnreadCounts(userId: number, conversationIds: number[]): Map<number, number> {
		if (conversationIds.length === 0) return new Map();
		const rows = DB.instance()
			.select({
				conversation_id: DB.Tables.messages.conversation_id,
				value: sql<number>`count(*)`,
			})
			.from(DB.Tables.messages)
			.leftJoin(
				DB.Tables.conversationMembers,
				and(
					inOrg(DB.Tables.conversationMembers),
					eq(DB.Tables.conversationMembers.conversation_id, DB.Tables.messages.conversation_id),
					eq(DB.Tables.conversationMembers.user_id, userId),
				),
			)
			.where(
				and(
					inOrg(DB.Tables.messages),
					inArray(DB.Tables.messages.conversation_id, conversationIds),
					isNull(DB.Tables.messages.deleted_at),
					sql`${DB.Tables.messages.created_at} > coalesce(${DB.Tables.conversationMembers.last_read_at}, 0)`,
					or(isNull(DB.Tables.messages.sender_id), ne(DB.Tables.messages.sender_id, userId)),
				),
			)
			.groupBy(DB.Tables.messages.conversation_id)
			.all();
		return new Map(rows.map((row) => [row.conversation_id, Number(row.value)]));
	}

	/** Unread messages across all chats — muted chats don't count (they keep their own badge). */
	static getTotalUnread(userId: number, role: UserAccountSettings.Role) {
		const ids = ConversationAccess.getAccessibleConversationIds(userId, role);
		const muted = new Set(
			[...ConversationAccess.getOwnStates(userId, ids).values()]
				.filter((state) => state.muted)
				.map((state) => state.conversation_id),
		);
		let total = 0;
		for (const [id, value] of ConversationAccess.getUnreadCounts(userId, ids)) {
			if (!muted.has(id)) total += value;
		}
		return total;
	}

	/** The caller's own row per conversation: read marker, pinned, muted. */
	static getOwnStates(userId: number, conversationIds: number[]) {
		if (conversationIds.length === 0) return new Map<number, DB.Models.ConversationMember>();
		const rows = DB.instance()
			.select()
			.from(DB.Tables.conversationMembers)
			.where(
				and(
					inOrg(DB.Tables.conversationMembers),
					eq(DB.Tables.conversationMembers.user_id, userId),
					inArray(DB.Tables.conversationMembers.conversation_id, conversationIds),
				),
			)
			.all();
		return new Map(rows.map((row) => [row.conversation_id, row]));
	}

	/** Pin/mute a chat for the caller. Explicit memberships keep their `is_member` flag. */
	static setPreferences(
		conversationId: number,
		userId: number,
		changes: { pinned?: boolean; muted?: boolean },
	) {
		const set = {
			...(changes.pinned !== undefined ? { pinned_at: changes.pinned ? Date.now() : null } : {}),
			...(changes.muted !== undefined ? { muted: changes.muted } : {}),
		};
		if (Object.keys(set).length === 0) return;
		DB.instance()
			.insert(DB.Tables.conversationMembers)
			.values({
				org_id: OrgContext.id(),
				conversation_id: conversationId,
				user_id: userId,
				is_member: false,
				...set,
			})
			.onConflictDoUpdate({
				target: [DB.Tables.conversationMembers.conversation_id, DB.Tables.conversationMembers.user_id],
				set,
			})
			.run();
	}

	/**
	 * Everyone in a chat, whatever its type: explicit members, the event's staff (with their role
	 * and function), the group's members, or the core team.
	 */
	static getMembers(conversation: DB.Models.Conversation): ConversationAccess.MemberRef[] {
		const db = DB.instance();
		switch (conversation.type) {
			case "direct":
			case "group":
				return db
					.select({ user_id: DB.Tables.conversationMembers.user_id })
					.from(DB.Tables.conversationMembers)
					.where(
						and(
							inOrg(DB.Tables.conversationMembers),
							eq(DB.Tables.conversationMembers.conversation_id, conversation.id),
							eq(DB.Tables.conversationMembers.is_member, true),
						),
					)
					.all()
					.map((row) => ({ user_id: row.user_id, event_role: null, position: null }));
			case "event":
				if (conversation.event_id === null) return [];
				return db
					.select({
						user_id: DB.Tables.eventMembers.user_id,
						event_role: DB.Tables.eventMembers.role,
						position: DB.Tables.eventMembers.position,
					})
					.from(DB.Tables.eventMembers)
					.where(
						and(
							inOrg(DB.Tables.eventMembers),
							eq(DB.Tables.eventMembers.event_id, conversation.event_id),
						),
					)
					.all();
			case "event_group": {
				if (conversation.group_id === null) return [];
				const rows = db
					.select({ user_id: DB.Tables.eventGroupMembers.user_id })
					.from(DB.Tables.eventGroupMembers)
					.where(
						and(
							inOrg(DB.Tables.eventGroupMembers),
							eq(DB.Tables.eventGroupMembers.group_id, conversation.group_id),
						),
					)
					.all();
				// Their role in the event the group belongs to, for the member list.
				const staff = conversation.event_id
					? db
							.select({
								user_id: DB.Tables.eventMembers.user_id,
								event_role: DB.Tables.eventMembers.role,
								position: DB.Tables.eventMembers.position,
							})
							.from(DB.Tables.eventMembers)
							.where(
								and(
									inOrg(DB.Tables.eventMembers),
									eq(DB.Tables.eventMembers.event_id, conversation.event_id),
								),
							)
							.all()
					: [];
				return rows.map((row) => {
					const member = staff.find((entry) => entry.user_id === row.user_id);
					return {
						user_id: row.user_id,
						event_role: member?.event_role ?? null,
						position: member?.position ?? null,
					};
				});
			}
			case "core_team":
				return db
					.select({ user_id: DB.Tables.users.id })
					.from(DB.Tables.users)
					.where(
						and(
							inOrg(DB.Tables.users),
							inArray(DB.Tables.users.role, ["core_team", "admin"]),
							isNull(DB.Tables.users.suspended_at),
						),
					)
					.all()
					.map((row) => ({ user_id: row.user_id, event_role: null, position: null }));
			default:
				return [];
		}
	}

	/** Read markers of everyone who has opened the chat (user id → `last_read_at`). */
	static getReadMarkers(conversationId: number): Map<number, number> {
		const rows = DB.instance()
			.select({
				user_id: DB.Tables.conversationMembers.user_id,
				last_read_at: DB.Tables.conversationMembers.last_read_at,
			})
			.from(DB.Tables.conversationMembers)
			.where(
				and(
					inOrg(DB.Tables.conversationMembers),
					eq(DB.Tables.conversationMembers.conversation_id, conversationId),
				),
			)
			.all();
		return new Map(rows.map((row) => [row.user_id, row.last_read_at]));
	}

	/**
	 * Up to which instant everyone else in the chat has read (0 while someone has not opened it):
	 * the caller's own messages up to it show as "read".
	 */
	static getReadByAllUntil(conversation: DB.Models.Conversation, userId: number) {
		const others = ConversationAccess.getMembers(conversation).filter(
			(member) => member.user_id !== userId,
		);
		if (others.length === 0) return 0;
		const markers = ConversationAccess.getReadMarkers(conversation.id);
		return Math.min(...others.map((member) => markers.get(member.user_id) ?? 0));
	}

	/** Head counts of the derived channels among `conversations` (conversation id → members). */
	protected static getDerivedMemberCounts(conversations: DB.Models.Conversation[]) {
		const db = DB.instance();
		const result = new Map<number, number>();

		const eventIds = conversations
			.filter((conversation) => conversation.type === "event" && conversation.event_id !== null)
			.map((conversation) => conversation.event_id as number);
		const eventCounts = eventIds.length
			? db
					.select({ id: DB.Tables.eventMembers.event_id, value: count() })
					.from(DB.Tables.eventMembers)
					.where(and(inOrg(DB.Tables.eventMembers), inArray(DB.Tables.eventMembers.event_id, eventIds)))
					.groupBy(DB.Tables.eventMembers.event_id)
					.all()
			: [];

		const groupIds = conversations
			.filter((conversation) => conversation.type === "event_group" && conversation.group_id !== null)
			.map((conversation) => conversation.group_id as number);
		const groupCounts = groupIds.length
			? db
					.select({ id: DB.Tables.eventGroupMembers.group_id, value: count() })
					.from(DB.Tables.eventGroupMembers)
					.where(
						and(
							inOrg(DB.Tables.eventGroupMembers),
							inArray(DB.Tables.eventGroupMembers.group_id, groupIds),
						),
					)
					.groupBy(DB.Tables.eventGroupMembers.group_id)
					.all()
			: [];

		const coreTeam = conversations.some((conversation) => conversation.type === "core_team")
			? (db
					.select({ value: count() })
					.from(DB.Tables.users)
					.where(
						and(
							inOrg(DB.Tables.users),
							inArray(DB.Tables.users.role, ["core_team", "admin"]),
							isNull(DB.Tables.users.suspended_at),
						),
					)
					.get()?.value ?? 0)
			: 0;

		for (const conversation of conversations) {
			if (conversation.type === "event") {
				result.set(
					conversation.id,
					eventCounts.find((entry) => entry.id === conversation.event_id)?.value ?? 0,
				);
			} else if (conversation.type === "event_group") {
				result.set(
					conversation.id,
					groupCounts.find((entry) => entry.id === conversation.group_id)?.value ?? 0,
				);
			} else if (conversation.type === "core_team") {
				result.set(conversation.id, coreTeam);
			}
		}
		return result;
	}

	/** Upsert the caller's read marker. Explicit memberships keep their `is_member` flag. */
	static markRead(conversationId: number, userId: number, at: number = Date.now()) {
		DB.instance()
			.insert(DB.Tables.conversationMembers)
			.values({
				org_id: OrgContext.id(),
				conversation_id: conversationId,
				user_id: userId,
				is_member: false,
				last_read_at: at,
			})
			.onConflictDoUpdate({
				target: [DB.Tables.conversationMembers.conversation_id, DB.Tables.conversationMembers.user_id],
				set: { last_read_at: at },
			})
			.run();
	}

	/** Find an existing 1:1 chat between two users. */
	static findDirectConversation(userA: number, userB: number): DB.Models.Conversation | null {
		const db = DB.instance();
		const idsOf = (userId: number) =>
			db
				.select({ id: DB.Tables.conversationMembers.conversation_id })
				.from(DB.Tables.conversationMembers)
				.innerJoin(
					DB.Tables.conversations,
					and(
						inOrg(DB.Tables.conversations),
						eq(DB.Tables.conversations.id, DB.Tables.conversationMembers.conversation_id),
					),
				)
				.where(
					and(
						inOrg(DB.Tables.conversationMembers),
						eq(DB.Tables.conversations.type, "direct"),
						eq(DB.Tables.conversationMembers.user_id, userId),
						eq(DB.Tables.conversationMembers.is_member, true),
					),
				)
				.all()
				.map((row) => row.id);

		const forB = new Set(idsOf(userB));
		const sharedId = idsOf(userA).find((id) => forB.has(id));
		if (sharedId === undefined) return null;

		return (
			db
				.select()
				.from(DB.Tables.conversations)
				.where(and(inOrg(DB.Tables.conversations), eq(DB.Tables.conversations.id, sharedId)))
				.get() ?? null
		);
	}

	/** Caller-specific list items (title, members, last message, unread count). */
	static async buildItems(
		conversations: DB.Models.Conversation[],
		userId: number,
	): Promise<ConversationAccess.Item[]> {
		if (conversations.length === 0) return [];
		const db = DB.instance();
		const ids = conversations.map((conversation) => conversation.id);

		const explicitIds = conversations
			.filter((conversation) => conversation.type === "direct" || conversation.type === "group")
			.map((conversation) => conversation.id);
		const memberRows = explicitIds.length
			? db
					.select({
						conversation_id: DB.Tables.conversationMembers.conversation_id,
						user_id: DB.Tables.conversationMembers.user_id,
					})
					.from(DB.Tables.conversationMembers)
					.where(
						and(
							inOrg(DB.Tables.conversationMembers),
							inArray(DB.Tables.conversationMembers.conversation_id, explicitIds),
							eq(DB.Tables.conversationMembers.is_member, true),
						),
					)
					.all()
			: [];

		const lastMessageIds = db
			.select({ id: sql<number>`max(${DB.Tables.messages.id})` })
			.from(DB.Tables.messages)
			.where(
				and(
					inOrg(DB.Tables.messages),
					inArray(DB.Tables.messages.conversation_id, ids),
					isNull(DB.Tables.messages.deleted_at),
				),
			)
			.groupBy(DB.Tables.messages.conversation_id)
			.all()
			.map((row) => Number(row.id));
		const lastMessages = lastMessageIds.length
			? db
					.select()
					.from(DB.Tables.messages)
					.where(and(inOrg(DB.Tables.messages), inArray(DB.Tables.messages.id, lastMessageIds)))
					.all()
			: [];

		const eventIds = [
			...new Set(
				conversations
					.map((conversation) => conversation.event_id)
					.filter((id): id is number => id !== null),
			),
		];
		const events = eventIds.length
			? db
					.select({ id: DB.Tables.events.id, name: DB.Tables.events.name })
					.from(DB.Tables.events)
					.where(and(inOrg(DB.Tables.events), inArray(DB.Tables.events.id, eventIds)))
					.all()
			: [];

		const groupIds = [
			...new Set(
				conversations
					.map((conversation) => conversation.group_id)
					.filter((id): id is number => id !== null),
			),
		];
		const groups = groupIds.length
			? db
					.select({
						id: DB.Tables.eventGroups.id,
						name: DB.Tables.eventGroups.name,
						color: DB.Tables.eventGroups.color,
					})
					.from(DB.Tables.eventGroups)
					.where(and(inOrg(DB.Tables.eventGroups), inArray(DB.Tables.eventGroups.id, groupIds)))
					.all()
			: [];

		// Attachments of the last messages: a message without text previews as "Foto"/"Datei".
		const lastAttachments = lastMessageIds.length
			? db
					.select({
						message_id: DB.Tables.files.message_id,
						name: DB.Tables.files.name,
						mime_type: DB.Tables.files.mime_type,
					})
					.from(DB.Tables.files)
					.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.message_id, lastMessageIds)))
					.orderBy(DB.Tables.files.id)
					.all()
			: [];

		const users = await UserSummary.fetchMap([
			...memberRows.map((row) => row.user_id),
			...lastMessages.map((message) => message.sender_id),
		]);
		const unread = ConversationAccess.getUnreadCounts(userId, ids);
		const ownStates = ConversationAccess.getOwnStates(userId, ids);
		const derivedCounts = ConversationAccess.getDerivedMemberCounts(conversations);

		return conversations
			.map((conversation) => {
				const members =
					conversation.type === "direct" || conversation.type === "group"
						? memberRows
								.filter((row) => row.conversation_id === conversation.id)
								.map((row) => users.get(row.user_id))
								.filter((user): user is UserSummary.Schema => Boolean(user))
						: [];
				const event = events.find((entry) => entry.id === conversation.event_id) ?? null;
				const group = groups.find((entry) => entry.id === conversation.group_id) ?? null;
				const last = lastMessages.find((message) => message.conversation_id === conversation.id);
				const attachments = last
					? lastAttachments.filter((attachment) => attachment.message_id === last.id)
					: [];
				const own = ownStates.get(conversation.id);

				let title: string;
				switch (conversation.type) {
					case "direct":
						title =
							members.find((member) => member.id !== userId)?.display_name ??
							conversation.name ??
							"Direktnachricht";
						break;
					case "event":
						title = event?.name ?? conversation.name ?? "Event";
						break;
					case "event_group":
						title = group?.name ?? conversation.name ?? "Gruppe";
						break;
					case "core_team":
						title = conversation.name ?? ConversationAccess.CORE_TEAM_CHANNEL_NAME;
						break;
					default:
						title = conversation.name ?? "Gruppenchat";
				}

				return {
					id: conversation.id,
					type: conversation.type,
					title,
					name: conversation.name,
					event,
					group,
					members,
					member_count: derivedCounts.get(conversation.id) ?? members.length,
					last_message: last
						? {
								id: last.id,
								content: last.content.length > 140 ? `${last.content.slice(0, 139)}…` : last.content,
								sender_name: last.sender_id ? (users.get(last.sender_id)?.display_name ?? null) : null,
								is_own: last.sender_id === userId,
								created_at: last.created_at,
								attachment_count: attachments.length,
								attachment_name: attachments[0]?.name ?? null,
								attachment_is_image: attachments.length > 0 && attachments.every(isImage),
							}
						: null,
					unread_count: unread.get(conversation.id) ?? 0,
					last_message_at: conversation.last_message_at,
					created_at: conversation.created_at,
					pinned_at: own?.pinned_at ?? null,
					muted: own?.muted ?? false,
					last_read_at: own?.last_read_at ?? 0,
				};
			})
			.sort(
				(a, b) =>
					// Pinned chats first (latest pin on top), then by activity.
					(b.pinned_at ?? -1) - (a.pinned_at ?? -1) ||
					(b.last_message_at ?? -1) - (a.last_message_at ?? -1) ||
					b.id - a.id,
			);
	}

	/** All conversations by id, newest activity first. */
	static loadConversations(ids: number[]): DB.Models.Conversation[] {
		if (ids.length === 0) return [];
		return DB.instance()
			.select()
			.from(DB.Tables.conversations)
			.where(and(inOrg(DB.Tables.conversations), inArray(DB.Tables.conversations.id, ids)))
			.orderBy(desc(DB.Tables.conversations.last_message_at))
			.all();
	}
}

export namespace ConversationAccess {
	export const ItemSchema = z.object({
		id: z.number(),
		type: z.enum(CONVERSATION_TYPES),
		/** Display title: the other person's name for direct chats, else the channel/group name. */
		title: z.string(),
		name: z.string().nullable(),
		event: z.object({ id: z.number(), name: z.string() }).nullable(),
		group: z.object({ id: z.number(), name: z.string(), color: z.string().nullable() }).nullable(),
		/** Explicit members (direct and group chats only; `/members` lists the people of any chat). */
		members: z.array(UserSummary.Schema),
		/** Head count for every type of chat. */
		member_count: z.number(),
		last_message: z
			.object({
				id: z.number(),
				/** Empty when the message only carries attachments. */
				content: z.string(),
				sender_name: z.string().nullable(),
				is_own: z.boolean(),
				created_at: z.number(),
				attachment_count: z.number(),
				attachment_name: z.string().nullable(),
				attachment_is_image: z.boolean(),
			})
			.nullable(),
		unread_count: z.number(),
		last_message_at: z.number().nullable(),
		created_at: z.number(),
		/** When the caller pinned this chat to the top of their list. */
		pinned_at: z.number().nullable(),
		/** Muted for the caller: its unread messages are left out of the total. */
		muted: z.boolean(),
		/** The caller's read marker (0 = never opened). */
		last_read_at: z.number(),
	});
	export type Item = z.infer<typeof ItemSchema>;

	export interface MemberRef {
		user_id: number;
		/** Role and function in the event of the chat (event and group channels). */
		event_role: DB.Models.EventMember["role"] | null;
		position: string | null;
	}
}

function isImage(file: { mime_type: string | null }) {
	return Boolean(file.mime_type?.toLowerCase().startsWith("image/"));
}
