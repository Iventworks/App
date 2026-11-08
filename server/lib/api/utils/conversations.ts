import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import { CONVERSATION_TYPES } from "../../db/schema";
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
 * `ensureDerivedConversations`. Read state lives in `conversation_members.last_read_at`; for
 * derived channels that row has `is_member = false`.
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
			.where(eq(DB.Tables.eventMembers.user_id, userId))
			.all()
			.map((row) => row.event_id);
	}

	/** Group ids the user belongs to (in any event). */
	static getMemberGroupIds(userId: number): number[] {
		return DB.instance()
			.select({ group_id: DB.Tables.eventGroupMembers.group_id })
			.from(DB.Tables.eventGroupMembers)
			.where(eq(DB.Tables.eventGroupMembers.user_id, userId))
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
					.where(inArray(DB.Tables.events.id, missing))
					.all();
				if (events.length > 0) {
					db
						.insert(DB.Tables.conversations)
						.values(
							events.map((event) => ({ type: "event" as const, name: event.name, event_id: event.id })),
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
					.where(inArray(DB.Tables.conversations.group_id, groupIds))
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
					.where(inArray(DB.Tables.eventGroups.id, missing))
					.all();
				if (groups.length > 0) {
					db
						.insert(DB.Tables.conversations)
						.values(
							groups.map((group) => ({
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
				.where(eq(DB.Tables.conversations.type, "core_team"))
				.get();
			if (!existing) {
				db
					.insert(DB.Tables.conversations)
					.values({ type: "core_team", name: ConversationAccess.CORE_TEAM_CHANNEL_NAME })
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
				eq(DB.Tables.conversations.id, DB.Tables.conversationMembers.conversation_id),
			)
			.where(
				and(
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
					.where(or(...derivedConditions))
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
					eq(DB.Tables.conversationMembers.conversation_id, DB.Tables.messages.conversation_id),
					eq(DB.Tables.conversationMembers.user_id, userId),
				),
			)
			.where(
				and(
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

	static getTotalUnread(userId: number, role: UserAccountSettings.Role) {
		const ids = ConversationAccess.getAccessibleConversationIds(userId, role);
		let total = 0;
		for (const value of ConversationAccess.getUnreadCounts(userId, ids).values()) total += value;
		return total;
	}

	/** Upsert the caller's read marker. Explicit memberships keep their `is_member` flag. */
	static markRead(conversationId: number, userId: number, at: number = Date.now()) {
		DB.instance()
			.insert(DB.Tables.conversationMembers)
			.values({ conversation_id: conversationId, user_id: userId, is_member: false, last_read_at: at })
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
					eq(DB.Tables.conversations.id, DB.Tables.conversationMembers.conversation_id),
				)
				.where(
					and(
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
				.where(eq(DB.Tables.conversations.id, sharedId))
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
				and(inArray(DB.Tables.messages.conversation_id, ids), isNull(DB.Tables.messages.deleted_at)),
			)
			.groupBy(DB.Tables.messages.conversation_id)
			.all()
			.map((row) => Number(row.id));
		const lastMessages = lastMessageIds.length
			? db
					.select()
					.from(DB.Tables.messages)
					.where(inArray(DB.Tables.messages.id, lastMessageIds))
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
					.where(inArray(DB.Tables.events.id, eventIds))
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
					.where(inArray(DB.Tables.eventGroups.id, groupIds))
					.all()
			: [];

		const users = await UserSummary.fetchMap([
			...memberRows.map((row) => row.user_id),
			...lastMessages.map((message) => message.sender_id),
		]);
		const unread = ConversationAccess.getUnreadCounts(userId, ids);

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
					last_message: last
						? {
								id: last.id,
								content: last.content.length > 140 ? `${last.content.slice(0, 139)}…` : last.content,
								sender_name: last.sender_id ? (users.get(last.sender_id)?.display_name ?? null) : null,
								created_at: last.created_at,
							}
						: null,
					unread_count: unread.get(conversation.id) ?? 0,
					last_message_at: conversation.last_message_at,
					created_at: conversation.created_at,
				};
			})
			.sort((a, b) => (b.last_message_at ?? -1) - (a.last_message_at ?? -1) || b.id - a.id);
	}

	/** All conversations by id, newest activity first. */
	static loadConversations(ids: number[]): DB.Models.Conversation[] {
		if (ids.length === 0) return [];
		return DB.instance()
			.select()
			.from(DB.Tables.conversations)
			.where(inArray(DB.Tables.conversations.id, ids))
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
		/** Explicit members (direct and group chats only). */
		members: z.array(UserSummary.Schema),
		last_message: z
			.object({
				id: z.number(),
				content: z.string(),
				sender_name: z.string().nullable(),
				created_at: z.number(),
			})
			.nullable(),
		unread_count: z.number(),
		last_message_at: z.number().nullable(),
		created_at: z.number(),
	});
	export type Item = z.infer<typeof ItemSchema>;
}
