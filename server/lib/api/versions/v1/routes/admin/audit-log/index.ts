import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminAuditLogModel } from "./model";

export const router = new Hono().basePath("/audit-log");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get audit log",
		description:
			"The organisation-wide audit trail, newest first, filterable by event, user, entity type and action.",
		tags: [DOCS_TAGS.ADMIN_API.AUDIT_LOG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Audit log retrieved successfully", AdminAuditLogModel.GetAll.Response),
		),
	}),

	zValidator("query", AdminAuditLogModel.GetAll.Query),

	async (c) => {
		const query = c.req.valid("query") as AdminAuditLogModel.GetAll.Query;
		const table = DB.Tables.auditLogs;

		const conditions: SQL[] = [];
		if (query.event_id) conditions.push(eq(table.event_id, query.event_id));
		if (query.user_id) conditions.push(eq(table.user_id, query.user_id));
		if (query.entity_type) conditions.push(eq(table.entity_type, query.entity_type));
		if (query.action) conditions.push(eq(table.action, query.action));
		const where = conditions.length ? and(...conditions) : undefined;

		const total =
			(await DB.instance().select({ value: count() }).from(table).where(where).get())?.value ?? 0;

		const rows = await DB.instance()
			.select()
			.from(table)
			.where(where)
			.orderBy(desc(table.created_at), desc(table.id))
			.limit(query.limit)
			.offset(query.offset)
			.all();

		const users = await UserSummary.fetchMap(rows.map((row) => row.user_id));
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

		return APIResponse.success(c, "Audit log retrieved successfully", {
			total,
			entries: rows.map((row) => ({
				...row,
				metadata: row.metadata ?? null,
				user: row.user_id ? (users.get(row.user_id) ?? null) : null,
				event: events.find((event) => event.id === row.event_id) ?? null,
			})),
		} satisfies AdminAuditLogModel.GetAll.Response);
	},
);
