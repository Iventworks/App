import { z } from "zod";
import { UserSummary } from "./userSummary";

/** Request and response shapes shared by the admin and the event audit log routes. */
export namespace AuditLogModel {
	export const Actions = [
		"create",
		"update",
		"delete",
		"assign",
		"unassign",
		"review",
		"invite",
		"login",
		"suspend",
		"unsuspend",
		"revoke",
		"password_link",
	] as const;
	export const Action = z.enum(Actions);
	export type Action = z.infer<typeof Action>;

	/** Filters both routes accept. `from`/`to` are unix ms (`from` inclusive, `to` exclusive). */
	export const Filters = z.object({
		user_id: z.coerce.number().int().positive().optional(),
		action: Action.optional(),
		entity_type: z.string().min(1).max(64).optional(),
		entity_id: z.coerce.number().int().positive().optional(),
		search: z.string().trim().min(1).max(100).optional(),
		from: z.coerce.number().int().nonnegative().optional(),
		to: z.coerce.number().int().nonnegative().optional(),
		limit: z.coerce.number().int().min(1).max(200).default(50),
		offset: z.coerce.number().int().min(0).default(0),
	});
	export type Filters = z.infer<typeof Filters>;

	export const Entry = z.object({
		id: z.number(),
		user_id: z.number().nullable(),
		event_id: z.number().nullable(),
		action: Action,
		entity_type: z.string(),
		entity_id: z.number().nullable(),
		summary: z.string(),
		metadata: z.record(z.string(), z.any()).nullable(),
		created_at: z.number(),
		user: UserSummary.Schema.nullable(),
		event: z.object({ id: z.number(), name: z.string() }).nullable(),
	});
	export type Entry = z.infer<typeof Entry>;

	export const Page = z.object({
		total: z.number(),
		entries: z.array(Entry),
		/** Everyone with at least one entry in this log (ignores the filters) — for the person filter. */
		actors: z.array(UserSummary.Schema),
	});
	export type Page = z.infer<typeof Page>;
}
