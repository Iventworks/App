import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { ConfigHandler } from "../../../../../../utils/config";
import { LCrypt } from "../../../../../../utils/crypto/lcrypt";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler, SessionHandler } from "../../../../../utils/authHandler";
import { Notifier } from "../../../../../utils/notifications";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AuthInvitationsModel } from "./model";

// --- token helpers (shared with admin/invitations) -------------------------------------------

/** 32 random bytes as hex. Handed out once (in the invite link); stored only hashed. */
export function createInvitationToken() {
	return LCrypt.randomBytes(32).toString("hex");
}

/** Invitation tokens are stored as SHA3-256 hex, like password reset tokens. */
export function hashInvitationToken(token: string) {
	return LCrypt.sha256(token).toHex();
}

/** The frontend page that accepts an invitation. */
export function getInviteURL(token: string) {
	const appUrl = (ConfigHandler.getConfig()?.APP_URL ?? "").replace(/\/+$/, "");
	return `${appUrl}/auth/accept-invite?token=${encodeURIComponent(token)}`;
}

// --- rate limiting -----------------------------------------------------------------------------

// Per token (hashed): inspect is called on page load and accept may be retried after a taken
// username, so allow a few more attempts than the password reset does.
const INVITE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const INVITE_MAX_ATTEMPTS_PER_TOKEN = 10;
const inviteAttempts = new Map<string, { count: number; resetAt: number }>();

const INVITE_CLEANUP_INTERVAL = setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of inviteAttempts) {
		if (entry.resetAt <= now) inviteAttempts.delete(key);
	}
}, INVITE_WINDOW_MS);
INVITE_CLEANUP_INTERVAL.unref();

/** Count an attempt; false when the token is over its limit. */
function registerAttempt(tokenHash: string): boolean {
	const now = Date.now();
	let entry = inviteAttempts.get(tokenHash);
	if (!entry || entry.resetAt <= now) {
		entry = { count: 1, resetAt: now + INVITE_WINDOW_MS };
		inviteAttempts.set(tokenHash, entry);
		return true;
	}
	entry.count += 1;
	return entry.count <= INVITE_MAX_ATTEMPTS_PER_TOKEN;
}

/** A pending (not accepted, not expired) invitation for a token, or null. */
async function findPendingInvitation(tokenHash: string, tx: DrizzleDB = DB.instance()) {
	const invitation = await tx
		.select()
		.from(DB.Tables.invitations)
		.where(
			and(eq(DB.Tables.invitations.token_hash, tokenHash), isNull(DB.Tables.invitations.accepted_at)),
		)
		.get();

	if (!invitation || invitation.expires_at < Date.now()) return null;
	return invitation;
}

export const router = new Hono().basePath("/invitations");

router.post(
	"/inspect",

	APIRouteSpec.unauthenticated({
		summary: "Inspect an invitation",
		description:
			"Check an invitation token from an invite link and return the invited email address and role.",
		tags: [DOCS_TAGS.AUTH_INVITATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Invitation is valid", AuthInvitationsModel.Inspect.Response),
			APIResponseSpec.badRequest(
				"Invalid or expired invitation / Syntax or validation error in request",
			),
			APIResponseSpec.forbidden("You are already authenticated"),
			APIResponseSpec.tooManyRequests("Too many attempts. Try again later."),
		),
	}),

	zValidator("json", AuthInvitationsModel.Inspect.Body),

	async (c) => {
		if (AuthHandler.AuthContext.get(c).type !== "unauthenticated") {
			return APIResponse.forbidden(c, "You are already authenticated");
		}

		const { token } = c.req.valid("json") as AuthInvitationsModel.Inspect.Body;
		const tokenHash = hashInvitationToken(token);

		if (!registerAttempt(tokenHash)) {
			return APIResponse.tooManyRequests(c, "Too many attempts. Try again later.");
		}

		const invitation = await findPendingInvitation(tokenHash);
		if (!invitation) {
			return APIResponse.badRequest(c, "Invalid or expired invitation");
		}

		return APIResponse.success(c, "Invitation is valid", {
			email: invitation.email,
			display_name: invitation.display_name,
			role: invitation.role,
			expires_at: invitation.expires_at,
		} satisfies AuthInvitationsModel.Inspect.Response);
	},
);

router.post(
	"/accept",

	APIRouteSpec.unauthenticated({
		summary: "Accept an invitation",
		description:
			"Create the account for an invitation (username, display name and password) and sign in. The email address and role come from the invitation.",
		tags: [DOCS_TAGS.AUTH_INVITATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Invitation accepted successfully",
				AuthInvitationsModel.Accept.Response,
			),
			APIResponseSpec.badRequest(
				"Invalid or expired invitation / Syntax or validation error in request",
			),
			APIResponseSpec.forbidden("You are already authenticated"),
			APIResponseSpec.conflict("Username or email already in use"),
			APIResponseSpec.tooManyRequests("Too many attempts. Try again later."),
		),
	}),

	zValidator("json", AuthInvitationsModel.Accept.Body),

	async (c) => {
		if (AuthHandler.AuthContext.get(c).type !== "unauthenticated") {
			return APIResponse.forbidden(c, "You are already authenticated");
		}

		const body = c.req.valid("json") as AuthInvitationsModel.Accept.Body;
		const tokenHash = hashInvitationToken(body.token);

		if (!registerAttempt(tokenHash)) {
			return APIResponse.tooManyRequests(c, "Too many attempts. Try again later.");
		}

		const passwordHash = await Bun.password.hash(body.password);

		try {
			const result = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const invitation = await findPendingInvitation(tokenHash, tx);
				if (!invitation) return { error: "invalid" as const };

				const conflict = await tx
					.select({ id: DB.Tables.users.id })
					.from(DB.Tables.users)
					.where(
						or(
							eq(DB.Tables.users.username, body.username),
							sql`lower(${DB.Tables.users.email}) = ${invitation.email.toLowerCase()}`,
						),
					)
					.get();
				if (conflict) return { error: "conflict" as const };

				const user = await tx
					.insert(DB.Tables.users)
					.values({
						username: body.username,
						display_name: body.display_name,
						email: invitation.email,
						password_hash: passwordHash,
						role: invitation.role,
					})
					.returning()
					.get();

				await tx
					.update(DB.Tables.invitations)
					.set({ accepted_at: Date.now(), accepted_user_id: user.id })
					.where(eq(DB.Tables.invitations.id, invitation.id))
					.run();

				const session = await SessionHandler.createSession(user.id, tx);

				return { user, invitation, session };
			});

			if ("error" in result) {
				return result.error === "invalid"
					? APIResponse.badRequest(c, "Invalid or expired invitation")
					: APIResponse.conflict(c, "Username or email already in use");
			}

			inviteAttempts.delete(tokenHash);

			await AuditLog.record({
				userId: result.user.id,
				action: "create",
				entityType: "user",
				entityId: result.user.id,
				summary: `Konto „${result.user.username}“ über Einladung angelegt`,
				metadata: { invitation_id: result.invitation.id, role: result.user.role },
			});

			await Notifier.notify([result.invitation.invited_by], {
				type: "system",
				title: "Einladung angenommen",
				body: `${result.user.display_name} (${result.user.email}) hat die Einladung angenommen.`,
				link: "/admin/users",
			});

			return APIResponse.created(
				c,
				"Invitation accepted successfully",
				result.session satisfies AuthInvitationsModel.Accept.Response,
			);
		} catch (error: any) {
			Logger.error("Failed to accept invitation", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to accept invitation");
		}
	},
);
