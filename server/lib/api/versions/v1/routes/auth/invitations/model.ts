import { z } from "zod";
import {
	UserAccountSettings,
	UserDataPolicies,
} from "../../../../../utils/shared-models/accountData";
import { AuthModel } from "../model";

export namespace AuthInvitationsModel.Inspect {
	export const Body = z.object({
		token: z.string().min(1).max(256).describe("The invitation token from the invite link"),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		email: z.string(),
		display_name: z.string().nullable(),
		role: UserAccountSettings.Role,
		expires_at: z.number(),
		/**
		 * The org's username schema (e.g. `{FIRSTNAME}.{LASTNAME}`): the username is built from
		 * `first_name` and `last_name`. Null: the invitee picks a `username`.
		 */
		username_schema: z.string().nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace AuthInvitationsModel.Accept {
	export const Body = z.object({
		token: z.string().min(1).max(256).describe("The invitation token from the invite link"),
		/** Required when the org lets people pick their username; ignored under a schema. */
		username: UserDataPolicies.Username.optional(),
		/** Required under a username schema (`username_schema` of the inspect response). */
		first_name: z.string().trim().min(1).max(64).optional(),
		last_name: z.string().trim().min(1).max(64).optional(),
		display_name: z.string().trim().min(1).max(64),
		password: UserDataPolicies.Password,
	});
	export type Body = z.infer<typeof Body>;

	/** Same shape as a login: the new account is signed in right away. */
	export const Response = AuthModel.Login.Response;
	export type Response = z.infer<typeof Response>;
}
