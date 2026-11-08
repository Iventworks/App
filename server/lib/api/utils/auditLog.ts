import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { Logger } from "../../utils/logger";

/**
 * Append-only audit trail. Event-scoped entries (`eventId`) are shown to that event's leaders,
 * everything to admins. Never let a failed audit write break the request.
 */
export class AuditLog {
	static async record(entry: AuditLog.Entry, tx: DrizzleDB = DB.instance()) {
		try {
			await tx
				.insert(DB.Tables.auditLogs)
				.values({
					user_id: entry.userId,
					event_id: entry.eventId ?? null,
					action: entry.action,
					entity_type: entry.entityType,
					entity_id: entry.entityId ?? null,
					summary: entry.summary,
					metadata: entry.metadata ?? null,
				})
				.run();
		} catch (error) {
			Logger.error("Failed to write audit log entry:", error);
		}
	}
}

export namespace AuditLog {
	export type Action =
		| "create"
		| "update"
		| "delete"
		| "assign"
		| "unassign"
		| "review"
		| "login"
		| "invite";

	export interface Entry {
		userId: number | null;
		eventId?: number | null;
		action: Action;
		/** e.g. "event", "participant", "expense", "user". */
		entityType: string;
		entityId?: number | null;
		/** Human-readable, German UI text, e.g. `Teilnehmer „Max Muster“ angelegt`. */
		summary: string;
		metadata?: Record<string, any>;
	}
}
