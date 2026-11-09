import { createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../db";
import { UserDataPolicies } from "../../../../utils/shared-models/accountData";

export namespace AccountModel.GetInfo {
	export const Response = createSelectSchema(DB.Tables.users).omit({
		org_id: true,
		password_hash: true,
	});
	export type Response = z.infer<typeof Response>;
}

export namespace AccountModel.UpdateInfo {
	export const Body = createUpdateSchema(DB.Tables.users, {
		username: UserDataPolicies.Username,
		display_name: z.string().trim().min(1).max(64),
		email: z.email("Invalid email"),
		phone: z.string().trim().max(40).nullable(),
	})
		// Only the profile fields: never the org, role, suspension or login bookkeeping.
		.pick({
			username: true,
			display_name: true,
			email: true,
			phone: true,
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		})
		.and(
			z.object({
				current_password: z
					.string()
					.min(1)
					.describe("Current password — required to confirm account changes"),
			}),
		);

	export type Body = z.infer<typeof Body>;
}

export namespace AccountModel.UpdatePassword {
	export const Body = z.object({
		current_password: z.string().describe("Current password of the account"),
		new_password: UserDataPolicies.Password,
	});

	export type Body = z.infer<typeof Body>;
}
