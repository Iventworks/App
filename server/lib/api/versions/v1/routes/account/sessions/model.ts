import { z } from "zod";

export namespace AccountSessionsModel {
	export const Session = z.object({
		id: z.string(),
		created_at: z.number(),
		expires_at: z.number(),
		/** The session this request was made with. */
		is_current: z.boolean(),
	});
	export type Session = z.infer<typeof Session>;

	export const Params = z.object({
		sessionId: z.string().min(1).max(128),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace AccountSessionsModel.GetAll {
	export const Response = z.array(AccountSessionsModel.Session);
	export type Response = z.infer<typeof Response>;
}

export namespace AccountSessionsModel.RevokeOthers {
	export const Response = z.object({
		revoked: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}
