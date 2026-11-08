import { z } from "zod";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace AdminAuditLogModel {
	export const Entry = z.object({
		id: z.number(),
		user_id: z.number().nullable(),
		event_id: z.number().nullable(),
		action: z.string(),
		entity_type: z.string(),
		entity_id: z.number().nullable(),
		summary: z.string(),
		metadata: z.record(z.string(), z.any()).nullable(),
		created_at: z.number(),
		user: UserSummary.Schema.nullable(),
		event: z.object({ id: z.number(), name: z.string() }).nullable(),
	});
	export type Entry = z.infer<typeof Entry>;
}

export namespace AdminAuditLogModel.GetAll {
	export const Query = z.object({
		event_id: z.coerce.number().int().positive().optional(),
		user_id: z.coerce.number().int().positive().optional(),
		entity_type: z.string().min(1).max(64).optional(),
		action: z.string().min(1).max(32).optional(),
		limit: z.coerce.number().int().min(1).max(200).default(50),
		offset: z.coerce.number().int().min(0).default(0),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		total: z.number(),
		entries: z.array(AdminAuditLogModel.Entry),
	});
	export type Response = z.infer<typeof Response>;
}
