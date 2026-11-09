import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { EVENT_MEMBER_ROLES, EVENT_STATUSES, EVENT_TYPES } from "../../../../../../db/schema";
import {
	UserAccountSettings,
	UserDataPolicies,
} from "../../../../../utils/shared-models/accountData";

/** Columns only the server writes — never accepted from a request body. */
const SERVER_MANAGED = {
	id: true,
	org_id: true,
	password_hash: true,
	created_at: true,
	suspended_at: true,
	suspended_reason: true,
	last_login_at: true,
} as const;

export namespace AdminUsersModel {
	const BaseUser = createSelectSchema(DB.Tables.users);

	export const SafeUser = BaseUser.omit({ org_id: true, password_hash: true });
	export type SafeUser = z.infer<typeof SafeUser>;

	/** A one-time `/auth/reset-password?token=…` link; the token is only ever shown once. */
	export const PasswordLink = z.object({
		url: z.string(),
		expires_at: z.number(),
	});
	export type PasswordLink = z.infer<typeof PasswordLink>;

	export const Detail = SafeUser.extend({
		events: z.array(
			z.object({
				id: z.number(),
				name: z.string(),
				type: z.enum(EVENT_TYPES),
				status: z.enum(EVENT_STATUSES),
				start_date: z.string(),
				end_date: z.string(),
				role: z.enum(EVENT_MEMBER_ROLES),
				position: z.string().nullable(),
			}),
		),
		active_sessions: z.number(),
		api_keys: z.number(),
		/** An unexpired password link exists (forgot-password or admin-issued). */
		password_link_expires_at: z.number().nullable(),
	});
	export type Detail = z.infer<typeof Detail>;
}

export namespace AdminUsersModel.GetAll {
	export const Query = z.object({
		role: UserAccountSettings.Role.optional(),
		status: z.enum(["active", "suspended"]).optional(),
		search: z.string().min(1).max(64).optional(),
		limit: z.coerce.number().int().min(1).max(100).optional(),
		offset: z.coerce.number().int().min(0).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(SafeUser);
	export type Response = z.infer<typeof Response>;
}

export namespace AdminUsersModel.Create {
	const InsertSchema = createInsertSchema(DB.Tables.users, {
		username: UserDataPolicies.Username,
		display_name: z.string().trim().min(1).max(64),
		email: z.email(),
		// A refinement replaces the column's optionality — keep it optional explicitly.
		phone: z.string().trim().max(40).nullish(),
	}).omit(SERVER_MANAGED);

	/**
	 * Without `password` the account gets no usable password; the response then carries a
	 * one-time link (valid 7 days) for the new person to choose one.
	 */
	export const Body = InsertSchema.extend({
		password: UserDataPolicies.Password.optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		user: SafeUser,
		password_link: PasswordLink.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace AdminUsersModel.Update {
	// Same field rules as the account route: admins cannot store an invalid username or email.
	export const Body = createUpdateSchema(DB.Tables.users, {
		username: UserDataPolicies.Username,
		display_name: z.string().trim().min(1).max(64),
		email: z.email("Invalid email"),
		phone: z.string().trim().max(40).nullable(),
	})
		.omit(SERVER_MANAGED)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;
}

export namespace AdminUsersModel.UpdatePassword {
	export const Body = z.object({
		password: UserDataPolicies.Password,
	});
	export type Body = z.infer<typeof Body>;
}

export namespace AdminUsersModel.RevokeSessions {
	export const Response = z.object({ revoked: z.number() });
	export type Response = z.infer<typeof Response>;
}

export namespace AdminUsersModel.Suspend {
	export const Body = z.object({
		reason: z.string().trim().max(500).optional(),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace AdminUsersModel.UserId {
	export const Params = z.object({
		userId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}
