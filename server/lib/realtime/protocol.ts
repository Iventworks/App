/**
 * What travels over the realtime WebSocket (`/ws/realtime`). The frontend imports the types
 * (`import type`, `app/composables/useRealtime.ts`).
 *
 * The socket only says *that* something changed; the data itself still comes from the REST API
 * (e.g. `/conversations/{id}/messages/sync`), so there is one path for loading and checking access.
 */
export namespace RealtimeProtocol {
	/** Why a chat changed. */
	export type ConversationReason =
		/** A new message. */
		| "message"
		/** A message was edited, deleted, reacted to, pinned or unpinned. */
		| "update"
		/** Someone read up to a later point (read ticks). */
		| "read"
		/** Created, renamed, members added or removed. */
		| "members"
		/** The receiver's own settings (pinned, muted) changed on another device. */
		| "settings";

	export type ServerEvent =
		/** Right after connecting: who is online in the org. */
		| { type: "hello"; user_id: number; online_user_ids: number[] }
		| { type: "pong" }
		| { type: "conversation"; conversation_id: number; reason: ConversationReason }
		/** Someone is typing in a chat (repeated every few seconds while they type). */
		| {
				type: "typing";
				conversation_id: number;
				user: { id: number; display_name: string };
		  }
		| { type: "presence"; user_id: number; online: boolean }
		/** The receiver has new notifications. */
		| { type: "notification" };

	export type ClientEvent = { type: "ping" } | { type: "typing"; conversation_id: number };

	/** Close codes the server uses (4000–4999 are free for applications). */
	export const CLOSE_UNAUTHORIZED = 4401;
	export const CLOSE_TOO_MANY_MESSAGES = 4429;
	export const CLOSE_TOO_MANY_CONNECTIONS = 4430;
}
