import { and, gt, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { type OrgInfo, OrgRegistry } from "../../../../../../orgs/registry";
import { OrgService, OrgServiceError } from "../../../../../../orgs/service";
import { AppConstants } from "../../../../../../utils/constants";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EmailService } from "../../../../../utils/email";
import { getAuthUserId } from "../../../../../utils/guards";
import { createOrgDomainRouter } from "../../../../../utils/orgDomainRoutes";
import { OrgModel } from "../../../../../utils/shared-models/orgData";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { createInvitationToken, getInviteURL, hashInvitationToken } from "../../auth/invitations";
import { SystemOrgsModel } from "./model";

type SystemOrgsEnv = {
	Variables: { targetOrg: OrgInfo; systemOrg: OrgInfo };
};

const TAG = DOCS_TAGS.SYSTEM.ORGS;
const INVITATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const router = new Hono<SystemOrgsEnv>().basePath("/orgs");

/** Audit entries of the system admins go to the system org's log. */
async function audit(
	c: Context,
	systemOrg: OrgInfo,
	entry: Omit<Parameters<typeof AuditLog.record>[0], "userId">,
) {
	await OrgContext.run(systemOrg, () => AuditLog.record({ userId: getAuthUserId(c), ...entry }));
}

async function entry(org: OrgInfo): Promise<SystemOrgsModel.Entry> {
	const stats = (await OrgService.list()).find((item) => item.org.id === org.id);
	return {
		...OrgModel.from(org, { absolute: true }),
		user_count: stats?.user_count ?? 0,
		event_count: stats?.event_count ?? 0,
		domain_count: stats?.domain_count ?? 0,
		created_at: stats?.created_at ?? 0,
	};
}

function serviceError(c: Context, error: unknown) {
	if (!(error instanceof OrgServiceError)) throw error;
	switch (error.code) {
		case "not_found":
			return APIResponse.notFound(c, error.message);
		case "slug_taken":
			return APIResponse.conflict(c, error.message);
		default:
			return APIResponse.badRequest(c, error.message);
	}
}

/**
 * Invite an admin into the current (target) org. `invited_by` stays empty: the system admin is
 * not a member of that org. Returns null when the address is already a user or invited.
 */
async function inviteAdmin(
	email: string,
	displayName: string | null,
): Promise<SystemOrgsModel.IssuedInvitation | "user_exists" | "pending"> {
	const emailLower = email.trim().toLowerCase();

	const existingUser = await DB.instance()
		.select({ id: DB.Tables.users.id })
		.from(DB.Tables.users)
		.where(and(inOrg(DB.Tables.users), sql`lower(${DB.Tables.users.email}) = ${emailLower}`))
		.get();
	if (existingUser) return "user_exists";

	const pending = await DB.instance()
		.select({ id: DB.Tables.invitations.id })
		.from(DB.Tables.invitations)
		.where(
			and(
				inOrg(DB.Tables.invitations),
				sql`lower(${DB.Tables.invitations.email}) = ${emailLower}`,
				isNull(DB.Tables.invitations.accepted_at),
				gt(DB.Tables.invitations.expires_at, Date.now()),
			),
		)
		.get();
	if (pending) return "pending";

	const token = createInvitationToken();
	const expiresAt = Date.now() + INVITATION_DAYS * DAY_MS;
	await DB.instance()
		.insert(DB.Tables.invitations)
		.values({
			org_id: OrgContext.id(),
			token_hash: hashInvitationToken(token),
			email: email.trim(),
			display_name: displayName,
			role: "admin",
			invited_by: null,
			expires_at: expiresAt,
		})
		.run();

	const inviteUrl = getInviteURL(token);
	const emailSent = EmailService.isEnabled()
		? await EmailService.sendInvitationEmail(email.trim(), inviteUrl, expiresAt, {
				displayName,
				inviterName: `${AppConstants.APP_NAME}-Systemverwaltung`,
			})
		: false;

	return {
		email: email.trim(),
		invite_url: inviteUrl,
		email_sent: emailSent,
		expires_at: expiresAt,
	};
}

router.get(
	"/",
	APIRouteSpec.authenticated({
		summary: "List organisations",
		description: "Every org with its domains, user and event counts.",
		tags: [TAG],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Organisations retrieved successfully", SystemOrgsModel.GetAll.Response),
		),
	}),
	async (c) => {
		const list = await OrgService.list();
		return APIResponse.success(
			c,
			"Organisations retrieved successfully",
			list.map((item) => ({
				...OrgModel.from(item.org, { absolute: true }),
				user_count: item.user_count,
				event_count: item.event_count,
				domain_count: item.domain_count,
				created_at: item.created_at,
			})) satisfies SystemOrgsModel.GetAll.Response,
		);
	},
);

router.post(
	"/",
	APIRouteSpec.authenticated({
		summary: "Create organisation",
		description:
			"Create an org at `<slug>.<base host>` (the slug never changes) and optionally invite its first admin. The invite link is returned once.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Organisation created successfully", SystemOrgsModel.Create.Response),
			APIResponseSpec.conflict("The slug is already taken"),
		),
	}),
	zValidator("json", SystemOrgsModel.Create.Body),
	async (c) => {
		const body = c.req.valid("json") as SystemOrgsModel.Create.Body;
		const systemOrg = OrgContext.current();

		let org: OrgInfo;
		try {
			org = await OrgService.create(body);
		} catch (error) {
			return serviceError(c, error);
		}

		let invitation: SystemOrgsModel.IssuedInvitation | null = null;
		if (body.admin_email) {
			const result = await OrgContext.run(org, () =>
				inviteAdmin(body.admin_email!, body.admin_display_name ?? null),
			);
			invitation = typeof result === "string" ? null : result;
		}

		await audit(c, systemOrg, {
			action: "create",
			entityType: "org",
			entityId: org.id,
			summary: `Organisation „${org.display_name}“ (${org.slug}) angelegt${invitation ? `, ${invitation.email} als Admin eingeladen` : ""}`,
		});

		return APIResponse.created(c, "Organisation created successfully", {
			org: await entry(org),
			invitation,
		} satisfies SystemOrgsModel.Create.Response);
	},
);

// Everything below works on one org: check it, keep the system org for the audit log, and run
// the rest of the request inside the target org's context. (`/:orgId/*` also matches `/:orgId`.)
router.use("/:orgId/*", async (c, next) => {
	const parsed = SystemOrgsModel.Params.safeParse(c.req.param());
	const target = parsed.success ? OrgRegistry.get(parsed.data.orgId) : null;
	if (!target || target.kind !== "org") return APIResponse.notFound(c, "Organisation not found");

	c.set("systemOrg", OrgContext.current());
	c.set("targetOrg", target);
	return OrgContext.run(target, () => next());
});

router.get(
	"/:orgId",
	APIRouteSpec.authenticated({
		summary: "Get organisation",
		description: "One org with its counts.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Organisation retrieved successfully", SystemOrgsModel.Entry),
			APIResponseSpec.notFound("Organisation not found"),
		),
	}),
	zValidator("param", SystemOrgsModel.Params),
	async (c) => {
		return APIResponse.success(
			c,
			"Organisation retrieved successfully",
			await entry(c.get("targetOrg")),
		);
	},
);

router.put(
	"/:orgId",
	APIRouteSpec.authenticated({
		summary: "Update organisation",
		description: "Change the display name and/or the primary colour (the slug never changes).",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Organisation updated successfully", SystemOrgsModel.Entry),
			APIResponseSpec.notFound("Organisation not found"),
		),
	}),
	zValidator("param", SystemOrgsModel.Params),
	zValidator("json", SystemOrgsModel.Update.Body),
	async (c) => {
		const body = c.req.valid("json") as SystemOrgsModel.Update.Body;
		const before = c.get("targetOrg");
		const org = await OrgService.update(before.id, body);

		await audit(c, c.get("systemOrg"), {
			action: "update",
			entityType: "org",
			entityId: org.id,
			summary: `Organisation „${org.display_name}“ (${org.slug}) geändert`,
		});
		return APIResponse.success(c, "Organisation updated successfully", await entry(org));
	},
);

router.delete(
	"/:orgId",
	APIRouteSpec.authenticated({
		summary: "Delete organisation",
		description: "Delete the org with all its users, events, files and domains. Can't be undone.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Organisation deleted successfully"),
			APIResponseSpec.notFound("Organisation not found"),
		),
	}),
	zValidator("param", SystemOrgsModel.Params),
	async (c) => {
		const org = c.get("targetOrg");
		try {
			await OrgService.delete(org.id);
		} catch (error) {
			return serviceError(c, error);
		}
		await audit(c, c.get("systemOrg"), {
			action: "delete",
			entityType: "org",
			entityId: org.id,
			summary: `Organisation „${org.display_name}“ (${org.slug}) gelöscht`,
		});
		return APIResponse.successNoData(c, "Organisation deleted successfully");
	},
);

router.post(
	"/:orgId/invitations",
	APIRouteSpec.authenticated({
		summary: "Invite organisation admin",
		description:
			"Invite an admin into the org (e.g. when its admins lost access). The invite link is returned once.",
		tags: [TAG],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Invitation created successfully", SystemOrgsModel.IssuedInvitation),
			APIResponseSpec.notFound("Organisation not found"),
			APIResponseSpec.conflict(
				"A user with this email already exists / A pending invitation for this email already exists",
			),
		),
	}),
	zValidator("param", SystemOrgsModel.Params),
	zValidator("json", SystemOrgsModel.Invite.Body),
	async (c) => {
		const body = c.req.valid("json") as SystemOrgsModel.Invite.Body;
		const org = c.get("targetOrg");
		const result = await inviteAdmin(body.email, body.display_name ?? null);
		if (result === "user_exists") {
			return APIResponse.conflict(c, "A user with this email already exists");
		}
		if (result === "pending") {
			return APIResponse.conflict(c, "A pending invitation for this email already exists");
		}

		await audit(c, c.get("systemOrg"), {
			action: "invite",
			entityType: "org",
			entityId: org.id,
			summary: `${result.email} als Admin von „${org.display_name}“ eingeladen`,
		});
		return APIResponse.created(c, "Invitation created successfully", result);
	},
);

router.route(
	"/:orgId",
	createOrgDomainRouter({
		tag: TAG,
		parentParams: SystemOrgsModel.Params,
		// A system admin adds a domain after setting up the reverse proxy for it.
		approves: () => true,
		approvals: true,
		onChange: async (c, change) => {
			const target = (c as Context<SystemOrgsEnv>).get("targetOrg");
			await audit(c, (c as Context<SystemOrgsEnv>).get("systemOrg"), {
				action: change.action,
				entityType: "org",
				entityId: target.id,
				summary: `${target.display_name}: ${change.summary}`,
			});
		},
	}),
);
