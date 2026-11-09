import { z } from "zod";
import { OrgModel } from "../../../../../utils/shared-models/orgData";

export namespace SystemOrgsModel {
	export const Params = z.object({
		orgId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Entry = OrgModel.Org.extend({
		user_count: z.number(),
		event_count: z.number(),
		domain_count: z.number(),
		created_at: z.number(),
	});
	export type Entry = z.infer<typeof Entry>;

	export const IssuedInvitation = z.object({
		email: z.string(),
		/** `<org url>/auth/accept-invite?token=…` — hand it over if no email was sent. */
		invite_url: z.string(),
		email_sent: z.boolean(),
		expires_at: z.number(),
	});
	export type IssuedInvitation = z.infer<typeof IssuedInvitation>;

	export namespace GetAll {
		export const Response = z.array(Entry);
		export type Response = z.infer<typeof Response>;
	}

	export namespace Create {
		export const Body = z.object({
			/** Lower-case DNS label for `<slug>.<base host>`; can't be changed later. */
			slug: z.string().trim().toLowerCase().min(2).max(40),
			display_name: OrgModel.DisplayName,
			primary_color: OrgModel.PrimaryColor.optional(),
			/** Invite the org's first admin (optional — can be done later). */
			admin_email: z.email().max(254).optional(),
			admin_display_name: z.string().trim().min(1).max(100).optional(),
		});
		export type Body = z.infer<typeof Body>;

		export const Response = z.object({
			org: Entry,
			invitation: IssuedInvitation.nullable(),
		});
		export type Response = z.infer<typeof Response>;
	}

	export namespace Update {
		export const Body = z
			.object({
				display_name: OrgModel.DisplayName.optional(),
				primary_color: OrgModel.PrimaryColor.optional(),
			})
			.refine((body) => body.display_name !== undefined || body.primary_color !== undefined, {
				message: "Nothing to change",
			});
		export type Body = z.infer<typeof Body>;
	}

	export namespace Invite {
		export const Body = z.object({
			email: z.email().max(254),
			display_name: z.string().trim().min(1).max(100).optional(),
		});
		export type Body = z.infer<typeof Body>;
	}
}
