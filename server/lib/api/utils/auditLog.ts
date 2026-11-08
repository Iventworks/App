import { and, count, desc, eq, gte, inArray, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { Logger } from "../../utils/logger";
import type { AuditLogModel } from "./shared-models/auditLog";
import { UserSummary } from "./shared-models/userSummary";

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
					// The column default has second precision; time filters and ordering need ms.
					created_at: Date.now(),
				})
				.run();
		} catch (error) {
			Logger.error("Failed to write audit log entry:", error);
		}
	}

	/**
	 * One page of the log, newest first. `scope` limits it to one event (the event log); the
	 * filters narrow it further. Entries come with their actor and event attached.
	 */
	static async list(
		filters: AuditLogModel.Filters & { event_id?: number },
		scope: { eventId?: number } = {},
	): Promise<AuditLogModel.Page> {
		const table = DB.Tables.auditLogs;
		const scopeCondition =
			scope.eventId !== undefined ? eq(table.event_id, scope.eventId) : undefined;

		const conditions: (SQL | undefined)[] = [scopeCondition];
		if (filters.event_id) conditions.push(eq(table.event_id, filters.event_id));
		if (filters.user_id) conditions.push(eq(table.user_id, filters.user_id));
		if (filters.action) conditions.push(eq(table.action, filters.action));
		if (filters.entity_type) conditions.push(eq(table.entity_type, filters.entity_type));
		if (filters.entity_id) conditions.push(eq(table.entity_id, filters.entity_id));
		if (filters.from !== undefined) conditions.push(gte(table.created_at, filters.from));
		if (filters.to !== undefined) conditions.push(lt(table.created_at, filters.to));
		if (filters.search) {
			// Literal match: `%` and `_` typed by the user are not wildcards.
			const escaped = filters.search.replace(/[\\%_]/g, (char) => `\\${char}`);
			conditions.push(sql`${table.summary} LIKE ${`%${escaped}%`} ESCAPE '\\'`);
		}
		const where = and(...conditions);

		const [rows, total, actorRows] = await Promise.all([
			DB.instance()
				.select()
				.from(table)
				.where(where)
				.orderBy(desc(table.created_at), desc(table.id))
				.limit(filters.limit)
				.offset(filters.offset)
				.all(),
			DB.instance().select({ value: count() }).from(table).where(where).get(),
			DB.instance()
				.selectDistinct({ id: table.user_id })
				.from(table)
				.where(and(scopeCondition, isNotNull(table.user_id)))
				.all(),
		]);

		const users = await UserSummary.fetchMap([
			...rows.map((row) => row.user_id),
			...actorRows.map((row) => row.id),
		]);

		const eventIds = [
			...new Set(rows.map((row) => row.event_id).filter((id): id is number => id !== null)),
		];
		const events = eventIds.length
			? await DB.instance()
					.select({ id: DB.Tables.events.id, name: DB.Tables.events.name })
					.from(DB.Tables.events)
					.where(inArray(DB.Tables.events.id, eventIds))
					.all()
			: [];

		return {
			total: total?.value ?? 0,
			entries: rows.map((row) => ({
				...row,
				action: row.action as AuditLogModel.Action,
				metadata: row.metadata ?? null,
				user: row.user_id ? (users.get(row.user_id) ?? null) : null,
				event: events.find((event) => event.id === row.event_id) ?? null,
			})),
			actors: actorRows
				.map((row) => (row.id ? users.get(row.id) : undefined))
				.filter((user): user is UserSummary.Schema => Boolean(user))
				.sort((a, b) => a.display_name.localeCompare(b.display_name, "de")),
		};
	}
}

export namespace AuditLog {
	export type Action = AuditLogModel.Action;

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
