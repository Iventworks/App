import { z } from "zod";
import { MessageService } from "../../../../../utils/messages";

export namespace MessagesModel {
	export const Message = MessageService.MessageSchema;
	export type Message = z.infer<typeof Message>;

	export const Attachment = MessageService.AttachmentSchema;
	export type Attachment = z.infer<typeof Attachment>;

	export const Params = z.object({
		conversationId: z.coerce.number().int().positive(),
		messageId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	/** May be empty when the message carries attachments. */
	export const Content = z.string().trim().max(4000);
	export type Content = z.infer<typeof Content>;
}

export namespace MessagesModel.GetAll {
	export const Query = z.object({
		/** Only messages with an id greater than this (polling for new messages). */
		after: z.coerce.number().int().min(0).optional(),
		/** Only messages with an id lower than this (loading older history). */
		before: z.coerce.number().int().positive().optional(),
		/** The message with this id in the middle of the page (jumping to a search hit or pin). */
		around: z.coerce.number().int().positive().optional(),
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
		/** `server_time` of the previous sync; changes since then come back. */
		since: z.coerce.number().int().min(0),
		/** Lowest message id the client has loaded: changes of older messages are left out. */
		from: z.coerce.number().int().min(0).default(0),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		/** New messages (id > `after`), oldest → newest. */
		messages: z.array(MessagesModel.Message),
		/** Already-known messages that changed since `since`: edits, reactions, pins. */
		updated: z.array(MessagesModel.Message),
		/** Already-known messages deleted since `since`. */
		deleted_ids: z.array(z.number()),
		/** Ids of all pinned messages, so the client notices pins outside of what it has loaded. */
		pinned_ids: z.array(z.number()),
		/** More changes exist below the cut (500 per sync): reload the history. */
		truncated: z.boolean(),
		/**
		 * Everyone else in the chat has read up to this instant (0 = someone never opened it): the
		 * caller's messages up to it are "read".
		 */
		read_by_all_until: z.number(),
		/** Pass as `since` on the next sync (server clock, so client clock skew does not matter). */
		server_time: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Create {
	export const Body = z
		.object({
			content: MessagesModel.Content.default(""),
			/** Uploads from `POST /conversations/{id}/attachments` to send with this message. */
			attachment_ids: z
				.array(z.number().int().positive())
				.max(MessageService.MAX_ATTACHMENTS)
				.default([]),
			/** Answer a message of this chat (it is quoted above the new one). */
			reply_to_id: z.number().int().positive().nullable().default(null),
		})
		.refine((data) => data.content.length > 0 || data.attachment_ids.length > 0, {
			message: "A message needs text or an attachment",
			path: ["content"],
		});
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

export namespace MessagesModel.React {
	export const Body = z.object({ emoji: MessageService.Emoji });
	export type Body = z.infer<typeof Body>;

	export const Response = MessagesModel.Message;
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Pin {
	export const Response = MessagesModel.Message;
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Pinned {
	/** The latest pin first. */
	export const Response = z.array(MessagesModel.Message);
	export type Response = z.infer<typeof Response>;
}

export namespace MessagesModel.Search {
	export const Query = z.object({
		q: z.string().trim().min(2).max(100),
		/** Only hits with an id lower than this (the next page). */
		before: z.coerce.number().int().positive().optional(),
		limit: z.coerce.number().int().min(1).max(50).default(30),
	});
	export type Query = z.infer<typeof Query>;

	/** Newest first. */
	export const Response = z.array(MessagesModel.Message);
	export type Response = z.infer<typeof Response>;
}
