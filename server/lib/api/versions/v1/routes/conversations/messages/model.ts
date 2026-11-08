import { z } from "zod";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace MessagesModel {
	export const Message = z.object({
		id: z.number(),
		conversation_id: z.number(),
		content: z.string(),
		created_at: z.number(),
		edited_at: z.number().nullable(),
		/** Null when the sender's account was deleted. */
		sender: UserSummary.Schema.nullable(),
		is_own: z.boolean(),
	});
	export type Message = z.infer<typeof Message>;

	export const Params = z.object({
		conversationId: z.coerce.number().int().positive(),
		messageId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Content = z.string().trim().min(1).max(4000);
	export type Content = z.infer<typeof Content>;
}

export namespace MessagesModel.GetAll {
	export const Query = z.object({
		/** Only messages with an id greater than this (polling for new messages). */
		after: z.coerce.number().int().min(0).optional(),
		/** Only messages with an id lower than this (loading older history). */
		before: z.coerce.number().int().positive().optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	});
	export type Query = z.infer<typeof Query>;

	/** Oldest → newest. */
	export const Response = z.array(MessagesModel.Message);
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Sync {
	export const Query = z.object({
		/** Highest message id the client has; newer messages come back in `messages`. */
		after: z.coerce.number().int().min(0),
		/** `server_time` of the previous sync; edits/deletions since then come back. */
		since: z.coerce.number().int().min(0),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		/** New messages (id > `after`), oldest → newest. */
		messages: z.array(MessagesModel.Message),
		/** Already-known messages edited since `since`. */
		updated: z.array(MessagesModel.Message),
		/** Already-known messages deleted since `since`. */
		deleted_ids: z.array(z.number()),
		/** Pass as `since` on the next sync (server clock, so client clock skew does not matter). */
		server_time: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Create {
	export const Body = z.object({ content: MessagesModel.Content });
	export type Body = z.infer<typeof Body>;

	export const Response = MessagesModel.Message;
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Update {
	export const Body = z.object({ content: MessagesModel.Content });
	export type Body = z.infer<typeof Body>;

	export const Response = MessagesModel.Message;
	export type Response = z.infer<typeof Response>;
}
