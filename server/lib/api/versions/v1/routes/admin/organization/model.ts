import { z } from "zod";
import { USERNAME_MODES } from "../../../../../../db/schema";
import { UsernameSchema } from "../../../../../../utils/usernameSchema";
import { OrgModel } from "../../../../../utils/shared-models/orgData";

export namespace AdminOrganizationModel {
	export const UsernameMode = z.enum(USERNAME_MODES);
	export type UsernameMode = z.infer<typeof UsernameMode>;

	export const UsernameSchemaValue = z
		.string()
		.trim()
		.min(1)
		.max(UsernameSchema.MAX_SCHEMA_LENGTH)
		.describe("E.g. `{FIRSTNAME}.{LASTNAME}`; see `UsernameSchema.PLACEHOLDERS`");

	/** How new accounts get their username. Not part of the public instance info. */
	export const Accounts = z.object({
		/** `schema`: built from first and last name; `free`: chosen when the account is created. */
		username_mode: UsernameMode,
		/** Kept in `free` mode too, so switching back restores it. */
		username_schema: z.string(),
	});
	export type Accounts = z.infer<typeof Accounts>;

	export const Settings = z.object({
		org: OrgModel.Org,
		/** Custom domains are only available in multi-org mode. */
		multi_org: z.boolean(),
		/** Domains go live without a system admin's approval (`IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE`). */
		domain_self_service: z.boolean(),
		accounts: Accounts,
	});
	export type Settings = z.infer<typeof Settings>;

	export namespace Update {
		export const Body = z
			.object({
				display_name: OrgModel.DisplayName.optional(),
				primary_color: OrgModel.PrimaryColor.optional(),
				file_sharing_enabled: z.boolean().optional(),
				share_default_expiry_days: z.number().int().min(1).max(3650).nullable().optional(),
				username_mode: UsernameMode.optional(),
				username_schema: UsernameSchemaValue.optional(),
			})
			.refine((body) => Object.values(body).some((value) => value !== undefined), {
				message: "Nothing to change",
			});
		export type Body = z.infer<typeof Body>;
	}
}
