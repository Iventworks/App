import { z } from "zod";
import { AuditLogModel } from "../../../../../utils/shared-models/auditLog";

export namespace AdminAuditLogModel.GetAll {
	export const Query = AuditLogModel.Filters.extend({
		event_id: z.coerce.number().int().positive().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = AuditLogModel.Page;
	export type Response = AuditLogModel.Page;
}
