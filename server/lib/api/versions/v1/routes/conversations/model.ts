import { z } from "zod";
import { ConversationAccess } from "../../../../utils/conversations";

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
