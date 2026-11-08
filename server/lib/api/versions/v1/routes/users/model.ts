import { z } from "zod";
import { EVENT_MEMBER_ROLES } from "../../../../../db/schema";
import { UserSummary } from "../../../../utils/shared-models/userSummary";

export namespace UsersModel {
	export const User = UserSummary.Schema;
	export type User = z.infer<typeof User>;

	export const Params = z.object({
		userId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace UsersModel.GetAll {
	export const Query = z.object({
		search: z.string().trim().min(1).max(64).optional(),
		role: z.enum(["admin", "core_team", "volunteer"]).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(UsersModel.User);
	export type Response = z.infer<typeof Response>;
}

export namespace UsersModel.GetById {
	export const Response = UsersModel.User.extend({
		/** Events the user is staff of that the caller can see (shared events; core team: all). */
		events: z.array(
			z.object({
				id: z.number(),
				name: z.string(),
				start_date: z.string(),
				end_date: z.string(),
				role: z.enum(EVENT_MEMBER_ROLES),
			}),
		),
	});
	export type Response = z.infer<typeof Response>;
}
