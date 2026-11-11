import { z } from "zod";
import { CONVERSATION_TYPES, EVENT_MEMBER_ROLES } from "../../../../../db/schema";
import { ConversationAccess } from "../../../../utils/conversations";
import { MessageService } from "../../../../utils/messages";
import { UserSummary } from "../../../../utils/shared-models/userSummary";

export namespace ConversationsModel {
	export const Conversation = ConversationAccess.ItemSchema;
	export type Conversation = z.infer<typeof Conversation>;

	export const Params = z.object({
		conversationId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace ConversationsModel.GetAll {
	export const Response = z.array(ConversationsModel.Conversation);
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Unread {
	export const Response = z.object({ total: z.number() });
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Search {
	export const Query = z.object({
		q: z.string().trim().min(2).max(100),
		limit: z.coerce.number().int().min(1).max(50).default(30),
	});
	export type Query = z.infer<typeof Query>;

	/** Newest first. */
	export const Response = z.array(
		z.object({
			conversation: z.object({
				id: z.number(),
				type: z.enum(CONVERSATION_TYPES),
				title: z.string(),
			}),
			message: MessageService.MessageSchema,
		}),
	);
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Create {
	export const Body = z.object({
		/** `direct` = 1:1 chat (re-used if it already exists), `group` = named group chat. */
		type: z.enum(["direct", "group"]),
		user_ids: z.array(z.number().int().positive()).min(1).max(100),
		/** Required for group chats. */
		name: z.string().trim().min(1).max(100).optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = ConversationsModel.Conversation;
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Update {
	export const Body = z
		.object({
			name: z.string().trim().min(1).max(100),
			add_user_ids: z.array(z.number().int().positive()).max(100),
			remove_user_ids: z.array(z.number().int().positive()).max(100),
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = ConversationsModel.Conversation;
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Members {
	export const Response = z.array(
		z.object({
			user: UserSummary.Schema,
			/** Role and function in the chat's event (event and group channels only). */
			event_role: z.enum(EVENT_MEMBER_ROLES).nullable(),
			position: z.string().nullable(),
			/** How far this person has read; null = never opened the chat. */
			last_read_at: z.number().nullable(),
			/** When the person was last online; null when unknown or they don't share it. */
			last_seen_at: z.number().nullable(),
		}),
	);
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Preferences {
	export const Body = z
		.object({
			/** Keep the chat on top of the caller's list. */
			pinned: z.boolean(),
			/** Leave the chat's unread messages out of the caller's total. */
			muted: z.boolean(),
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = ConversationsModel.Conversation;
	export type Response = z.infer<typeof Response>;
}

export namespace ConversationsModel.Attachments {
	export const Params = z.object({
		conversationId: z.coerce.number().int().positive(),
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace ConversationsModel.Attachments.Upload {
	export const Form = z.object({
		file: z.file().describe("The file to attach"),
	});
	export type Form = z.infer<typeof Form>;

	export const Response = MessageService.AttachmentSchema;
	export type Response = z.infer<typeof Response>;
}
