import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EmailService } from "../../../../../utils/email";
import { getAuthUserId } from "../../../../../utils/guards";
import { UserAccountSettings } from "../../../../../utils/shared-models/accountData";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { createInvitationToken, getInviteURL, hashInvitationToken } from "../../auth/invitations";
import { AdminInvitationsModel } from "./model";

type InvitationsEnv = {
	Variables: { invitation: DB.Models.Invitation };
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const router = new Hono<InvitationsEnv>().basePath("/invitations");

function getStatus(invitation: DB.Models.Invitation): AdminInvitationsModel.Status {
	if (invitation.accepted_at) return "accepted";
	if (invitation.expires_at < Date.now()) return "expired";
	return "pending";
}

async function toResponse(
	invitations: DB.Models.Invitation[],
): Promise<AdminInvitationsModel.Invitation[]> {
	const users = await UserSummary.fetchMap(
		invitations.flatMap((invitation) => [invitation.invited_by, invitation.accepted_user_id]),
	);

	return invitations.map((invitation) => ({
		id: invitation.id,
		email: invitation.email,
		display_name: invitation.display_name,
		role: invitation.role,
		status: getStatus(invitation),
		created_at: invitation.created_at,
		expires_at: invitation.expires_at,
		accepted_at: invitation.accepted_at,
		invited_by: invitation.invited_by ? (users.get(invitation.invited_by) ?? null) : null,
		accepted_user: invitation.accepted_user_id
			? (users.get(invitation.accepted_user_id) ?? null)
			: null,
	}));
}

/** Send the invite email (when SMTP is configured) and build the one-time response. */
async function issue(
	c: Context,
	invitation: DB.Models.Invitation,
	token: string,
): Promise<AdminInvitationsModel.IssuedInvitation> {
	const inviteUrl = getInviteURL(token);

	let emailSent = false;
	if (EmailService.isEnabled()) {
		const inviter = await DB.instance()
			.select({ display_name: DB.Tables.users.display_name })
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, getAuthUserId(c)))
			.get();

		emailSent = await EmailService.sendInvitationEmail(
			invitation.email,
			inviteUrl,
			invitation.expires_at,
			{ displayName: invitation.display_name, inviterName: inviter?.display_name },
		);
	}

	const [response] = await toResponse([invitation]);
	return { invitation: response!, invite_url: inviteUrl, email_sent: emailSent };
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List invitations",
		description: "List all invitations (pending, accepted and expired), newest first.",
		tags: [DOCS_TAGS.ADMIN_API.INVITATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Invitations retrieved successfully",
				AdminInvitationsModel.GetAll.Response,
			),
		),
	}),

	async (c) => {
		const invitations = await DB.instance()
			.select()
			.from(DB.Tables.invitations)
			.orderBy(desc(DB.Tables.invitations.created_at), desc(DB.Tables.invitations.id))
			.all();

		return APIResponse.success(
			c,
			"Invitations retrieved successfully",
			await toResponse(invitations),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create invitation",
		description:
			"Invite a new user by email with a role. Sends the invite email when SMTP is configured and always returns the invite link once.",
		tags: [DOCS_TAGS.ADMIN_API.INVITATIONS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Invitation created successfully",
				AdminInvitationsModel.Create.Response,
			),
			APIResponseSpec.conflict(
				"A user with this email already exists / A pending invitation for this email already exists",
			),
		),
	}),

	zValidator("json", AdminInvitationsModel.Create.Body),

	async (c) => {
		const body = c.req.valid("json") as AdminInvitationsModel.Create.Body;
		const email = body.email.trim();
		const emailLower = email.toLowerCase();

		const existingUser = await DB.instance()
			.select({ id: DB.Tables.users.id })
			.from(DB.Tables.users)
			.where(sql`lower(${DB.Tables.users.email}) = ${emailLower}`)
			.get();
		if (existingUser) {
			return APIResponse.conflict(c, "A user with this email already exists");
		}

		const pending = await DB.instance()
			.select({ id: DB.Tables.invitations.id })
			.from(DB.Tables.invitations)
			.where(
				and(
					sql`lower(${DB.Tables.invitations.email}) = ${emailLower}`,
					isNull(DB.Tables.invitations.accepted_at),
					gt(DB.Tables.invitations.expires_at, Date.now()),
				),
			)
			.get();
		if (pending) {
			return APIResponse.conflict(c, "A pending invitation for this email already exists");
		}

		const token = createInvitationToken();
		const invitation = await DB.instance()
			.insert(DB.Tables.invitations)
			.values({
				token_hash: hashInvitationToken(token),
				email,
				display_name: body.display_name ?? null,
				role: body.role,
				invited_by: getAuthUserId(c),
				expires_at: Date.now() + body.expires_in_days * DAY_MS,
			})
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "invite",
			entityType: "invitation",
			entityId: invitation.id,
			summary: `${email} als „${UserAccountSettings.RoleLabels[invitation.role]}“ eingeladen`,
		});

		return APIResponse.created(
			c,
			"Invitation created successfully",
			await issue(c, invitation, token),
		);
	},
);

router.use(
	"/:invitationId/*",
	zValidator("param", AdminInvitationsModel.Params),
	async (c, next) => {
		const invitationId = AdminInvitationsModel.Params.shape.invitationId.safeParse(
			c.req.param("invitationId"),
		);
		if (!invitationId.success) return APIResponse.badRequest(c, "Invalid invitation id");

		const invitation = await DB.instance()
			.select()
			.from(DB.Tables.invitations)
			.where(eq(DB.Tables.invitations.id, invitationId.data))
			.get();

		if (!invitation) return APIResponse.notFound(c, "Invitation not found");

		c.set("invitation", invitation);
		await next();
	},
);

router.post(
	"/:invitationId/resend",

	APIRouteSpec.authenticated({
		summary: "Resend invitation",
		description:
			"Issue a new invite link (the old one stops working), extend the expiry by 7 days and send the email again.",
		tags: [DOCS_TAGS.ADMIN_API.INVITATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Invitation resent successfully", AdminInvitationsModel.Resend.Response),
			APIResponseSpec.badRequest("The invitation has already been accepted"),
			APIResponseSpec.notFound("Invitation not found"),
		),
	}),

	async (c) => {
		const invitation = c.get("invitation");
		if (invitation.accepted_at) {
			return APIResponse.badRequest(c, "The invitation has already been accepted");
		}

		const token = createInvitationToken();
		const updated = await DB.instance()
			.update(DB.Tables.invitations)
			.set({ token_hash: hashInvitationToken(token), expires_at: Date.now() + 7 * DAY_MS })
			.where(eq(DB.Tables.invitations.id, invitation.id))
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "invite",
			entityType: "invitation",
			entityId: invitation.id,
			summary: `Einladung für ${invitation.email} erneut versendet`,
		});

		return APIResponse.success(c, "Invitation resent successfully", await issue(c, updated, token));
	},
);

router.delete(
	"/:invitationId",

	APIRouteSpec.authenticated({
		summary: "Revoke invitation",
		description: "Delete a pending or expired invitation so its link can no longer be used.",
		tags: [DOCS_TAGS.ADMIN_API.INVITATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Invitation revoked successfully"),
			APIResponseSpec.badRequest("The invitation has already been accepted"),
			APIResponseSpec.notFound("Invitation not found"),
		),
	}),

	async (c) => {
		const invitation = c.get("invitation");
		if (invitation.accepted_at) {
			return APIResponse.badRequest(c, "The invitation has already been accepted");
		}

		await DB.instance()
			.delete(DB.Tables.invitations)
			.where(eq(DB.Tables.invitations.id, invitation.id))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "invitation",
			entityId: invitation.id,
			summary: `Einladung für ${invitation.email} zurückgezogen`,
		});

		return APIResponse.successNoData(c, "Invitation revoked successfully");
	},
);
