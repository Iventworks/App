import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { API } from "../server/lib/api";
import { type CapturedEmail, EmailService } from "../server/lib/api/utils/email";
import { AccountSessionsModel } from "../server/lib/api/versions/v1/routes/account/sessions/model";
import { AdminAuditLogModel } from "../server/lib/api/versions/v1/routes/admin/audit-log/model";
import { AdminInvitationsModel } from "../server/lib/api/versions/v1/routes/admin/invitations/model";
import { AdminUsersModel } from "../server/lib/api/versions/v1/routes/admin/users/model";
import { hashInvitationToken } from "../server/lib/api/versions/v1/routes/auth/invitations";
import { AuthInvitationsModel } from "../server/lib/api/versions/v1/routes/auth/invitations/model";
import { OrgAnnouncementsModel } from "../server/lib/api/versions/v1/routes/org/announcements/model";
import { CoreTeamModel } from "../server/lib/api/versions/v1/routes/org/core-team/model";
import { OrgDocumentsModel } from "../server/lib/api/versions/v1/routes/org/documents/model";
import { OrgResourcesModel } from "../server/lib/api/versions/v1/routes/org/resources/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { makeAPIRequest } from "./helpers/api";
import { createMemoryTransport } from "./helpers/memory-transport";
import { hostHeaders, TEST_HOST } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let admin: SeededUser;
let core: SeededUser;
let core2: SeededUser;
let volunteer: SeededUser;
let unverified: SeededUser;

let adminSession: SeededSession;
let coreSession: SeededSession;
let core2Session: SeededSession;
let volunteerSession: SeededSession;

function seedEvent(
	name: string,
	start_date: string,
	end_date: string,
	extra: Partial<DB.Models.Event> = {},
) {
	return DB.instance()
		.insert(DB.Tables.events)
		.values({ org_id: OrgContext.id(), name, start_date, end_date, ...extra })
		.returning()
		.get();
}

beforeAll(async () => {
	admin = await seedUser("admin");
	core = await seedUser("core_team");
	core2 = await seedUser("core_team");
	volunteer = await seedUser("volunteer");
	unverified = await seedUser("unverified");

	adminSession = await seedSession(admin.id);
	coreSession = await seedSession(core.id);
	core2Session = await seedSession(core2.id);
	volunteerSession = await seedSession(volunteer.id);
});

describe("Invitations", () => {
	const captured: CapturedEmail[] = [];
	const invitedEmail = `invitee-${randomUUID().slice(0, 8)}@example.com`;
	let inviteToken: string;
	let invitationId: number;

	beforeAll(() => {
		EmailService.init(createMemoryTransport(captured));
	});

	afterAll(() => {
		EmailService.reset();
	});

	test("non-admins cannot invite", async () => {
		await makeAPIRequest(
			"/v1/admin/invitations",
			{ method: "POST", authToken: coreSession.token, body: { email: invitedEmail } },
			403,
		);
	});

	test("admin invites a user; the email carries the invite link", async () => {
		const issued = await makeAPIRequest("/v1/admin/invitations", {
			method: "POST",
			authToken: adminSession.token,
			body: { email: invitedEmail, display_name: "Neue Person", role: "volunteer" },
			expectedBodySchema: AdminInvitationsModel.Create.Response,
		});

		expect(issued.invitation.status).toBe("pending");
		expect(issued.invitation.invited_by?.id).toBe(admin.id);
		expect(issued.email_sent).toBe(true);
		expect(issued.invite_url).toContain("/auth/accept-invite?token=");

		inviteToken = new URL(issued.invite_url).searchParams.get("token")!;
		invitationId = issued.invitation.id;

		const mail = captured.find((entry) => entry.to === invitedEmail);
		expect(mail?.html).toContain(encodeURIComponent(inviteToken));
	});

	test("duplicate invitations and existing users are rejected", async () => {
		await makeAPIRequest(
			"/v1/admin/invitations",
			{ method: "POST", authToken: adminSession.token, body: { email: invitedEmail } },
			409,
		);
		await makeAPIRequest(
			"/v1/admin/invitations",
			{
				method: "POST",
				authToken: adminSession.token,
				body: { email: volunteer.email.toUpperCase() },
			},
			409,
		);
	});

	test("inspect returns the invitation, unknown tokens are rejected", async () => {
		const info = await makeAPIRequest("/v1/auth/invitations/inspect", {
			method: "POST",
			body: { token: inviteToken },
			expectedBodySchema: AuthInvitationsModel.Inspect.Response,
		});
		expect(info.email).toBe(invitedEmail);
		expect(info.role).toBe("volunteer");

		await makeAPIRequest(
			"/v1/auth/invitations/inspect",
			{ method: "POST", body: { token: "nope" } },
			400,
		);

		await makeAPIRequest(
			"/v1/auth/invitations/inspect",
			{ method: "POST", authToken: volunteerSession.token, body: { token: inviteToken } },
			403,
		);
	});

	test("accept creates the account, signs in, and the token cannot be reused", async () => {
		await makeAPIRequest(
			"/v1/auth/invitations/accept",
			{
				method: "POST",
				body: {
					token: inviteToken,
					username: volunteer.username,
					display_name: "Neue Person",
					password: "Invit3d!Pass",
				},
			},
			409,
		);

		const username = `invited_${randomUUID().slice(0, 6)}`;
		const session = await makeAPIRequest(
			"/v1/auth/invitations/accept",
			{
				method: "POST",
				body: { token: inviteToken, username, display_name: "Neue Person", password: "Invit3d!Pass" },
				expectedBodySchema: AuthInvitationsModel.Accept.Response,
			},
			201,
		);
		expect(session.user_role).toBe("volunteer");

		const account = await makeAPIRequest("/v1/account", { authToken: session.token });
		expect(account.email).toBe(invitedEmail);

		const login = await makeAPIRequest("/v1/auth/login", {
			method: "POST",
			body: { username, password: "Invit3d!Pass" },
		});
		expect(login.user_role).toBe("volunteer");

		await makeAPIRequest(
			"/v1/auth/invitations/accept",
			{
				method: "POST",
				body: {
					token: inviteToken,
					username: `again_${randomUUID().slice(0, 6)}`,
					display_name: "X",
					password: "Invit3d!Pass",
				},
			},
			400,
		);

		const list = await makeAPIRequest("/v1/admin/invitations", {
			authToken: adminSession.token,
			expectedBodySchema: AdminInvitationsModel.GetAll.Response,
		});
		const accepted = list.find((entry) => entry.id === invitationId);
		expect(accepted?.status).toBe("accepted");
		expect(accepted?.accepted_user?.username).toBe(username);

		await makeAPIRequest(
			`/v1/admin/invitations/${invitationId}`,
			{ method: "DELETE", authToken: adminSession.token },
			400,
		);
	});

	test("expired invitations are rejected; resend issues a fresh link; revoke deletes", async () => {
		const token = randomUUID().replaceAll("-", "");
		const expired = DB.instance()
			.insert(DB.Tables.invitations)
			.values({
				org_id: OrgContext.id(),
				token_hash: hashInvitationToken(token),
				email: `expired-${randomUUID().slice(0, 8)}@example.com`,
				role: "volunteer",
				expires_at: Date.now() - 1000,
			})
			.returning()
			.get();

		await makeAPIRequest("/v1/auth/invitations/inspect", { method: "POST", body: { token } }, 400);

		const resent = await makeAPIRequest(`/v1/admin/invitations/${expired.id}/resend`, {
			method: "POST",
			authToken: adminSession.token,
			expectedBodySchema: AdminInvitationsModel.Resend.Response,
		});
		expect(resent.invitation.status).toBe("pending");
		const freshToken = new URL(resent.invite_url).searchParams.get("token")!;
		await makeAPIRequest("/v1/auth/invitations/inspect", {
			method: "POST",
			body: { token: freshToken },
		});

		await makeAPIRequest(`/v1/admin/invitations/${expired.id}`, {
			method: "DELETE",
			authToken: adminSession.token,
		});
		await makeAPIRequest(
			"/v1/auth/invitations/inspect",
			{ method: "POST", body: { token: freshToken } },
			400,
		);
	});
});

describe("Admin users and audit log", () => {
	test("admins cannot demote or delete themselves", async () => {
		await makeAPIRequest(
			`/v1/admin/users/${admin.id}`,
			{ method: "PUT", authToken: adminSession.token, body: { role: "volunteer" } },
			400,
		);
		await makeAPIRequest(
			`/v1/admin/users/${admin.id}`,
			{ method: "DELETE", authToken: adminSession.token },
			400,
		);
	});

	test("only admins reach /admin; other roles get 403", async () => {
		for (const session of [coreSession, volunteerSession]) {
			await makeAPIRequest("/v1/admin/users", { authToken: session.token }, 403);
			await makeAPIRequest("/v1/admin/invitations", { authToken: session.token }, 403);
		}
		await makeAPIRequest("/v1/admin/users", { authToken: adminSession.token });
	});

	test("users cannot change their own role; admin role changes reach existing sessions", async () => {
		// The role field is not part of the account body: it is dropped, the role stays.
		await makeAPIRequest("/v1/account", {
			method: "PUT",
			authToken: volunteerSession.token,
			body: { display_name: "Vroni", role: "admin", current_password: volunteer.password },
		});
		const me = await makeAPIRequest("/v1/account", { authToken: volunteerSession.token });
		expect(me.role).toBe("volunteer");
		expect(me.display_name).toBe("Vroni");

		// Promoting the user updates the role cached on their live session immediately.
		await makeAPIRequest(`/v1/admin/users/${volunteer.id}`, {
			method: "PUT",
			authToken: adminSession.token,
			body: { role: "core_team" },
		});
		const session = await makeAPIRequest("/v1/auth/session", { authToken: volunteerSession.token });
		expect(session.user_role).toBe("core_team");
		await makeAPIRequest("/v1/org/core-team/overview", { authToken: volunteerSession.token });

		await makeAPIRequest(`/v1/admin/users/${volunteer.id}`, {
			method: "PUT",
			authToken: adminSession.token,
			body: { role: "volunteer" },
		});
		await makeAPIRequest("/v1/org/core-team/overview", { authToken: volunteerSession.token }, 403);
	});

	test("admin edits validate username and email like everywhere else", async () => {
		await makeAPIRequest(
			`/v1/admin/users/${volunteer.id}`,
			{ method: "PUT", authToken: adminSession.token, body: { email: "kein-email" } },
			400,
		);
		await makeAPIRequest(
			`/v1/admin/users/${volunteer.id}`,
			{ method: "PUT", authToken: adminSession.token, body: { username: "Ungültig Name!" } },
			400,
		);
	});

	test("role changes are audited and filterable", async () => {
		await makeAPIRequest(`/v1/admin/users/${unverified.id}`, {
			method: "PUT",
			authToken: adminSession.token,
			body: { role: "volunteer" },
		});

		const log = await makeAPIRequest(`/v1/admin/audit-log?entity_type=user&user_id=${admin.id}`, {
			authToken: adminSession.token,
			expectedBodySchema: AdminAuditLogModel.GetAll.Response,
		});
		expect(log.total).toBeGreaterThanOrEqual(1);
		expect(log.entries.every((entry) => entry.entity_type === "user")).toBe(true);
		expect(log.entries.every((entry) => entry.user?.id === admin.id)).toBe(true);
		expect(log.entries.some((entry) => entry.entity_id === unverified.id)).toBe(true);

		const invites = await makeAPIRequest("/v1/admin/audit-log?action=invite&limit=1", {
			authToken: adminSession.token,
			expectedBodySchema: AdminAuditLogModel.GetAll.Response,
		});
		expect(invites.entries.length).toBe(1);
		expect(invites.entries[0]!.action).toBe("invite");

		await makeAPIRequest("/v1/admin/audit-log", { authToken: coreSession.token }, 403);
	});
});

describe("Admin user management", () => {
	const login = (username: string, password: string, status = 200) =>
		makeAPIRequest("/v1/auth/login", { method: "POST", body: { username, password } }, status);

	test("create with a password: can log in right away", async () => {
		const username = `direct_${randomUUID().slice(0, 6)}`;
		const created = await makeAPIRequest(
			"/v1/admin/users",
			{
				method: "POST",
				authToken: adminSession.token,
				body: {
					username,
					display_name: "Direkt Angelegt",
					email: `${username}@example.com`,
					role: "volunteer",
					password: "Direkt!Pass123",
				},
				expectedBodySchema: AdminUsersModel.Create.Response,
			},
			201,
		);
		expect(created.user.username).toBe(username);
		expect(created.password_link).toBeNull();
		await login(username, "Direkt!Pass123");
	});

	test("create without a password: locked until the one-time link is used", async () => {
		const username = `linked_${randomUUID().slice(0, 6)}`;
		const created = await makeAPIRequest(
			"/v1/admin/users",
			{
				method: "POST",
				authToken: adminSession.token,
				body: {
					username,
					display_name: "Mit Link",
					email: `${username}@example.com`,
					role: "volunteer",
				},
				expectedBodySchema: AdminUsersModel.Create.Response,
			},
			201,
		);
		const link = created.password_link!;
		expect(link.url).toContain("/auth/reset-password?token=");
		expect(link.expires_at).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

		const detail = await makeAPIRequest(`/v1/admin/users/${created.user.id}`, {
			authToken: adminSession.token,
			expectedBodySchema: AdminUsersModel.Detail,
		});
		expect(detail.password_link_expires_at).toBe(link.expires_at);

		const token = new URL(link.url).searchParams.get("token")!;
		await makeAPIRequest("/v1/auth/reset-password", {
			method: "POST",
			body: { reset_token: token, new_password: "Eigenes!Pass1" },
		});
		await login(username, "Eigenes!Pass1");

		// The audit entry says how the password was handled.
		const log = await makeAPIRequest(
			`/v1/admin/audit-log?entity_type=user&entity_id=${created.user.id}`,
			{ authToken: adminSession.token, expectedBodySchema: AdminAuditLogModel.GetAll.Response },
		);
		expect(log.entries[0]!.action).toBe("create");
		expect(log.entries[0]!.metadata).toMatchObject({ password: "link" });
	});

	test("detail lists event memberships, sessions and API keys", async () => {
		const user = await seedUser("volunteer");
		await seedSession(user.id);
		const event = seedEvent("Detail-Freizeit", "2026-07-01", "2026-07-05");
		await addEventMember(event.id, user.id, "leader");

		const detail = await makeAPIRequest(`/v1/admin/users/${user.id}`, {
			authToken: adminSession.token,
			expectedBodySchema: AdminUsersModel.Detail,
		});
		expect(detail.active_sessions).toBe(1);
		expect(detail.api_keys).toBe(0);
		expect(detail.events).toEqual([
			expect.objectContaining({ id: event.id, name: "Detail-Freizeit", role: "leader" }),
		]);
		expect(detail).not.toHaveProperty("password_hash");
	});

	test("suspend blocks login and ends sessions; lifting it restores access", async () => {
		const user = await seedUser("volunteer");
		const session = await seedSession(user.id);

		await makeAPIRequest(
			`/v1/admin/users/${admin.id}/suspend`,
			{ method: "POST", authToken: adminSession.token, body: {} },
			400,
		);

		const suspended = await makeAPIRequest(`/v1/admin/users/${user.id}/suspend`, {
			method: "POST",
			authToken: adminSession.token,
			body: { reason: "Hat das Team verlassen" },
		});
		expect(suspended.suspended_at).toBeNumber();
		expect(suspended.suspended_reason).toBe("Hat das Team verlassen");

		await makeAPIRequest("/v1/account", { authToken: session.token }, 401);
		await login(user.username, user.password, 403);
		await makeAPIRequest(
			`/v1/admin/users/${user.id}/suspend`,
			{ method: "POST", authToken: adminSession.token, body: {} },
			400,
		);

		// Suspended people disappear from the directory used by pickers.
		const directory = await makeAPIRequest("/v1/users", { authToken: adminSession.token });
		expect(directory.some((entry: { id: number }) => entry.id === user.id)).toBe(false);

		const filtered = await makeAPIRequest("/v1/admin/users?status=suspended", {
			authToken: adminSession.token,
		});
		expect(filtered.some((entry: { id: number }) => entry.id === user.id)).toBe(true);

		await makeAPIRequest(`/v1/admin/users/${user.id}/unsuspend`, {
			method: "POST",
			authToken: adminSession.token,
		});
		const loggedIn = await login(user.username, user.password);
		expect(loggedIn.token).toBeString();

		const detail = await makeAPIRequest(`/v1/admin/users/${user.id}`, {
			authToken: adminSession.token,
		});
		expect(detail.last_login_at).toBeNumber();

		const log = await makeAPIRequest(`/v1/admin/audit-log?entity_type=user&entity_id=${user.id}`, {
			authToken: adminSession.token,
			expectedBodySchema: AdminAuditLogModel.GetAll.Response,
		});
		expect(log.entries.map((entry) => entry.action)).toEqual(["unsuspend", "suspend"]);
	});

	test("sign out everywhere and password links", async () => {
		const user = await seedUser("volunteer");
		const a = await seedSession(user.id);
		await seedSession(user.id);

		await makeAPIRequest(
			`/v1/admin/users/${admin.id}/sessions/revoke`,
			{ method: "POST", authToken: adminSession.token },
			400,
		);
		const revoked = await makeAPIRequest(`/v1/admin/users/${user.id}/sessions/revoke`, {
			method: "POST",
			authToken: adminSession.token,
			expectedBodySchema: AdminUsersModel.RevokeSessions.Response,
		});
		expect(revoked.revoked).toBe(2);
		await makeAPIRequest("/v1/account", { authToken: a.token }, 401);

		const link = await makeAPIRequest(
			`/v1/admin/users/${user.id}/password-link`,
			{
				method: "POST",
				authToken: adminSession.token,
				expectedBodySchema: AdminUsersModel.PasswordLink,
			},
			201,
		);
		// The old password still works until the link is used.
		await login(user.username, user.password);
		const token = new URL(link.url).searchParams.get("token")!;
		await makeAPIRequest("/v1/auth/reset-password", {
			method: "POST",
			body: { reset_token: token, new_password: "Neu!Gesetzt9" },
		});
		await login(user.username, "Neu!Gesetzt9");
	});

	test("server-managed fields cannot be set through the edit route", async () => {
		await makeAPIRequest(
			`/v1/admin/users/${volunteer.id}`,
			{ method: "PUT", authToken: adminSession.token, body: { suspended_at: Date.now() } },
			400,
		);
		const detail = await makeAPIRequest(`/v1/admin/users/${volunteer.id}`, {
			authToken: adminSession.token,
		});
		expect(detail.suspended_at).toBeNull();
	});

	test("audit log: text search, time range and the list of actors", async () => {
		const before = Date.now();
		const user = await seedUser("volunteer");
		await makeAPIRequest(`/v1/admin/users/${user.id}/password-link`, {
			method: "POST",
			authToken: adminSession.token,
		});

		const found = await makeAPIRequest(
			`/v1/admin/audit-log?search=${encodeURIComponent(user.username)}&from=${before}`,
			{ authToken: adminSession.token, expectedBodySchema: AdminAuditLogModel.GetAll.Response },
		);
		expect(found.total).toBe(1);
		expect(found.entries[0]!.action).toBe("password_link");
		expect(found.actors.some((actor) => actor.id === admin.id)).toBe(true);

		const none = await makeAPIRequest(
			`/v1/admin/audit-log?search=${encodeURIComponent(user.username)}&to=${before}`,
			{ authToken: adminSession.token, expectedBodySchema: AdminAuditLogModel.GetAll.Response },
		);
		expect(none.total).toBe(0);

		// "%" is matched literally, not as a wildcard.
		const literal = await makeAPIRequest("/v1/admin/audit-log?search=%25%25%25", {
			authToken: adminSession.token,
		});
		expect(literal.total).toBe(0);
	});
});

describe("Account sessions", () => {
	test("list, revoke one, revoke others", async () => {
		const user = await seedUser("volunteer");
		const a = await seedSession(user.id);
		const b = await seedSession(user.id);
		const c = await seedSession(user.id);

		const sessions = await makeAPIRequest("/v1/account/sessions", {
			authToken: a.token,
			expectedBodySchema: AccountSessionsModel.GetAll.Response,
		});
		expect(sessions.length).toBe(3);
		expect(sessions.filter((session) => session.is_current).length).toBe(1);

		const sessionB = (await makeAPIRequest("/v1/account/sessions", { authToken: b.token })).find(
			(session: AccountSessionsModel.Session) => session.is_current,
		);

		await makeAPIRequest(`/v1/account/sessions/${sessionB.id}`, {
			method: "DELETE",
			authToken: a.token,
		});
		await makeAPIRequest("/v1/account", { authToken: b.token }, 401);

		// Someone else's session id is not found.
		const otherSession = await seedSession(volunteer.id);
		const otherId = otherSession.token.split(":")[0]!.split("_sess_")[1]!;
		await makeAPIRequest(
			`/v1/account/sessions/${otherId}`,
			{ method: "DELETE", authToken: a.token },
			404,
		);

		const revoked = await makeAPIRequest("/v1/account/sessions", {
			method: "DELETE",
			authToken: a.token,
			expectedBodySchema: AccountSessionsModel.RevokeOthers.Response,
		});
		expect(revoked.revoked).toBe(1);
		await makeAPIRequest("/v1/account", { authToken: c.token }, 401);
		await makeAPIRequest("/v1/account", { authToken: a.token });
	});
});

describe("Login rate limiting", () => {
	async function login(username: string, password: string, clientIP: string) {
		return await API.getApp().request(
			"/v1/auth/login",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", ...hostHeaders(TEST_HOST) },
				body: JSON.stringify({ username, password }),
			},
			{ clientIP },
		);
	}

	test("failures from one client do not lock the account for other clients", async () => {
		const user = await seedUser("volunteer", {}, "Corr3ct!Pass");

		for (let i = 0; i < 5; i++) {
			expect((await login(user.username, "wrong", "10.0.0.1")).status).toBe(401);
		}
		expect((await login(user.username, "Corr3ct!Pass", "10.0.0.1")).status).toBe(429);
		expect((await login(user.username, "Corr3ct!Pass", "10.0.0.2")).status).toBe(200);
	});
});

describe("Organisation announcements", () => {
	test("core team publishes, every active member is notified", async () => {
		await makeAPIRequest(
			"/v1/org/announcements",
			{ method: "POST", authToken: volunteerSession.token, body: { title: "Nope" } },
			403,
		);

		const created = await makeAPIRequest(
			"/v1/org/announcements",
			{
				method: "POST",
				authToken: coreSession.token,
				body: { title: "Mitarbeitertreffen am Freitag", content: "19 Uhr im Gemeindehaus" },
				expectedBodySchema: OrgAnnouncementsModel.Create.Response,
			},
			201,
		);
		expect(created.event_id).toBeNull();
		expect(created.creator?.id).toBe(core.id);

		const notifications = DB.instance()
			.select()
			.from(DB.Tables.notifications)
			.where(eq(DB.Tables.notifications.type, "announcement"))
			.all();
		const recipients = new Set(notifications.map((entry) => entry.user_id));
		expect(recipients.has(volunteer.id)).toBe(true);
		expect(recipients.has(admin.id)).toBe(true);
		expect(recipients.has(core.id)).toBe(false);

		const list = await makeAPIRequest("/v1/org/announcements?limit=10", {
			authToken: volunteerSession.token,
			expectedBodySchema: OrgAnnouncementsModel.GetAll.Response,
		});
		expect(list.some((entry) => entry.id === created.id)).toBe(true);

		const updated = await makeAPIRequest(`/v1/org/announcements/${created.id}`, {
			method: "PUT",
			authToken: core2Session.token,
			body: { pinned: true },
			expectedBodySchema: OrgAnnouncementsModel.Update.Response,
		});
		expect(updated.pinned).toBe(true);

		await makeAPIRequest(
			`/v1/org/announcements/${created.id}`,
			{ method: "DELETE", authToken: volunteerSession.token },
			403,
		);
		await makeAPIRequest(`/v1/org/announcements/${created.id}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		await makeAPIRequest(
			`/v1/org/announcements/${created.id}`,
			{ method: "PUT", authToken: coreSession.token, body: { pinned: false } },
			404,
		);
	});
});

describe("Organisation documents", () => {
	function uploadForm(name: string, parentId?: number) {
		const form = new FormData();
		form.append("file", new File(["Hallo Welt"], name, { type: "text/plain" }));
		if (parentId) form.append("parent_id", String(parentId));
		return form;
	}

	test("everyone reads, only the core team writes", async () => {
		await makeAPIRequest(
			"/v1/org/documents",
			{
				authToken: volunteerSession.token,
				additionalOptions: { method: "POST", body: uploadForm("leitfaden.txt") },
			},
			403,
		);

		const folder = await makeAPIRequest(
			"/v1/org/documents/folders",
			{
				method: "POST",
				authToken: coreSession.token,
				body: { name: "Leitfäden" },
				expectedBodySchema: OrgDocumentsModel.CreateFolder.Response,
			},
			201,
		);
		expect(folder.kind).toBe("folder");
		expect(folder.download_token).toBeNull();

		const file = await makeAPIRequest(
			"/v1/org/documents",
			{
				authToken: coreSession.token,
				additionalOptions: { method: "POST", body: uploadForm("leitfaden.txt", folder.id) },
				expectedBodySchema: OrgDocumentsModel.Upload.Response,
			},
			201,
		);
		expect(file.parent_id).toBe(folder.id);
		expect(file.scope).toBe("org");
		expect(file.size).toBe(10);
		expect(file.download_token).not.toBeNull();

		const root = await makeAPIRequest("/v1/org/documents", {
			authToken: volunteerSession.token,
			expectedBodySchema: OrgDocumentsModel.GetAll.Response,
		});
		expect(root.folder).toBeNull();
		expect(root.items.some((item) => item.id === folder.id)).toBe(true);

		const inside = await makeAPIRequest(`/v1/org/documents?parent_id=${folder.id}`, {
			authToken: volunteerSession.token,
			expectedBodySchema: OrgDocumentsModel.GetAll.Response,
		});
		expect(inside.folder?.id).toBe(folder.id);
		expect(inside.path.map((entry) => entry.id)).toEqual([folder.id]);
		expect(inside.items.map((item) => item.name)).toEqual(["leitfaden.txt"]);

		await makeAPIRequest(
			`/v1/org/documents?parent_id=${file.id}`,
			{ authToken: volunteerSession.token },
			404,
		);
		await makeAPIRequest(
			"/v1/org/documents/folders",
			{ method: "POST", authToken: coreSession.token, body: { name: "X", parent_id: file.id } },
			400,
		);
	});
});

describe("Organisation resources", () => {
	let resourceId: number;
	let eventA: DB.Models.Event;
	let eventB: DB.Models.Event;
	let eventC: DB.Models.Event;

	beforeAll(() => {
		eventA = seedEvent("Zeltlager A", "2027-08-01", "2027-08-10");
		eventB = seedEvent("Zeltlager B", "2027-08-05", "2027-08-12");
		eventC = seedEvent("Herbstfreizeit", "2027-10-01", "2027-10-05");
	});

	test("only the core team manages inventory", async () => {
		await makeAPIRequest(
			"/v1/org/resources",
			{ method: "POST", authToken: volunteerSession.token, body: { name: "Zelt" } },
			403,
		);

		const resource = await makeAPIRequest(
			"/v1/org/resources",
			{
				method: "POST",
				authToken: coreSession.token,
				body: { name: "Gruppenzelt", category: "Zelte", quantity: 2 },
				expectedBodySchema: OrgResourcesModel.Create.Response,
			},
			201,
		);
		expect(resource.bookings).toEqual([]);
		resourceId = resource.id;
	});

	test("bookings respect available units across overlapping events", async () => {
		await makeAPIRequest(
			`/v1/org/resources/${resourceId}/bookings`,
			{
				method: "POST",
				authToken: coreSession.token,
				body: { event_id: eventA.id, quantity: 2 },
				expectedBodySchema: OrgResourcesModel.CreateBooking.Response,
			},
			201,
		);

		await makeAPIRequest(
			`/v1/org/resources/${resourceId}/bookings`,
			{ method: "POST", authToken: coreSession.token, body: { event_id: eventB.id, quantity: 1 } },
			409,
		);

		const bookingC = await makeAPIRequest(
			`/v1/org/resources/${resourceId}/bookings`,
			{ method: "POST", authToken: coreSession.token, body: { event_id: eventC.id, quantity: 2 } },
			201,
		);

		const list = await makeAPIRequest("/v1/org/resources", {
			authToken: volunteerSession.token,
			expectedBodySchema: OrgResourcesModel.GetAll.Response,
		});
		const resource = list.find((entry) => entry.id === resourceId)!;
		expect(resource.bookings.map((booking) => booking.event.id).sort()).toEqual(
			[eventA.id, eventC.id].sort(),
		);
		expect(resource.booked_now).toBe(0);

		const forEvent = await makeAPIRequest(`/v1/org/resources/bookings?event_id=${eventC.id}`, {
			authToken: volunteerSession.token,
			expectedBodySchema: OrgResourcesModel.GetBookings.Response,
		});
		expect(forEvent.map((booking) => booking.resource.id)).toEqual([resourceId]);

		await makeAPIRequest(
			`/v1/org/resources/bookings/${bookingC.id}`,
			{ method: "DELETE", authToken: volunteerSession.token },
			403,
		);
		await makeAPIRequest(`/v1/org/resources/bookings/${bookingC.id}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		await makeAPIRequest(
			`/v1/org/resources/bookings/${bookingC.id}`,
			{ method: "DELETE", authToken: coreSession.token },
			404,
		);
	});

	test("update and delete", async () => {
		const updated = await makeAPIRequest(`/v1/org/resources/${resourceId}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { quantity: 3, location: "Lager Keller" },
			expectedBodySchema: OrgResourcesModel.Update.Response,
		});
		expect(updated.quantity).toBe(3);

		await makeAPIRequest(`/v1/org/resources/${resourceId}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		await makeAPIRequest(
			`/v1/org/resources/${resourceId}`,
			{ method: "PUT", authToken: coreSession.token, body: { quantity: 1 } },
			404,
		);
	});
});

describe("Core team area", () => {
	let event: DB.Models.Event;
	let overlappingEvent: DB.Models.Event;

	beforeAll(async () => {
		event = seedEvent("Sommerfreizeit 2031", "2031-07-01", "2031-07-10", {
			budget_cents: 500_000,
			participant_fee_cents: 25_000,
		});
		overlappingEvent = seedEvent("Kinderwoche 2031", "2031-07-08", "2031-07-12");

		await addEventMember(event.id, volunteer.id, "leader");
		await addEventMember(overlappingEvent.id, volunteer.id, "staff");

		DB.instance()
			.insert(DB.Tables.participants)
			.values([
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					first_name: "Mia",
					last_name: "Muster",
					birth_date: "2018-05-01",
					gender: "female",
				},
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					first_name: "Ben",
					last_name: "Beispiel",
					birth_date: "2016-01-01",
					gender: "male",
					status: "confirmed",
				},
				{
					org_id: OrgContext.id(),
					event_id: overlappingEvent.id,
					first_name: "Mia",
					last_name: "Muster",
					birth_date: "2018-05-01",
					gender: "female",
				},
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					first_name: "Abgesagt",
					last_name: "X",
					status: "cancelled",
				},
			])
			.run();

		DB.instance()
			.insert(DB.Tables.budgetItems)
			.values([
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					kind: "expense",
					category: "Essen",
					planned_cents: 200_000,
				},
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					kind: "income",
					category: "Zuschuss",
					planned_cents: 50_000,
				},
			])
			.run();

		DB.instance()
			.insert(DB.Tables.expenses)
			.values([
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					title: "Einkauf",
					category: "Essen",
					amount_cents: 12_000,
					spent_on: "2031-07-02",
					status: "approved",
				},
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					title: "Bastelmaterial",
					category: "Material",
					amount_cents: 3_000,
					spent_on: "2031-07-03",
					status: "submitted",
				},
				{
					org_id: OrgContext.id(),
					event_id: event.id,
					title: "Fahrt",
					category: "Fahrtkosten",
					amount_cents: 5_000,
					spent_on: "2031-07-04",
					status: "reimbursed",
				},
			])
			.run();
	});

	test("volunteers are locked out", async () => {
		for (const path of ["overview", "finances", "stats", "staff-planning", "notes"]) {
			await makeAPIRequest(`/v1/org/core-team/${path}`, { authToken: volunteerSession.token }, 403);
		}
	});

	test("overview", async () => {
		const overview = await makeAPIRequest("/v1/org/core-team/overview", {
			authToken: coreSession.token,
			expectedBodySchema: CoreTeamModel.Overview.Response,
		});
		expect(overview.totals.events).toBeGreaterThanOrEqual(2);
		expect(overview.pending_expenses.count).toBeGreaterThanOrEqual(1);
		expect(
			overview.upcoming_events.every((entry) => entry.unstaffed === (entry.leaders.length === 0)),
		).toBe(true);
	});

	test("finances", async () => {
		const finances = await makeAPIRequest("/v1/org/core-team/finances?year=2031", {
			authToken: coreSession.token,
			expectedBodySchema: CoreTeamModel.Finances.Response,
		});
		const row = finances.per_event.find((entry) => entry.event.id === event.id)!;
		expect(row.budget_cents).toBe(500_000);
		expect(row.planned_expense_cents).toBe(200_000);
		expect(row.planned_income_cents).toBe(50_000);
		expect(row.expected_fees_cents).toBe(50_000);
		expect(row.actual_expense_cents).toBe(17_000);
		expect(row.pending_expense_cents).toBe(3_000);
		expect(row.reimbursed_cents).toBe(5_000);
		expect(finances.per_event.every((entry) => entry.event.start_date.startsWith("2031"))).toBe(true);
		expect(finances.by_category[0]).toEqual({ category: "Essen", actual_cents: 12_000 });
	});

	test("stats", async () => {
		const stats = await makeAPIRequest("/v1/org/core-team/stats?year=2031", {
			authToken: coreSession.token,
			expectedBodySchema: CoreTeamModel.Stats.Response,
		});
		expect(stats.events_count).toBe(2);
		expect(stats.participants_total).toBe(3);
		expect(stats.gender.female).toBe(2);
		expect(stats.returning_participants).toBe(1);
		// Born 2018 and 2016 → 13 and 15 at the 2031 events (Mia counted once per event).
		expect(stats.age_buckets.find((bucket) => bucket.label === "13–15")?.count).toBe(3);
		expect(stats.age_buckets.find((bucket) => bucket.label === "unter 10")?.count).toBe(0);
		const engagement = stats.staff_engagement.find((entry) => entry.user.id === volunteer.id);
		expect(engagement).toEqual({
			user: expect.anything(),
			events_count: 2,
			leader_count: 1,
		});
	});

	test("staff planning flags overlapping assignments", async () => {
		await makeAPIRequest(
			"/v1/org/core-team/staff-planning?from=2031-12-01&to=2031-01-01",
			{ authToken: coreSession.token },
			400,
		);

		const planning = await makeAPIRequest(
			"/v1/org/core-team/staff-planning?from=2031-06-01&to=2031-08-31",
			{ authToken: coreSession.token, expectedBodySchema: CoreTeamModel.StaffPlanning.Response },
		);
		expect(planning.events.map((entry) => entry.id).sort()).toEqual(
			[event.id, overlappingEvent.id].sort(),
		);
		const row = planning.users.find((entry) => entry.user.id === volunteer.id)!;
		expect(row.assignments.length).toBe(2);
		expect(row.conflicts.length).toBe(1);
		expect(planning.unassigned_users.some((user) => user.id === core.id)).toBe(true);
		expect(planning.unassigned_users.some((user) => user.id === unverified.id)).toBe(
			// unverified was promoted to volunteer in an earlier test of this file
			true,
		);
	});

	test("core team notes", async () => {
		const note = await makeAPIRequest(
			"/v1/org/core-team/notes",
			{
				method: "POST",
				authToken: coreSession.token,
				body: { title: "Jahresplanung", content: "Termine sammeln" },
				expectedBodySchema: CoreTeamModel.Notes.Note,
			},
			201,
		);
		expect(note.scope).toBe("core_team");
		expect(note.can_delete).toBe(true);

		const edited = await makeAPIRequest(`/v1/org/core-team/notes/${note.id}`, {
			method: "PUT",
			authToken: core2Session.token,
			body: { content: "Termine bis Freitag sammeln" },
			expectedBodySchema: CoreTeamModel.Notes.Note,
		});
		expect(edited.updater?.id).toBe(core2.id);
		expect(edited.can_delete).toBe(false);

		const list = await makeAPIRequest("/v1/org/core-team/notes", {
			authToken: core2Session.token,
			expectedBodySchema: CoreTeamModel.Notes.GetAllResponse,
		});
		expect(list.some((entry) => entry.id === note.id)).toBe(true);

		await makeAPIRequest(
			`/v1/org/core-team/notes/${note.id}`,
			{ method: "DELETE", authToken: core2Session.token },
			403,
		);
		await makeAPIRequest(
			`/v1/org/core-team/notes/${note.id}`,
			{ method: "PUT", authToken: volunteerSession.token, body: { title: "X" } },
			403,
		);
		await makeAPIRequest(`/v1/org/core-team/notes/${note.id}`, {
			method: "DELETE",
			authToken: adminSession.token,
		});
		await makeAPIRequest(
			`/v1/org/core-team/notes/${note.id}`,
			{ method: "DELETE", authToken: coreSession.token },
			404,
		);
	});
});

describe("Housekeeping", () => {
	test("removes expired sessions, reset links, open invitations and old read notifications", async () => {
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");
		const now = Date.now();
		const db = DB.instance();
		const day = 24 * 60 * 60 * 1000;

		db
			.insert(DB.Tables.sessions)
			.values({
				org_id: OrgContext.id(),
				id: "expired-session",
				hashed_token: "x",
				user_id: volunteer.id,
				user_role: "volunteer",
				expires_at: now - 1,
			})
			.run();
		db
			.insert(DB.Tables.passwordResets)
			.values({
				org_id: OrgContext.id(),
				token: "expired-reset",
				user_id: volunteer.id,
				expires_at: now - 1,
			})
			.run();
		db
			.insert(DB.Tables.invitations)
			.values({
				org_id: OrgContext.id(),
				token_hash: "expired-invite",
				email: "alt@example.com",
				expires_at: now - 1,
			})
			.run();
		db
			.insert(DB.Tables.notifications)
			.values([
				{
					org_id: OrgContext.id(),
					user_id: volunteer.id,
					type: "system",
					title: "alt",
					read_at: now - 100 * day,
				},
				{ org_id: OrgContext.id(), user_id: volunteer.id, type: "system", title: "ungelesen" },
			])
			.run();

		const result = await Housekeeping.run(now);
		expect(result.sessions).toBeGreaterThanOrEqual(1);
		expect(result.passwordResets).toBeGreaterThanOrEqual(1);
		expect(result.invitations).toBeGreaterThanOrEqual(1);
		expect(result.notifications).toBeGreaterThanOrEqual(1);

		const titles = db
			.select()
			.from(DB.Tables.notifications)
			.all()
			.map((n) => n.title);
		expect(titles).toContain("ungelesen");
		expect(titles).not.toContain("alt");
		// The live session of the test user survives.
		await makeAPIRequest("/v1/account", { authToken: volunteerSession.token });
	});
});
