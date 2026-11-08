import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminAuditLogModel } from "./model";

export const router = new Hono().basePath("/audit-log");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get audit log",
		description:
			"The organisation-wide audit trail, newest first. Filter by event, person, action, object (type and id), text in the summary and time range.",
		tags: [DOCS_TAGS.ADMIN_API.AUDIT_LOG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Audit log retrieved successfully", AdminAuditLogModel.GetAll.Response),
		),
	}),

	zValidator("query", AdminAuditLogModel.GetAll.Query),

	async (c) => {
		const query = c.req.valid("query") as AdminAuditLogModel.GetAll.Query;

		return APIResponse.success(
			c,
			"Audit log retrieved successfully",
			(await AuditLog.list(query)) satisfies AdminAuditLogModel.GetAll.Response,
		);
	},
);
