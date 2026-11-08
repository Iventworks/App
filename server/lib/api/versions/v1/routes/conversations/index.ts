import { and, eq, inArray, ne } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import type { DrizzleDB } from "../../../../../db/utils";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { ConversationAccess } from "../../../../utils/conversations";
import { requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { ConversationsModel } from "./model";

export type ConversationsEnv = { Variables: { conversation: DB.Models.Conversation } };

export const router = new Hono<ConversationsEnv>().basePath("/conversations");

router.use("*", requireOrgRole("volunteer"));

function getCaller(c: Context) {
	const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
	return { userId: authContext.user_id, role: authContext.user_role };
}

/** Of the given ids, those that belong to users allowed to chat (not unverified). */
async function getChatableUserIds(userIds: number[]) {
	if (userIds.length === 0) return [];
	const rows = await DB.instance()
		.select({ id: DB.Tables.users.id })
		.from(DB.Tables.users)
		.where(and(inArray(DB.Tables.users.id, userIds), ne(DB.Tables.users.role, "unverified")))
		.all();
	return rows.map((row) => row.id);
}

async function buildItem(conversation: DB.Models.Conversation, userId: number) {
	const [item] = await ConversationAccess.buildItems([conversation], userId);
	return item!;
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List conversations",
		description:
			"All chats of the caller: direct messages, group chats, the channels of their events and event groups, and the core team channel. Newest activity first, with unread counts.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Conversations retrieved successfully",
				ConversationsModel.GetAll.Response,
			),
		),
	}),

	async (c) => {
		const { userId, role } = getCaller(c);

		ConversationAccess.ensureDerivedConversations(userId, role);
		const ids = ConversationAccess.getAccessibleConversationIds(userId, role);
		const items = await ConversationAccess.buildItems(
			ConversationAccess.loadConversations(ids),
			userId,
		);

		return APIResponse.success(c, "Conversations retrieved successfully", items);
	},
);

router.get(
	"/unread",

	APIRouteSpec.authenticated({
		summary: "Count unread messages",
		description: "Total number of unread messages across all of the caller's chats.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Unread count retrieved successfully",
				ConversationsModel.Unread.Response,
			),
		),
	}),

	async (c) => {
		const { userId, role } = getCaller(c);
		return APIResponse.success(c, "Unread count retrieved successfully", {
			total: ConversationAccess.getTotalUnread(userId, role),
		});
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Start conversation",
		description:
			"Start a direct (1:1) or group chat. For `direct`, an existing chat between the two users is returned (200) instead of creating a new one (201).",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Conversation created successfully", ConversationsModel.Create.Response),
			APIResponseSpec.success(
				"Conversation retrieved successfully",
				ConversationsModel.Create.Response,
			),
			APIResponseSpec.badRequest(
				"A direct chat needs exactly one other user / A group chat needs a name / Unknown or inactive users / Syntax or validation error in request",
			),
		),
	}),

	zValidator("json", ConversationsModel.Create.Body),

	async (c) => {
		const { userId } = getCaller(c);
		const body = c.req.valid("json") as ConversationsModel.Create.Body;

		const others = [...new Set(body.user_ids)].filter((id) => id !== userId);
		const valid = await getChatableUserIds(others);
		if (valid.length !== others.length) {
			return APIResponse.badRequest(c, "Unknown or inactive users");
		}

		if (body.type === "direct") {
			if (others.length !== 1) {
				return APIResponse.badRequest(c, "A direct chat needs exactly one other user");
			}
			const otherId = others[0]!;

			const existing = ConversationAccess.findDirectConversation(userId, otherId);
			if (existing) {
				return APIResponse.success(
					c,
					"Conversation retrieved successfully",
					await buildItem(existing, userId),
				);
			}

			const created = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const conversation = await tx
					.insert(DB.Tables.conversations)
					.values({ type: "direct", created_by: userId })
					.returning()
					.get();
				await tx
					.insert(DB.Tables.conversationMembers)
					.values([
						{ conversation_id: conversation.id, user_id: userId, is_member: true },
						{ conversation_id: conversation.id, user_id: otherId, is_member: true },
					])
					.run();
				return conversation;
			});

			return APIResponse.created(
				c,
				"Conversation created successfully",
				await buildItem(created, userId),
			);
		}

		if (!body.name) {
			return APIResponse.badRequest(c, "A group chat needs a name");
		}
		if (others.length === 0) {
			return APIResponse.badRequest(c, "Unknown or inactive users");
		}

		const created = await DB.instance().transaction(async (tx: DrizzleDB) => {
			const conversation = await tx
				.insert(DB.Tables.conversations)
				.values({ type: "group", name: body.name, created_by: userId })
				.returning()
				.get();
			await tx
				.insert(DB.Tables.conversationMembers)
				.values(
					[userId, ...others].map((memberId) => ({
						conversation_id: conversation.id,
						user_id: memberId,
						is_member: true,
					})),
				)
				.run();
			return conversation;
		});

		return APIResponse.created(
			c,
			"Conversation created successfully",
			await buildItem(created, userId),
		);
	},
);

router.use(
	"/:conversationId/*",
	zValidator("param", ConversationsModel.Params),
	async (c, next) => {
		const conversationId = ConversationsModel.Params.shape.conversationId.safeParse(
			c.req.param("conversationId"),
		);
		if (!conversationId.success) return APIResponse.badRequest(c, "Invalid conversation id");

		const conversation = await DB.instance()
			.select()
			.from(DB.Tables.conversations)
			.where(eq(DB.Tables.conversations.id, conversationId.data))
			.get();

		if (!conversation) return APIResponse.notFound(c, "Conversation not found");

		const { userId, role } = getCaller(c);
		if (!ConversationAccess.canAccess(conversation, userId, role)) {
			return APIResponse.forbidden(c, "You do not have access to this conversation");
		}

		c.set("conversation", conversation);
		await next();
	},
);

router.get(
	"/:conversationId",

	APIRouteSpec.authenticated({
		summary: "Get conversation",
		description: "Retrieve one chat with its members, last message and unread count.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Conversation retrieved successfully", ConversationsModel.Conversation),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	async (c) => {
		const { userId } = getCaller(c);
		return APIResponse.success(
			c,
			"Conversation retrieved successfully",
			await buildItem(c.get("conversation"), userId),
		);
	},
);

router.put(
	"/:conversationId",

	APIRouteSpec.authenticated({
		summary: "Update group chat",
		description: "Rename a group chat or add/remove members. Any member of the group may do this.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Conversation updated successfully", ConversationsModel.Update.Response),
			APIResponseSpec.badRequest("Unknown or inactive users / Syntax or validation error in request"),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("Only group chats can be edited"),
		),
	}),

	zValidator("json", ConversationsModel.Update.Body),

	async (c) => {
		const conversation = c.get("conversation");
		if (conversation.type !== "group") {
			return APIResponse.forbidden(c, "Only group chats can be edited");
		}

		const { userId } = getCaller(c);
		const body = c.req.valid("json") as ConversationsModel.Update.Body;

		const toAdd = [...new Set(body.add_user_ids ?? [])];
		if (toAdd.length > 0) {
			const valid = await getChatableUserIds(toAdd);
			if (valid.length !== toAdd.length) {
				return APIResponse.badRequest(c, "Unknown or inactive users");
			}
		}

		await DB.instance().transaction(async (tx: DrizzleDB) => {
			if (body.name) {
				await tx
					.update(DB.Tables.conversations)
					.set({ name: body.name })
					.where(eq(DB.Tables.conversations.id, conversation.id))
					.run();
			}

			for (const memberId of toAdd) {
				await tx
					.insert(DB.Tables.conversationMembers)
					.values({ conversation_id: conversation.id, user_id: memberId, is_member: true })
					.onConflictDoUpdate({
						target: [
							DB.Tables.conversationMembers.conversation_id,
							DB.Tables.conversationMembers.user_id,
						],
						set: { is_member: true },
					})
					.run();
			}

			if (body.remove_user_ids?.length) {
				await tx
					.update(DB.Tables.conversationMembers)
					.set({ is_member: false })
					.where(
						and(
							eq(DB.Tables.conversationMembers.conversation_id, conversation.id),
							inArray(DB.Tables.conversationMembers.user_id, body.remove_user_ids),
						),
					)
					.run();
			}
		});

		const refreshed = await DB.instance()
			.select()
			.from(DB.Tables.conversations)
			.where(eq(DB.Tables.conversations.id, conversation.id))
			.get();

		return APIResponse.success(
			c,
			"Conversation updated successfully",
			await buildItem(refreshed ?? conversation, userId),
		);
	},
);

router.delete(
	"/:conversationId/membership",

	APIRouteSpec.authenticated({
		summary: "Leave group chat",
		description:
			"Leave a group chat. Direct chats and event/group/core team channels cannot be left.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("You left the conversation"),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("Only group chats can be left"),
		),
	}),

	async (c) => {
		const conversation = c.get("conversation");
		if (conversation.type !== "group") {
			return APIResponse.forbidden(c, "Only group chats can be left");
		}

		await DB.instance()
			.update(DB.Tables.conversationMembers)
			.set({ is_member: false })
			.where(
				and(
					eq(DB.Tables.conversationMembers.conversation_id, conversation.id),
					eq(DB.Tables.conversationMembers.user_id, getCaller(c).userId),
				),
			)
			.run();

		return APIResponse.successNoData(c, "You left the conversation");
	},
);

router.post(
	"/:conversationId/read",

	APIRouteSpec.authenticated({
		summary: "Mark conversation as read",
		description: "Set the caller's read marker of a chat to now.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Conversation marked as read"),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	async (c) => {
		ConversationAccess.markRead(c.get("conversation").id, getCaller(c).userId);
		return APIResponse.successNoData(c, "Conversation marked as read");
	},
);

router.route("/", (await import("./messages")).router);
