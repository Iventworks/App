import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { PushTriggers } from "../../../../../../push/triggers";
import { Realtime } from "../../../../../../realtime";
import { APIResponse } from "../../../../../utils/api-res";
import { ConversationAccess } from "../../../../../utils/conversations";
import { getAuthUserId } from "../../../../../utils/guards";
import { MessageService } from "../../../../../utils/messages";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import type { ConversationsEnv } from "..";
import { MessagesModel } from "./model";

type MessagesEnv = {
	Variables: ConversationsEnv["Variables"] & { message: DB.Models.Message };
};

export const router = new Hono<MessagesEnv>().basePath("/:conversationId/messages");

/**
 * Mark a message as changed so the other people's next `/sync` picks it up, and tell their open
 * chats right away.
 */
async function touch(
	conversation: DB.Models.Conversation,
	messageId: number,
	changes: Partial<DB.Models.Message> = {},
) {
	const updated = await DB.instance()
		.update(DB.Tables.messages)
		.set({ ...changes, updated_at: Date.now() })
		.where(and(inOrg(DB.Tables.messages), eq(DB.Tables.messages.id, messageId)))
		.returning()
		.get();
	Realtime.conversationChanged(conversation, "update");
	return updated;
}

async function respond(message: DB.Models.Message, userId: number) {
	const [result] = await MessageService.toResponse([message], userId);
	return result!;
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List messages",
		description:
			"Messages of a chat, oldest → newest. Without cursor: the latest `limit` messages. `after=<id>` loads newer messages, `before=<id>` older history, `around=<id>` a page with that message in the middle (to jump to a search hit, a pinned or a quoted message).",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Messages retrieved successfully", MessagesModel.GetAll.Response),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	zValidator("query", MessagesModel.GetAll.Query),

	async (c) => {
		const conversation = c.get("conversation");
		const { after, before, around, limit } = c.req.valid("query") as MessagesModel.GetAll.Query;
		const table = DB.Tables.messages;
		const inChat = and(
			inOrg(table),
			eq(table.conversation_id, conversation.id),
			isNull(table.deleted_at),
		);

		const newer = async (id: number, max: number) =>
			await DB.instance()
				.select()
				.from(table)
				.where(and(inChat, gt(table.id, id)))
				.orderBy(asc(table.id))
				.limit(max)
				.all();
		const older = async (id: number | undefined, max: number) =>
			(
				await DB.instance()
					.select()
					.from(table)
					.where(and(inChat, id !== undefined ? lt(table.id, id) : undefined))
					.orderBy(desc(table.id))
					.limit(max)
					.all()
			).reverse();

		let rows: DB.Models.Message[];
		if (around !== undefined) {
			const half = Math.floor(limit / 2);
			// `around + 1`: the message itself belongs to the older half.
			rows = [...(await older(around + 1, limit - half)), ...(await newer(around, half))];
		} else if (after !== undefined) {
			rows = await newer(after, limit);
		} else {
			rows = await older(before, limit);
		}

		return APIResponse.success(
			c,
			"Messages retrieved successfully",
			await MessageService.toResponse(rows, getAuthUserId(c)),
		);
	},
);

router.get(
	"/sync",

	APIRouteSpec.authenticated({
		summary: "Sync messages",
		description:
			"Polling endpoint for an open chat: new messages after `after`, plus what changed on already-loaded messages since `since` (the previous response's `server_time`) — edits, reactions, pins and deletions — the ids of all pinned messages and how far the others have read.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Messages synced successfully", MessagesModel.Sync.Response),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	zValidator("query", MessagesModel.Sync.Query),

	async (c) => {
		const conversation = c.get("conversation");
		const userId = getAuthUserId(c);
		const { after, since, from } = c.req.valid("query") as MessagesModel.Sync.Query;
		const table = DB.Tables.messages;

		// Taken before querying; changes in the same millisecond are re-sent next time (`>=`).
		const serverTime = Date.now();

		const fresh = await DB.instance()
			.select()
			.from(table)
			.where(
				and(
					inOrg(table),
					eq(table.conversation_id, conversation.id),
					gt(table.id, after),
					isNull(table.deleted_at),
				),
			)
			.orderBy(asc(table.id))
			.limit(200)
			.all();

		const changed = await DB.instance()
			.select()
			.from(table)
			.where(
				and(
					inOrg(table),
					eq(table.conversation_id, conversation.id),
					gte(table.id, from),
					lte(table.id, after),
					gte(table.updated_at, since),
				),
			)
			.orderBy(asc(table.id))
			.all();

		return APIResponse.success(c, "Messages synced successfully", {
			messages: await MessageService.toResponse(fresh, userId),
			updated: await MessageService.toResponse(
				changed.filter((message) => message.deleted_at === null),
				userId,
			),
			deleted_ids: changed
				.filter((message) => message.deleted_at !== null)
				.map((message) => message.id),
			pinned_ids: await MessageService.pinnedIds(conversation.id),
			read_by_all_until: ConversationAccess.getReadByAllUntil(conversation, userId),
			server_time: serverTime,
		} satisfies MessagesModel.Sync.Response);
	},
);

router.get(
	"/pinned",

	APIRouteSpec.authenticated({
		summary: "List pinned messages",
		description: "The messages pinned in a chat, the latest pin first.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Pinned messages retrieved successfully", MessagesModel.Pinned.Response),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	async (c) => {
		const pinned = await MessageService.pinned(c.get("conversation").id);
		return APIResponse.success(
			c,
			"Pinned messages retrieved successfully",
			await MessageService.toResponse(pinned, getAuthUserId(c)),
		);
	},
);

router.get(
	"/search",

	APIRouteSpec.authenticated({
		summary: "Search messages of a chat",
		description:
			"Messages of the chat whose text or attachment names contain `q`, newest first. `before=<id>` loads the next page.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Messages found successfully", MessagesModel.Search.Response),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	zValidator("query", MessagesModel.Search.Query),

	async (c) => {
		const { q, before, limit } = c.req.valid("query") as MessagesModel.Search.Query;
		const hits = await MessageService.search([c.get("conversation").id], q, { limit, before });
		return APIResponse.success(
			c,
			"Messages found successfully",
			await MessageService.toResponse(hits, getAuthUserId(c)),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Send message",
		description:
			"Post a message to a chat: text, attachments uploaded before (`attachment_ids`) or both, optionally as an answer to another message (`reply_to_id`). Also marks the chat as read for the sender.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Message sent successfully", MessagesModel.Create.Response),
			APIResponseSpec.badRequest(
				"Unknown attachment / The message to reply to was not found / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	zValidator("json", MessagesModel.Create.Body),

	async (c) => {
		const conversation = c.get("conversation");
		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as MessagesModel.Create.Body;

		// Only the caller's own uploads to this chat that are not part of a message yet.
		const attachmentIds = [...new Set(body.attachment_ids)];
		if (attachmentIds.length > 0) {
			const pending = new Set(
				(await MessageService.pendingUploads(conversation.id, userId)).map((file) => file.id),
			);
			if (attachmentIds.some((id) => !pending.has(id))) {
				return APIResponse.badRequest(c, "Unknown attachment");
			}
		}

		if (body.reply_to_id !== null) {
			if (!(await MessageService.find(conversation.id, body.reply_to_id))) {
				return APIResponse.badRequest(c, "The message to reply to was not found");
			}
		}

		const message = await DB.instance().transaction(async (tx: DrizzleDB) => {
			const created = await tx
				.insert(DB.Tables.messages)
				// Explicit ms timestamp: the column default `unixepoch() * 1000` only has second
				// precision, which would hide messages sent right after someone's read marker.
				.values({
					org_id: OrgContext.id(),
					conversation_id: conversation.id,
					sender_id: userId,
					content: body.content,
					reply_to_id: body.reply_to_id,
					created_at: Date.now(),
				})
				.returning()
				.get();
			if (attachmentIds.length > 0) {
				await tx
					.update(DB.Tables.files)
					.set({ message_id: created.id })
					.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.id, attachmentIds)))
					.run();
			}
			await tx
				.update(DB.Tables.conversations)
				.set({ last_message_at: created.created_at })
				.where(and(inOrg(DB.Tables.conversations), eq(DB.Tables.conversations.id, conversation.id)))
				.run();
			return created;
		});

		ConversationAccess.markRead(conversation.id, userId, message.created_at);
		Realtime.conversationChanged(conversation, "message");

		const response = await respond(message, userId);
		if (response.sender) {
			void PushTriggers.chatMessage(conversation, message, response.sender, response.attachments);
		}
		return APIResponse.created(c, "Message sent successfully", response);
	},
);

router.use("/:messageId/*", zValidator("param", MessagesModel.Params), async (c, next) => {
	const messageId = MessagesModel.Params.shape.messageId.safeParse(c.req.param("messageId"));
	if (!messageId.success) return APIResponse.badRequest(c, "Invalid message id");

	const message = await MessageService.find(c.get("conversation").id, messageId.data);
	if (!message) return APIResponse.notFound(c, "Message not found");

	c.set("message", message);
	await next();
});

router.put(
	"/:messageId",

	APIRouteSpec.authenticated({
		summary: "Edit message",
		description: "Edit the text of one of the caller's own messages.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Message updated successfully", MessagesModel.Update.Response),
			APIResponseSpec.badRequest(
				"A message needs text or an attachment / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You can only change your own messages"),
		),
	}),

	zValidator("json", MessagesModel.Update.Body),

	async (c) => {
		const message = c.get("message");
		const userId = getAuthUserId(c);
		if (message.sender_id !== userId) {
			return APIResponse.forbidden(c, "You can only change your own messages");
		}

		const { content } = c.req.valid("json") as MessagesModel.Update.Body;
		if (content.length === 0 && (await MessageService.attachmentsOf(message.id)).length === 0) {
			return APIResponse.badRequest(c, "A message needs text or an attachment");
		}

		const updated = await touch(c.get("conversation"), message.id, {
			content,
			edited_at: Date.now(),
		});
		return APIResponse.success(c, "Message updated successfully", await respond(updated, userId));
	},
);

router.delete(
	"/:messageId",

	APIRouteSpec.authenticated({
		summary: "Delete message",
		description:
			"Delete one of the caller's own messages. The text, its attachments and reactions are removed; other members' open chats drop it on their next sync.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Message deleted successfully"),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You can only change your own messages"),
		),
	}),

	async (c) => {
		const message = c.get("message");
		if (message.sender_id !== getAuthUserId(c)) {
			return APIResponse.forbidden(c, "You can only change your own messages");
		}

		const attachments = await MessageService.attachmentsOf(message.id);
		const now = Date.now();
		await DB.instance().transaction(async (tx: DrizzleDB) => {
			// Tombstone instead of a hard delete so `/sync` can report it; everything it said goes.
			await tx
				.update(DB.Tables.messages)
				.set({
					content: "",
					reply_to_id: null,
					pinned_at: null,
					pinned_by: null,
					deleted_at: now,
					updated_at: now,
				})
				.where(and(inOrg(DB.Tables.messages), eq(DB.Tables.messages.id, message.id)))
				.run();
			await tx
				.delete(DB.Tables.messageReactions)
				.where(
					and(inOrg(DB.Tables.messageReactions), eq(DB.Tables.messageReactions.message_id, message.id)),
				)
				.run();
			await MessageService.removeFiles(attachments, tx);
		});
		Realtime.conversationChanged(c.get("conversation"), "update");

		return APIResponse.successNoData(c, "Message deleted successfully");
	},
);

router.post(
	"/:messageId/reactions",

	APIRouteSpec.authenticated({
		summary: "Toggle reaction",
		description:
			"React to a message with an emoji — or take the reaction back when the caller already reacted with that emoji.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Reaction updated successfully", MessagesModel.React.Response),
			APIResponseSpec.badRequest(
				"Too many different reactions on this message / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	zValidator("json", MessagesModel.React.Body),

	async (c) => {
		const message = c.get("message");
		const userId = getAuthUserId(c);
		const { emoji } = c.req.valid("json") as MessagesModel.React.Body;
		const table = DB.Tables.messageReactions;

		const existing = await DB.instance()
			.select()
			.from(table)
			.where(and(inOrg(table), eq(table.message_id, message.id)))
			.all();

		if (existing.some((entry) => entry.user_id === userId && entry.emoji === emoji)) {
			await DB.instance()
				.delete(table)
				.where(
					and(
						inOrg(table),
						eq(table.message_id, message.id),
						eq(table.user_id, userId),
						eq(table.emoji, emoji),
					),
				)
				.run();
		} else {
			const emojis = new Set(existing.map((entry) => entry.emoji));
			if (!emojis.has(emoji) && emojis.size >= MessageService.MAX_REACTION_EMOJIS) {
				return APIResponse.badRequest(c, "Too many different reactions on this message");
			}
			await DB.instance()
				.insert(table)
				.values({
					org_id: OrgContext.id(),
					message_id: message.id,
					user_id: userId,
					emoji,
					created_at: Date.now(),
				})
				.run();
		}

		const updated = await touch(c.get("conversation"), message.id);
		return APIResponse.success(c, "Reaction updated successfully", await respond(updated, userId));
	},
);

router.put(
	"/:messageId/pin",

	APIRouteSpec.authenticated({
		summary: "Pin message",
		description: "Pin a message for everyone in the chat. Anyone in the chat may pin.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Message pinned successfully", MessagesModel.Pin.Response),
			APIResponseSpec.badRequest("Too many pinned messages in this chat"),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	async (c) => {
		const message = c.get("message");
		const userId = getAuthUserId(c);

		if (message.pinned_at !== null) {
			return APIResponse.success(c, "Message pinned successfully", await respond(message, userId));
		}
		const pinned = await MessageService.pinnedIds(message.conversation_id);
		if (pinned.length >= MessageService.MAX_PINNED) {
			return APIResponse.badRequest(c, "Too many pinned messages in this chat");
		}

		const updated = await touch(c.get("conversation"), message.id, {
			pinned_at: Date.now(),
			pinned_by: userId,
		});
		return APIResponse.success(c, "Message pinned successfully", await respond(updated, userId));
	},
);

router.delete(
	"/:messageId/pin",

	APIRouteSpec.authenticated({
		summary: "Unpin message",
		description: "Remove a message from the chat's pinned messages. Anyone in the chat may unpin.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Message unpinned successfully", MessagesModel.Pin.Response),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	async (c) => {
		const message = c.get("message");
		const userId = getAuthUserId(c);

		const updated =
			message.pinned_at === null
				? message
				: await touch(c.get("conversation"), message.id, { pinned_at: null, pinned_by: null });
		return APIResponse.success(c, "Message unpinned successfully", await respond(updated, userId));
	},
);
