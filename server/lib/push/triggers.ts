import { and, eq, inArray } from "drizzle-orm";
import { ConversationAccess } from "../api/utils/conversations";
import { UserPreferencesHandler } from "../api/utils/preferences";
import { DB } from "../db";
import { inOrg, OrgContext } from "../orgs/context";
import { RealtimeHub } from "../realtime/hub";
import { Logger } from "../utils/logger";
import { PushService } from "./service";

/**
 * When a push goes out. Nobody gets one while they are using the app (an active, visible tab —
 * reported over the realtime socket), and everyone decides in their settings what they want.
 * Called after the change is stored, inside the org's context; never throws.
 */
export namespace PushTriggers {
	/** People among `userIds` who are not using the app right now. */
	function away(userIds: Iterable<number>) {
		const orgId = OrgContext.id();
		return [...new Set(userIds)].filter((id) => !RealtimeHub.isActive(orgId, id));
	}

	/** In-app notifications (task assigned, event added, date cancelled, …). */
	export function notification(
		userIds: number[],
		notification: { type: string; title: string; body?: string; link?: string },
	) {
		return PushService.track(notificationNow(userIds, notification));
	}

	async function notificationNow(
		userIds: number[],
		notification: { type: string; title: string; body?: string; link?: string },
	) {
		try {
			const candidates = away(userIds);
			if (candidates.length === 0) return;
			const prefs = await UserPreferencesHandler.getMany(candidates, "notifications");
			const recipients = candidates.filter((id) => prefs.get(id)?.push_notifications !== false);
			PushService.send(
				recipients,
				{
					kind: "notification",
					title: notification.title,
					body: notification.body ?? "",
					url: notification.link ?? "/",
				},
				{ ttlSeconds: 3 * 24 * 60 * 60 },
			);
		} catch (error) {
			Logger.error("Web Push for a notification failed:", error);
		}
	}

	/** A new chat message: everyone in the chat but the sender, unless they muted it. */
	export function chatMessage(
		conversation: DB.Models.Conversation,
		message: Pick<DB.Models.Message, "id" | "content">,
		sender: { id: number; display_name: string },
		attachments: { name: string; is_image: boolean }[],
	) {
		return PushService.track(chatMessageNow(conversation, message, sender, attachments));
	}

	async function chatMessageNow(
		conversation: DB.Models.Conversation,
		message: Pick<DB.Models.Message, "id" | "content">,
		sender: { id: number; display_name: string },
		attachments: { name: string; is_image: boolean }[],
	) {
		try {
			const members = ConversationAccess.getMembers(conversation)
				.map((member) => member.user_id)
				.filter((id) => id !== sender.id);
			let candidates = away(members);
			if (candidates.length === 0) return;

			const muted = new Set(
				DB.instance()
					.select({ user_id: DB.Tables.conversationMembers.user_id })
					.from(DB.Tables.conversationMembers)
					.where(
						and(
							inOrg(DB.Tables.conversationMembers),
							eq(DB.Tables.conversationMembers.conversation_id, conversation.id),
							inArray(DB.Tables.conversationMembers.user_id, candidates),
							eq(DB.Tables.conversationMembers.muted, true),
						),
					)
					.all()
					.map((row) => row.user_id),
			);
			candidates = candidates.filter((id) => !muted.has(id));
			if (candidates.length === 0) return;

			const prefs = await UserPreferencesHandler.getMany(candidates, "notifications");
			const recipients = candidates.filter((id) => prefs.get(id)?.push_messages !== false);
			if (recipients.length === 0) return;

			// The chat's name as everyone but the sender sees it (a direct chat: the sender).
			const [item] = await ConversationAccess.buildItems([conversation], sender.id);
			const direct = conversation.type === "direct";
			const title = direct ? sender.display_name : (item?.title ?? "Neue Nachricht");

			const firstName = sender.display_name.split(" ")[0] ?? sender.display_name;
			const text =
				message.content ||
				(attachments.length === 0
					? ""
					: attachments.every((attachment) => attachment.is_image)
						? attachments.length === 1
							? "📷 Foto"
							: `📷 ${attachments.length} Fotos`
						: attachments.length === 1
							? `📎 ${attachments[0]!.name}`
							: `📎 ${attachments.length} Dateien`);
			const withPreview = direct ? text : `${firstName}: ${text}`;
			const withoutPreview = direct ? "Neue Nachricht" : `Neue Nachricht von ${firstName}`;

			const base = {
				kind: "message" as const,
				title,
				url: `/messages?c=${conversation.id}`,
				tag: `chat-${conversation.id}`,
			};
			const options = { urgency: "high" as const, topic: `chat${conversation.id}` };
			PushService.send(
				recipients.filter((id) => prefs.get(id)?.push_preview !== false),
				{ ...base, body: withPreview },
				options,
			);
			PushService.send(
				recipients.filter((id) => prefs.get(id)?.push_preview === false),
				{ ...base, body: withoutPreview },
				options,
			);
		} catch (error) {
			Logger.error("Web Push for a chat message failed:", error);
		}
	}
}
