import { ConversationAccess } from "../api/utils/conversations";
import type { DB } from "../db";
import { OrgContext } from "../orgs/context";
import { Logger } from "../utils/logger";
import { RealtimeHub } from "./hub";
import type { RealtimeProtocol } from "./protocol";

/**
 * What the API tells the realtime channel. Called from request handlers (inside the org's
 * context) after a change is stored. Fire-and-forget: it never fails a request, and does nothing
 * while nobody of the org is connected.
 */
export namespace Realtime {
	function currentOrgId() {
		const orgId = OrgContext.maybeCurrent()?.id;
		return orgId !== undefined && RealtimeHub.hasConnections(orgId) ? orgId : null;
	}

	/**
	 * Tell everyone in a chat that it changed. `alsoUserIds`: people who just left it (so their
	 * list drops it).
	 */
	export function conversationChanged(
		conversation: DB.Models.Conversation,
		reason: RealtimeProtocol.ConversationReason,
		options: { alsoUserIds?: number[] } = {},
	) {
		const orgId = currentOrgId();
		if (orgId === null) return;
		try {
			const members = ConversationAccess.getMembers(conversation).map((member) => member.user_id);
			RealtimeHub.sendToUsers(orgId, [...members, ...(options.alsoUserIds ?? [])], {
				type: "conversation",
				conversation_id: conversation.id,
				reason,
			});
		} catch (error) {
			Logger.error("Realtime: failed to announce a chat change:", error);
		}
	}

	/** Tell these people only (their own settings of a chat changed). */
	export function conversationChangedFor(
		userIds: number[],
		conversationId: number,
		reason: RealtimeProtocol.ConversationReason,
	) {
		const orgId = currentOrgId();
		if (orgId === null) return;
		RealtimeHub.sendToUsers(orgId, userIds, {
			type: "conversation",
			conversation_id: conversationId,
			reason,
		});
	}

	/** These people have new notifications. */
	export function notificationsChanged(userIds: Iterable<number>) {
		const orgId = currentOrgId();
		if (orgId === null) return;
		RealtimeHub.sendToUsers(orgId, userIds, { type: "notification" });
	}
}
