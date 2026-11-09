import { Hono } from "hono";
import { DomainService } from "../../../../../../orgs/domains";
import { OrgRegistry } from "../../../../../../orgs/registry";
import { APIResponse } from "../../../../../utils/api-res";
import { OrgModel } from "../../../../../utils/shared-models/orgData";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

/**
 * Every org's custom domains in one list, so system admins see what waits for their approval.
 * Approving and everything else per domain goes through `/system/orgs/{orgId}/domains`.
 */
export const router = new Hono().basePath("/domains");

router.get(
	"/",
	APIRouteSpec.authenticated({
		summary: "List all custom domains",
		description:
			"The custom domains of every org, newest first, with their verification and approval state.",
		tags: [DOCS_TAGS.SYSTEM.ORGS],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Domains retrieved successfully", OrgModel.SystemDomain.array()),
		),
	}),
	async (c) => {
		const domains = await DomainService.listAll();
		return APIResponse.success(
			c,
			"Domains retrieved successfully",
			domains.map(({ org_id, ...domain }) => {
				const org = OrgRegistry.get(org_id)!;
				return { ...domain, org: { id: org.id, slug: org.slug, display_name: org.display_name } };
			}) satisfies OrgModel.SystemDomain[],
		);
	},
);
