import { and, count, desc, eq, gt, isNotNull, isNull, like, max, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler, SessionHandler } from "../../../../../utils/authHandler";
import { getAuthUserId } from "../../../../../utils/guards";
import { PasswordLinks } from "../../../../../utils/passwordLinks";
import { UserPreferencesHandler } from "../../../../../utils/preferences";
import { UserAccountSettings } from "../../../../../utils/shared-models/accountData";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminUsersModel } from "./model";

const TARGET_USER_KEY = "adminTargetUser";

const sanitizeUser = (user: DB.Models.User) => AdminUsersModel.SafeUser.parse(user);

/** The system org's users are the system admins: there, "admin" is the only role. */
function isRoleAllowedHere(role: UserAccountSettings.Role) {
	return OrgContext.current().kind !== "system" || role === "admin";
}

function findUser(userID: number) {
	return DB.instance()
		.select()
		.from(DB.Tables.users)
		.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, userID)))
		.get();
}

export const router = new Hono().basePath("/users");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List users",
		description: "Retrieve user accounts with optional role, status and search filters.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Users retrieved successfully", AdminUsersModel.GetAll.Response),
		),
	}),

	zValidator("query", AdminUsersModel.GetAll.Query),

	async (c) => {
		const filters = c.req.valid("query") as AdminUsersModel.GetAll.Query;
		const table = DB.Tables.users;

		const conditions: (SQL | undefined)[] = [
			inOrg(table),
			filters.role ? eq(table.role, filters.role) : undefined,
			filters.status === "suspended" ? isNotNull(table.suspended_at) : undefined,
			filters.status === "active" ? isNull(table.suspended_at) : undefined,
		];

		if (filters.search) {
			const pattern = `%${filters.search}%`;
			conditions.push(
				or(
					like(table.username, pattern),
					like(table.display_name, pattern),
					like(table.email, pattern),
				),
			);
		}

		let query = DB.instance()
			.select()
			.from(table)
			.where(and(...conditions))
			.orderBy(table.id)
			.$dynamic();

		if (filters.limit) query = query.limit(filters.limit);
		if (filters.offset) query = query.offset(filters.offset);

		const users = await query;

		return APIResponse.success(c, "Users retrieved successfully", users.map(sanitizeUser));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create user",
		description:
			"Create an account directly (no invitation). Without a password the account cannot log in yet: the response carries a one-time link (7 days) for the person to choose one.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("User created successfully", AdminUsersModel.Create.Response),
			APIResponseSpec.conflict("Conflict: Username or email already exists"),
		),
	}),

	zValidator("json", AdminUsersModel.Create.Body),

	async (c) => {
		const body = c.req.valid("json") as AdminUsersModel.Create.Body;

		const role = body.role ?? (OrgContext.current().kind === "system" ? "admin" : undefined);
		if (role && !isRoleAllowedHere(role)) {
			return APIResponse.badRequest(c, "System admins always have the role admin");
		}

		const duplicate = DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(
				and(
					inOrg(DB.Tables.users),
					or(eq(DB.Tables.users.username, body.username), eq(DB.Tables.users.email, body.email)),
				),
			)
			.get();

		if (duplicate) {
			return APIResponse.conflict(c, "A user with the same username or email already exists");
		}

		const { password, ...userData } = body;

		// No password: store the hash of a random secret nobody knows, so the account stays locked
		// until the person sets their own through the link.
		const passwordHash = await Bun.password.hash(
			password ?? crypto.randomUUID() + crypto.randomUUID(),
		);

		const { createdUser, passwordLink } = await DB.instance().transaction(async (tx: DrizzleDB) => {
			const createdUser = await tx
				.insert(DB.Tables.users)
				.values({ ...userData, role, org_id: OrgContext.id(), password_hash: passwordHash })
				.returning()
				.get();

			const passwordLink = password
				? null
				: await PasswordLinks.issue(createdUser.id, PasswordLinks.ADMIN_TTL_MS, tx);

			return { createdUser, passwordLink };
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "create",
			entityType: "user",
			entityId: createdUser.id,
			summary: `Benutzer „${createdUser.username}“ (${UserAccountSettings.RoleLabels[createdUser.role]}) angelegt${passwordLink ? " – Passwort-Link erstellt" : ""}`,
			metadata: { role: createdUser.role, password: passwordLink ? "link" : "set" },
		});

		return APIResponse.created(c, "User created successfully", {
			user: sanitizeUser(createdUser),
			password_link: passwordLink
				? { url: passwordLink.url, expires_at: passwordLink.expires_at }
				: null,
		} satisfies AdminUsersModel.Create.Response);
	},
);

router.use(
	"/:userId/*",

	zValidator("param", AdminUsersModel.UserId.Params),

	async (c, next) => {
		// @ts-ignore - hono-openapi does not type "param" yet
		const { userId } = c.req.valid("param") as AdminUsersModel.UserId.Params;

		const user = findUser(userId);

		if (!user) {
			return APIResponse.notFound(c, "User not found");
		}

		// @ts-ignore
		c.set(TARGET_USER_KEY, user);

		await next();
	},
);

router.get(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Get user",
		description:
			"Account details plus the user's event memberships, active sessions, API keys and open password link.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("User retrieved successfully", AdminUsersModel.Detail),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;
		const now = Date.now();

		const [events, sessions, apiKeys, passwordLink] = await Promise.all([
			DB.instance()
				.select({
					id: DB.Tables.events.id,
					name: DB.Tables.events.name,
					type: DB.Tables.events.type,
					status: DB.Tables.events.status,
					start_date: DB.Tables.events.start_date,
					end_date: DB.Tables.events.end_date,
					role: DB.Tables.eventMembers.role,
					position: DB.Tables.eventMembers.position,
				})
				.from(DB.Tables.eventMembers)
				.innerJoin(
					DB.Tables.events,
					and(inOrg(DB.Tables.events), eq(DB.Tables.events.id, DB.Tables.eventMembers.event_id)),
				)
				.where(and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.user_id, user.id)))
				.orderBy(desc(DB.Tables.events.start_date))
				.all(),
			DB.instance()
				.select({ value: count() })
				.from(DB.Tables.sessions)
				.where(
					and(
						inOrg(DB.Tables.sessions),
						eq(DB.Tables.sessions.user_id, user.id),
						gt(DB.Tables.sessions.expires_at, now),
					),
				)
				.get(),
			DB.instance()
				.select({ value: count() })
				.from(DB.Tables.apiKeys)
				.where(and(inOrg(DB.Tables.apiKeys), eq(DB.Tables.apiKeys.user_id, user.id)))
				.get(),
			DB.instance()
				.select({ value: max(DB.Tables.passwordResets.expires_at) })
				.from(DB.Tables.passwordResets)
				.where(
					and(
						inOrg(DB.Tables.passwordResets),
						eq(DB.Tables.passwordResets.user_id, user.id),
						gt(DB.Tables.passwordResets.expires_at, now),
					),
				)
				.get(),
		]);

		return APIResponse.success(c, "User retrieved successfully", {
			...sanitizeUser(user),
			events,
			active_sessions: sessions?.value ?? 0,
			api_keys: apiKeys?.value ?? 0,
			password_link_expires_at: passwordLink?.value ?? null,
		} satisfies AdminUsersModel.Detail);
	},
);

router.put(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Update user",
		description: "Modify profile fields or role for a user account.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("User updated successfully", AdminUsersModel.SafeUser),
			APIResponseSpec.badRequest(
				"You cannot remove your own admin role / Provide at least one field to update / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("User not found"),
			APIResponseSpec.conflict("Conflict: Username or email already exists"),
		),
	}),

	zValidator("json", AdminUsersModel.Update.Body),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;
		const updateBody = c.req.valid("json") as AdminUsersModel.Update.Body;

		const updates = Object.fromEntries(
			Object.entries(updateBody).filter(([, value]) => value !== undefined),
		) as Partial<AdminUsersModel.Update.Body>;

		if (Object.keys(updates).length === 0) {
			return APIResponse.badRequest(c, "Provide at least one field to update");
		}

		// Keep at least the acting admin in charge: no locking yourself out by accident.
		if (user.id === getAuthUserId(c) && updates.role && updates.role !== "admin") {
			return APIResponse.badRequest(c, "You cannot remove your own admin role");
		}

		if (updates.role && !isRoleAllowedHere(updates.role)) {
			return APIResponse.badRequest(c, "System admins always have the role admin");
		}

		if (updates.username && updates.username !== user.username) {
			const usernameConflict = DB.instance()
				.select()
				.from(DB.Tables.users)
				.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.username, updates.username)))
				.get();

			if (usernameConflict) {
				return APIResponse.conflict(c, "Username already in use");
			}
		}

		if (updates.email && updates.email !== user.email) {
			const emailConflict = DB.instance()
				.select()
				.from(DB.Tables.users)
				.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.email, updates.email)))
				.get();

			if (emailConflict) {
				return APIResponse.conflict(c, "Email already in use");
			}
		}

		const roleChanged = updates.role && updates.role !== user.role;

		// One transaction: the role on the user and the role cached on their sessions/API keys
		// must never disagree.
		await DB.instance().transaction(async (tx: DrizzleDB) => {
			await tx
				.update(DB.Tables.users)
				.set(updates)
				.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, user.id)))
				.run();
			if (roleChanged && updates.role) {
				await AuthHandler.changeUserRoleInAuthContexts(user.id, updates.role, tx);
			}
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "user",
			entityId: user.id,
			summary:
				roleChanged && updates.role
					? `Rolle von „${user.username}“ von „${UserAccountSettings.RoleLabels[user.role]}“ auf „${UserAccountSettings.RoleLabels[updates.role]}“ geändert`
					: `Benutzer „${user.username}“ bearbeitet`,
			metadata: roleChanged
				? { fields: Object.keys(updates), role: { from: user.role, to: updates.role } }
				: { fields: Object.keys(updates) },
		});

		const refreshed = findUser(user.id);

		if (!refreshed) {
			throw new Error("User not found after update");
		}

		return APIResponse.success(c, "User updated successfully", sanitizeUser(refreshed));
	},
);

router.put(
	"/:userId/password",

	APIRouteSpec.authenticated({
		summary: "Reset user password",
		description:
			"Set a new password for a user account, revoke their active sessions and any open password link.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Password reset successfully"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	zValidator("json", AdminUsersModel.UpdatePassword.Body),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;
		const { password } = c.req.valid("json") as AdminUsersModel.UpdatePassword.Body;

		const passwordHash = await Bun.password.hash(password);

		await DB.instance().transaction(async (tx: DrizzleDB) => {
			await tx
				.update(DB.Tables.users)
				.set({ password_hash: passwordHash })
				.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, user.id)))
				.run();
			await SessionHandler.inValidateAllSessionsForUser(user.id, tx);
			await PasswordLinks.revokeAll(user.id, tx);
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "user",
			entityId: user.id,
			summary: `Passwort von „${user.username}“ zurückgesetzt`,
		});

		return APIResponse.successNoData(c, "Password reset successfully");
	},
);

router.post(
	"/:userId/password-link",

	APIRouteSpec.authenticated({
		summary: "Create password link",
		description:
			"Create a one-time link (valid 7 days) the person can use to choose a new password. Replaces any open link; the current password keeps working until the link is used.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Password link created successfully", AdminUsersModel.PasswordLink),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;

		const link = await DB.instance().transaction(
			async (tx: DrizzleDB) => await PasswordLinks.issue(user.id, PasswordLinks.ADMIN_TTL_MS, tx),
		);

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "password_link",
			entityType: "user",
			entityId: user.id,
			summary: `Passwort-Link für „${user.username}“ erstellt`,
			metadata: { expires_at: link.expires_at },
		});

		return APIResponse.created(c, "Password link created successfully", {
			url: link.url,
			expires_at: link.expires_at,
		} satisfies AdminUsersModel.PasswordLink);
	},
);

router.post(
	"/:userId/sessions/revoke",

	APIRouteSpec.authenticated({
		summary: "Sign out everywhere",
		description:
			"End all login sessions of the user. API keys keep working. Not for your own account — use the account settings.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Sessions revoked successfully",
				AdminUsersModel.RevokeSessions.Response,
			),
			APIResponseSpec.badRequest("Use your account settings to sign out your own sessions"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;

		if (user.id === getAuthUserId(c)) {
			return APIResponse.badRequest(c, "Use your account settings to sign out your own sessions");
		}

		const revoked = await DB.instance().transaction(async (tx: DrizzleDB) => {
			const sessions = await tx
				.select({ value: count() })
				.from(DB.Tables.sessions)
				.where(and(inOrg(DB.Tables.sessions), eq(DB.Tables.sessions.user_id, user.id)))
				.get();
			await SessionHandler.inValidateAllSessionsForUser(user.id, tx);
			return sessions?.value ?? 0;
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "revoke",
			entityType: "user",
			entityId: user.id,
			summary: `„${user.username}“ überall abgemeldet (${revoked} ${revoked === 1 ? "Sitzung" : "Sitzungen"})`,
			metadata: { sessions: revoked },
		});

		return APIResponse.success(c, "Sessions revoked successfully", {
			revoked,
		} satisfies AdminUsersModel.RevokeSessions.Response);
	},
);

router.post(
	"/:userId/suspend",

	APIRouteSpec.authenticated({
		summary: "Suspend user",
		description:
			"Block the account without deleting its data: no login, all sessions, API keys and password links are revoked. Not for your own account.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("User suspended successfully", AdminUsersModel.SafeUser),
			APIResponseSpec.badRequest("You cannot suspend your own account / User is already suspended"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	zValidator("json", AdminUsersModel.Suspend.Body),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;
		const { reason } = c.req.valid("json") as AdminUsersModel.Suspend.Body;

		if (user.id === getAuthUserId(c)) {
			return APIResponse.badRequest(c, "You cannot suspend your own account");
		}
		if (user.suspended_at) {
			return APIResponse.badRequest(c, "User is already suspended");
		}

		const suspension = { suspended_at: Date.now(), suspended_reason: reason || null };

		await DB.instance().transaction(async (tx: DrizzleDB) => {
			await tx
				.update(DB.Tables.users)
				.set(suspension)
				.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, user.id)))
				.run();
			await AuthHandler.invalidateAllAuthContextsForUser(user.id, tx);
			await PasswordLinks.revokeAll(user.id, tx);
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "suspend",
			entityType: "user",
			entityId: user.id,
			summary: `Benutzer „${user.username}“ gesperrt`,
			metadata: reason ? { reason } : undefined,
		});

		return APIResponse.success(
			c,
			"User suspended successfully",
			sanitizeUser({ ...user, ...suspension }),
		);
	},
);

router.post(
	"/:userId/unsuspend",

	APIRouteSpec.authenticated({
		summary: "Lift suspension",
		description: "Allow a suspended account to log in again.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Suspension lifted successfully", AdminUsersModel.SafeUser),
			APIResponseSpec.badRequest("User is not suspended"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;

		if (!user.suspended_at) {
			return APIResponse.badRequest(c, "User is not suspended");
		}

		await DB.instance()
			.update(DB.Tables.users)
			.set({ suspended_at: null, suspended_reason: null })
			.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, user.id)))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "unsuspend",
			entityType: "user",
			entityId: user.id,
			summary: `Sperre von „${user.username}“ aufgehoben`,
		});

		return APIResponse.success(
			c,
			"Suspension lifted successfully",
			sanitizeUser({ ...user, suspended_at: null, suspended_reason: null }),
		);
	},
);

router.delete(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Delete user",
		description: "Permanently remove a user account and all of its associated data.",
		tags: [DOCS_TAGS.ADMIN_API.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("User deleted successfully"),
			APIResponseSpec.badRequest("You cannot delete your own account here"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		// @ts-ignore
		const user = c.get(TARGET_USER_KEY) as DB.Models.User;

		if (user.id === getAuthUserId(c)) {
			return APIResponse.badRequest(c, "You cannot delete your own account here");
		}

		await DB.instance().transaction(async (tx: DrizzleDB) => {
			await AuthHandler.invalidateAllAuthContextsForUser(user.id, tx);
			await PasswordLinks.revokeAll(user.id, tx);
			await UserPreferencesHandler.deleteAllForUser(user.id, tx);
			await tx
				.delete(DB.Tables.users)
				.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, user.id)))
				.run();
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "user",
			entityId: user.id,
			summary: `Benutzer „${user.username}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "User deleted successfully");
	},
);
