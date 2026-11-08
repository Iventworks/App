import { and, asc, desc, eq, gt, gte, isNull, lt, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { APIResponse } from "../../../../../utils/api-res";
import { ConversationAccess } from "../../../../../utils/conversations";
import { getAuthUserId } from "../../../../../utils/guards";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import type { ConversationsEnv } from "..";
import { MessagesModel } from "./model";

type MessagesEnv = {
	Variables: ConversationsEnv["Variables"] & { message: DB.Models.Message };
};

export const router = new Hono<MessagesEnv>().basePath("/:conversationId/messages");

async function toResponse(messages: DB.Models.Message[], userId: number) {
	const users = await UserSummary.fetchMap(messages.map((message) => message.sender_id));
	return messages.map(
		(message): MessagesModel.Message => ({
			id: message.id,
			conversation_id: message.conversation_id,
			content: message.content,
			created_at: message.created_at,
			edited_at: message.edited_at,
			sender: message.sender_id ? (users.get(message.sender_id) ?? null) : null,
			is_own: message.sender_id === userId,
		}),
	);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List messages",
		description:
			"Messages of a chat, oldest → newest. Without cursor: the latest `limit` messages. `after=<id>` polls for newer messages, `before=<id>` loads older history.",
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
		const { after, before, limit } = c.req.valid("query") as MessagesModel.GetAll.Query;
		const table = DB.Tables.messages;

		let rows: DB.Models.Message[];
		if (after !== undefined) {
			rows = await DB.instance()
				.select()
				.from(table)
				.where(
					and(eq(table.conversation_id, conversation.id), gt(table.id, after), isNull(table.deleted_at)),
				)
				.orderBy(asc(table.id))
				.limit(limit)
				.all();
		} else {
			rows = (
				await DB.instance()
					.select()
					.from(table)
					.where(
						and(
							eq(table.conversation_id, conversation.id),
							isNull(table.deleted_at),
							before !== undefined ? lt(table.id, before) : undefined,
						),
					)
					.orderBy(desc(table.id))
					.limit(limit)
					.all()
			).reverse();
		}

		return APIResponse.success(
			c,
			"Messages retrieved successfully",
			await toResponse(rows, getAuthUserId(c)),
		);
	},
);

router.get(
	"/sync",

	APIRouteSpec.authenticated({
		summary: "Sync messages",
		description:
			"Polling endpoint for an open chat: new messages after `after`, plus edits and deletions of already-loaded messages since `since` (the previous response's `server_time`).",
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
		const { after, since } = c.req.valid("query") as MessagesModel.Sync.Query;
		const table = DB.Tables.messages;

		// Taken before querying; changes in the same millisecond are re-sent next time (`>=`).
		const serverTime = Date.now();

		const fresh = await DB.instance()
			.select()
			.from(table)
			.where(
				and(eq(table.conversation_id, conversation.id), gt(table.id, after), isNull(table.deleted_at)),
			)
			.orderBy(asc(table.id))
			.limit(200)
			.all();

		const changed = await DB.instance()
			.select()
			.from(table)
			.where(
				and(
					eq(table.conversation_id, conversation.id),
					lte(table.id, after),
					or(gte(table.edited_at, since), gte(table.deleted_at, since)),
				),
			)
			.orderBy(asc(table.id))
			.all();

		return APIResponse.success(c, "Messages synced successfully", {
			messages: await toResponse(fresh, userId),
			updated: await toResponse(
				changed.filter((message) => message.deleted_at === null),
				userId,
			),
			deleted_ids: changed
				.filter((message) => message.deleted_at !== null)
				.map((message) => message.id),
			server_time: serverTime,
		} satisfies MessagesModel.Sync.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Send message",
		description: "Post a message to a chat. Also marks the chat as read for the sender.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Message sent successfully", MessagesModel.Create.Response),
			APIResponseSpec.notFound("Conversation not found"),
			APIResponseSpec.forbidden("You do not have access to this conversation"),
		),
	}),

	zValidator("json", MessagesModel.Create.Body),

	async (c) => {
		const conversation = c.get("conversation");
		const userId = getAuthUserId(c);
		const { content } = c.req.valid("json") as MessagesModel.Create.Body;

		const message = await DB.instance().transaction(async (tx: DrizzleDB) => {
			const created = await tx
				.insert(DB.Tables.messages)
				// Explicit ms timestamp: the column default `unixepoch() * 1000` only has second
				// precision, which would hide messages sent right after someone's read marker.
				.values({
					conversation_id: conversation.id,
					sender_id: userId,
					content,
					created_at: Date.now(),
				})
				.returning()
				.get();
			await tx
				.update(DB.Tables.conversations)
				.set({ last_message_at: created.created_at })
				.where(eq(DB.Tables.conversations.id, conversation.id))
				.run();
			return created;
		});

		ConversationAccess.markRead(conversation.id, userId, message.created_at);

		const [result] = await toResponse([message], userId);
		return APIResponse.created(c, "Message sent successfully", result!);
	},
);

router.use("/:messageId/*", zValidator("param", MessagesModel.Params), async (c, next) => {
	const messageId = MessagesModel.Params.shape.messageId.safeParse(c.req.param("messageId"));
	if (!messageId.success) return APIResponse.badRequest(c, "Invalid message id");

	const message = await DB.instance()
		.select()
		.from(DB.Tables.messages)
		.where(
			and(
				eq(DB.Tables.messages.id, messageId.data),
				eq(DB.Tables.messages.conversation_id, c.get("conversation").id),
				isNull(DB.Tables.messages.deleted_at),
			),
		)
		.get();

	if (!message) return APIResponse.notFound(c, "Message not found");
	if (message.sender_id !== getAuthUserId(c)) {
		return APIResponse.forbidden(c, "You can only change your own messages");
	}

	c.set("message", message);
	await next();
});

router.put(
	"/:messageId",

	APIRouteSpec.authenticated({
		summary: "Edit message",
		description: "Edit one of the caller's own messages.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Message updated successfully", MessagesModel.Update.Response),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You can only change your own messages"),
		),
	}),

	zValidator("json", MessagesModel.Update.Body),

	async (c) => {
		const { content } = c.req.valid("json") as MessagesModel.Update.Body;

		const updated = await DB.instance()
			.update(DB.Tables.messages)
			.set({ content, edited_at: Date.now() })
			.where(eq(DB.Tables.messages.id, c.get("message").id))
			.returning()
			.get();

		const [result] = await toResponse([updated], getAuthUserId(c));
		return APIResponse.success(c, "Message updated successfully", result!);
	},
);

router.delete(
	"/:messageId",

	APIRouteSpec.authenticated({
		summary: "Delete message",
		description:
			"Delete one of the caller's own messages. The text is removed; other members' open chats drop it on their next sync.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Message deleted successfully"),
			APIResponseSpec.notFound("Message not found"),
			APIResponseSpec.forbidden("You can only change your own messages"),
		),
	}),

	async (c) => {
		// Tombstone instead of a hard delete so `/sync` can report it; the text itself is wiped.
		await DB.instance()
			.update(DB.Tables.messages)
			.set({ content: "", deleted_at: Date.now() })
			.where(eq(DB.Tables.messages.id, c.get("message").id))
			.run();
		return APIResponse.successNoData(c, "Message deleted successfully");
	},
);
