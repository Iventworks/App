import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { DomainError, DomainService } from "../../orgs/domains";
import { APIResponse } from "./api-res";
import { OrgModel } from "./shared-models/orgData";
import { APIResponseSpec, APIRouteSpec } from "./specHelpers";

export interface DomainChange {
	readonly action: "create" | "update" | "delete";
	readonly domain: OrgModel.Domain;
	/** German, for the audit log. */
	readonly summary: string;
}

/** Map a {@link DomainError} to its HTTP response. */
export function domainErrorResponse(c: Context, error: unknown) {
	if (!(error instanceof DomainError)) throw error;
	switch (error.code) {
		case "not_found":
			return APIResponse.notFound(c, error.message);
		case "taken":
		case "exists":
			return APIResponse.conflict(c, error.message);
		default:
			return APIResponse.badRequest(c, error.message);
	}
}

/**
 * `/domains` routes of one org. Mounted twice: for an org's admins (`/admin/organization`, the
 * request's own org) and for system admins (`/system/orgs/{orgId}`, which run the rest of the
 * request inside the target org's context). `onChange` writes the audit entry where it belongs.
 */
export function createOrgDomainRouter(options: {
	tag: string;
	onChange: (c: Context, change: DomainChange) => Promise<void>;
	/** Path parameters of the mount point (`{ orgId }` for the system API), for the spec. */
	parentParams?: z.ZodObject<z.ZodRawShape>;
}) {
	const router = new Hono().basePath("/domains");
	const { tag, onChange, parentParams } = options;
	const listParams = parentParams ?? z.object({});
	const itemParams = parentParams
		? OrgModel.DomainParams.extend(parentParams.shape)
		: OrgModel.DomainParams;

	router.get(
		"/",
		APIRouteSpec.authenticated({
			summary: "List custom domains",
			description:
				"The org's custom domains with their verification status and the DNS records to create.",
			tags: [tag],
			responses: APIResponseSpec.describeBasic(
				APIResponseSpec.success("Domains retrieved successfully", OrgModel.Domain.array()),
			),
		}),
		zValidator("param", listParams),
		async (c) => {
			return APIResponse.success(c, "Domains retrieved successfully", await DomainService.list());
		},
	);

	router.post(
		"/",
		APIRouteSpec.authenticated({
			summary: "Add custom domain",
			description:
				"Add a domain (pending until verified). Create the returned TXT and CNAME records, then verify.",
			tags: [tag],
			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.created("Domain added successfully", OrgModel.Domain),
				APIResponseSpec.conflict("The domain is already in use"),
			),
		}),
		zValidator("param", listParams),
		zValidator("json", OrgModel.AddDomainBody),
		async (c) => {
			const body = c.req.valid("json") as OrgModel.AddDomainBody;
			try {
				const domain = await DomainService.add(body.domain);
				await onChange(c, {
					action: "create",
					domain,
					summary: `Domain ${domain.domain} hinzugefügt`,
				});
				return APIResponse.created(c, "Domain added successfully", domain);
			} catch (error) {
				return domainErrorResponse(c, error);
			}
		},
	);

	router.post(
		"/:domainId/verify",
		APIRouteSpec.authenticated({
			summary: "Verify custom domain",
			description:
				"Check the TXT and CNAME records now. The first verified domain becomes the primary domain.",
			tags: [tag],
			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.success("Domain checked", OrgModel.Domain),
				APIResponseSpec.notFound("Domain not found"),
			),
		}),
		zValidator("param", itemParams),
		async (c) => {
			const { domainId } = c.req.valid("param") as OrgModel.DomainParams;
			try {
				const before = await DomainService.get(domainId);
				const domain = await DomainService.verify(domainId);
				if (before.verified_at === null && domain.verified) {
					await onChange(c, {
						action: "update",
						domain,
						summary: `Domain ${domain.domain} verifiziert`,
					});
				}
				return APIResponse.success(c, "Domain checked", domain);
			} catch (error) {
				return domainErrorResponse(c, error);
			}
		},
	);

	router.put(
		"/:domainId",
		APIRouteSpec.authenticated({
			summary: "Set primary domain",
			description:
				"Make a verified domain the primary one (every other host of the org redirects to it), or stop redirecting to it.",
			tags: [tag],
			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.success("Domain updated", OrgModel.Domain),
				APIResponseSpec.notFound("Domain not found"),
			),
		}),
		zValidator("param", itemParams),
		zValidator("json", OrgModel.SetPrimaryBody),
		async (c) => {
			const { domainId } = c.req.valid("param") as OrgModel.DomainParams;
			const body = c.req.valid("json") as OrgModel.SetPrimaryBody;
			try {
				const domain = await DomainService.setPrimary(domainId, body.is_primary);
				await onChange(c, {
					action: "update",
					domain,
					summary: body.is_primary
						? `${domain.domain} als Hauptdomain festgelegt`
						: `${domain.domain} ist nicht mehr Hauptdomain`,
				});
				return APIResponse.success(c, "Domain updated", domain);
			} catch (error) {
				return domainErrorResponse(c, error);
			}
		},
	);

	router.delete(
		"/:domainId",
		APIRouteSpec.authenticated({
			summary: "Remove custom domain",
			description: "Stop serving the org on this domain.",
			tags: [tag],
			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.successNoData("Domain removed"),
				APIResponseSpec.notFound("Domain not found"),
			),
		}),
		zValidator("param", itemParams),
		async (c) => {
			const { domainId } = c.req.valid("param") as OrgModel.DomainParams;
			try {
				const row = await DomainService.remove(domainId);
				await onChange(c, {
					action: "delete",
					domain: DomainService.view(row),
					summary: `Domain ${row.domain} entfernt`,
				});
				return APIResponse.successNoData(c, "Domain removed");
			} catch (error) {
				return domainErrorResponse(c, error);
			}
		},
	);

	return router;
}
