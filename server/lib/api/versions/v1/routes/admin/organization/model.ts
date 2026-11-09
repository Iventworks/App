import { z } from "zod";
import { OrgModel } from "../../../../../utils/shared-models/orgData";

export namespace AdminOrganizationModel {
	export const Settings = z.object({
		org: OrgModel.Org,
		/** Custom domains are only available in multi-org mode. */
		multi_org: z.boolean(),
	});
	export type Settings = z.infer<typeof Settings>;

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
}
