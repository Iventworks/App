import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { BrandingError, OrgBranding } from "../../../../../../orgs/branding";
import { OrgContext } from "../../../../../../orgs/context";
import { DomainService } from "../../../../../../orgs/domains";
import { OrgRegistry } from "../../../../../../orgs/registry";
import { OrgService } from "../../../../../../orgs/service";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { getAuthUserId } from "../../../../../utils/guards";
import { createOrgDomainRouter } from "../../../../../utils/orgDomainRoutes";
import { OrgModel } from "../../../../../utils/shared-models/orgData";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminOrganizationModel } from "./model";

/**
 * The org's own settings for its admins: name, colour, logo and icon, and (multi-org mode) custom
 * domains. The slug — the name in the default domain — never changes.
 */
export const router = new Hono().basePath("/organization");

const TAG = DOCS_TAGS.ADMIN_API.ORGANIZATION;
const ASSET_LABELS = { logo: "Logo", icon: "Icon" } as const;

function settings(): AdminOrganizationModel.Settings {
	const org = OrgContext.current();
	return {
		org: OrgModel.from(org),
		multi_org: OrgRegistry.isMultiOrg(),
		domain_self_service: DomainService.selfService(),
	};
}

router.get(
	"/",
	APIRouteSpec.authenticated({
		summary: "Get organisation settings",
		description: "Name, colour, logo, icon and domains of your organisation.",
		tags: [TAG],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Organisation retrieved successfully", AdminOrganizationModel.Settings),
		),
	}),
	(c) => APIResponse.success(c, "Organisation retrieved successfully", settings()),
);

router.put(
	"/",
	APIRouteSpec.authenticated({
		summary: "Update organisation",
		description: "Change the display name, the primary colour and the share-link settings.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Organisation updated successfully", AdminOrganizationModel.Settings),
		),
	}),
	zValidator("json", AdminOrganizationModel.Update.Body),
	async (c) => {
		const body = c.req.valid("json") as AdminOrganizationModel.Update.Body;
		const before = OrgContext.current();
		const org = await OrgService.update(before.id, body);

		const changes: string[] = [];
		if (body.display_name !== undefined && body.display_name !== before.display_name) {
			changes.push(`Name „${before.display_name}“ → „${org.display_name}“`);
		}
		if (body.primary_color !== undefined && body.primary_color !== before.primary_color) {
			changes.push(`Farbe ${before.primary_color} → ${org.primary_color}`);
		}
		if (
			body.file_sharing_enabled !== undefined &&
			body.file_sharing_enabled !== before.file_sharing_enabled
		) {
			changes.push(org.file_sharing_enabled ? "Freigabelinks erlaubt" : "Freigabelinks abgeschaltet");
		}
		if (
			body.share_default_expiry_days !== undefined &&
			body.share_default_expiry_days !== before.share_default_expiry_days
		) {
			changes.push(
				org.share_default_expiry_days
					? `Freigabelinks laufen standardmäßig nach ${org.share_default_expiry_days} Tagen ab`
					: "Freigabelinks ohne Standard-Ablauf",
			);
		}
		if (changes.length) {
			await AuditLog.record({
				userId: getAuthUserId(c),
				action: "update",
				entityType: "organization",
				entityId: org.id,
				summary: `Organisation geändert: ${changes.join(", ")}`,
			});
		}

		// The registry holds the new values; this request's context still has the old ones.
		return OrgContext.run(org, () =>
			APIResponse.success(c, "Organisation updated successfully", settings()),
		);
	},
);

router.put(
	"/assets/:kind",
	APIRouteSpec.authenticated({
		summary: "Upload logo or icon",
		description:
			"multipart/form-data field `file`. Logo: SVG, PNG, WebP or JPEG. Icon (favicon, app icon): SVG or square PNG ≥ 192 px. At most 512 KB; SVGs must not contain scripts or external references.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Image saved successfully", AdminOrganizationModel.Settings),
		),
	}),
	zValidator("param", OrgModel.AssetParams),
	zValidator("form", OrgModel.AssetForm, undefined, { media: "multipart/form-data" }),
	async (c) => {
		const { kind } = c.req.valid("param") as OrgModel.AssetParams;
		const { file } = c.req.valid("form") as OrgModel.AssetForm;

		try {
			await OrgBranding.set(kind, new Uint8Array(await file.arrayBuffer()));
		} catch (error) {
			if (error instanceof BrandingError) return APIResponse.badRequest(c, error.message);
			throw error;
		}

		const org = OrgContext.current();
		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "organization",
			entityId: org.id,
			summary: `${ASSET_LABELS[kind]} hochgeladen`,
		});

		const updated = OrgRegistry.get(org.id) ?? org;
		return OrgContext.run(updated, () =>
			APIResponse.success(c, "Image saved successfully", settings()),
		);
	},
);

router.delete(
	"/assets/:kind",
	APIRouteSpec.authenticated({
		summary: "Remove logo or icon",
		description: "Go back to the default Iventworks image.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Image removed successfully", AdminOrganizationModel.Settings),
		),
	}),
	zValidator("param", OrgModel.AssetParams),
	async (c) => {
		const { kind } = c.req.valid("param") as OrgModel.AssetParams;
		await OrgBranding.remove(kind);

		const org = OrgContext.current();
		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "organization",
			entityId: org.id,
			summary: `${ASSET_LABELS[kind]} entfernt`,
		});

		const updated = OrgRegistry.get(org.id) ?? org;
		return OrgContext.run(updated, () =>
			APIResponse.success(c, "Image removed successfully", settings()),
		);
	},
);

// Custom domains only exist in multi-org mode.
router.use("/domains/*", async (c, next) => {
	if (!OrgRegistry.isMultiOrg()) {
		return APIResponse.notFound(c, "Custom domains are only available in multi-org mode");
	}
	await next();
});
router.use("/domains", async (c, next) => {
	if (!OrgRegistry.isMultiOrg()) {
		return APIResponse.notFound(c, "Custom domains are only available in multi-org mode");
	}
	await next();
});

router.route(
	"/",
	createOrgDomainRouter({
		tag: TAG,
		// Without self-service, a system admin approves the domain after setting up the proxy.
		approves: () => DomainService.selfService(),
		onChange: async (c, change) => {
			await AuditLog.record({
				userId: getAuthUserId(c),
				action: change.action,
				entityType: "org_domain",
				entityId: change.domain.id,
				summary: change.summary,
			});
		},
	}),
);
