import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { OrgContext } from "../../orgs/context";
import { PushTriggers } from "../../push/triggers";
import { Realtime } from "../../realtime";
import { Logger } from "../../utils/logger";

/**
 * In-app notifications (bell / slideover). Fire-and-forget: failures are logged, never thrown.
 */
export class Notifier {
	static async notify(
		userIds: Iterable<number | null | undefined>,
		notification: Notifier.Payload,
		options: { excludeUserId?: number | null } = {},
		tx: DrizzleDB = DB.instance(),
	) {
		const recipients = [...new Set(userIds)].filter(
			(id): id is number => typeof id === "number" && id !== options.excludeUserId,
		);
		if (recipients.length === 0) return;

		try {
			await tx
				.insert(DB.Tables.notifications)
				.values(
					recipients.map((user_id) => ({
						org_id: OrgContext.id(),
						user_id,
						type: notification.type,
						title: notification.title,
						body: notification.body ?? "",
						link: notification.link ?? null,
					})),
				)
				.run();
			// Badges and an open notification list update right away; people not in the app get
			// a push (if they want one).
			Realtime.notificationsChanged(recipients);
			void PushTriggers.notification(recipients, notification);
		} catch (error) {
			Logger.error("Failed to create notifications:", error);
		}
	}
}

export namespace Notifier {
	export type Type =
		| "task_assigned"
		| "program_assigned"
		| "responsibility_assigned"
		| "small_group_assigned"
		| "room_assigned"
		| "occurrence_assigned"
		| "occurrence_cancelled"
		| "event_added"
		| "announcement"
		| "expense_reviewed"
		| "expense_submitted"
		| "document_shared"
		/** To the Leitung: someone asked for material. */
		| "material_requested"
		/** To who asked: how the request was answered. */
		| "material_answered"
		/** Someone else made you bring or buy something. */
		| "material_assigned"
		| "system";

	export interface Payload {
		type: Type;
		title: string;
		body?: string;
		/** In-app path, e.g. `/events/3/tasks`. */
		link?: string;
	}
}
