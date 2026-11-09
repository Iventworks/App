import { z } from "zod";
import { OrgModel } from "../../../../../utils/shared-models/orgData";

export namespace AdminOrganizationModel {
	export const Settings = z.object({
		org: OrgModel.Org,
		/** Custom domains are only available in multi-org mode. */
		multi_org: z.boolean(),
		/** Domains go live without a system admin's approval (`IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE`). */
		domain_self_service: z.boolean(),
	});
	export type Settings = z.infer<typeof Settings>;

	export namespace Update {
		export const Body = z
			.object({
				display_name: OrgModel.DisplayName.optional(),
				primary_color: OrgModel.PrimaryColor.optional(),
				file_sharing_enabled: z.boolean().optional(),
				share_default_expiry_days: z.number().int().min(1).max(3650).nullable().optional(),
			})
			.refine((body) => Object.values(body).some((value) => value !== undefined), {
				message: "Nothing to change",
			});
		export type Body = z.infer<typeof Body>;
	}
}
