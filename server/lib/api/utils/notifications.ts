import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
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
						user_id,
						type: notification.type,
						title: notification.title,
						body: notification.body ?? "",
						link: notification.link ?? null,
					})),
				)
				.run();
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
		| "event_added"
		| "announcement"
		| "expense_reviewed"
		| "expense_submitted"
		| "system";

	export interface Payload {
		type: Type;
		title: string;
		body?: string;
		/** In-app path, e.g. `/events/3/tasks`. */
		link?: string;
	}
}
