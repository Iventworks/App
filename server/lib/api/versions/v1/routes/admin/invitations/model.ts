import { z } from "zod";
import { UserAccountSettings } from "../../../../../utils/shared-models/accountData";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace AdminInvitationsModel {
	export const Status = z.enum(["pending", "accepted", "expired"]);
	export type Status = z.infer<typeof Status>;

	export const Invitation = z.object({
		id: z.number(),
		email: z.string(),
		display_name: z.string().nullable(),
		role: UserAccountSettings.Role,
		status: Status,
		created_at: z.number(),
		expires_at: z.number(),
		accepted_at: z.number().nullable(),
		invited_by: UserSummary.Schema.nullable(),
		accepted_user: UserSummary.Schema.nullable(),
	});
	export type Invitation = z.infer<typeof Invitation>;

	/** Returned on create/resend: the link is only ever shown once. */
	export const IssuedInvitation = z.object({
		invitation: Invitation,
		/** `<APP_URL>/auth/accept-invite?token=…` — share it if no email was sent. */
		invite_url: z.string(),
		email_sent: z.boolean(),
	});
	export type IssuedInvitation = z.infer<typeof IssuedInvitation>;

	export const ExpiresInDays = z.number().int().min(1).max(30);
	export type ExpiresInDays = z.infer<typeof ExpiresInDays>;

	export const Params = z.object({
		invitationId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace AdminInvitationsModel.GetAll {
	export const Response = z.array(AdminInvitationsModel.Invitation);
	export type Response = z.infer<typeof Response>;
}

export namespace AdminInvitationsModel.Create {
	export const Body = z.object({
		email: z.email(),
		display_name: z.string().trim().min(1).max(64).optional(),
		role: UserAccountSettings.Role.default("volunteer"),
		expires_in_days: AdminInvitationsModel.ExpiresInDays.default(7),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = AdminInvitationsModel.IssuedInvitation;
	export type Response = z.infer<typeof Response>;
}

export namespace AdminInvitationsModel.Resend {
	export const Response = AdminInvitationsModel.IssuedInvitation;
	export type Response = z.infer<typeof Response>;
}
