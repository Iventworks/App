/**
 * Usernames built from first and last name by the org's schema (the default), and the switch to
 * free choice. Existing usernames are never changed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { type CapturedEmail, EmailService } from "../server/lib/api/utils/email";
import { AccountModel } from "../server/lib/api/versions/v1/routes/account/model";
import { AdminOrganizationModel } from "../server/lib/api/versions/v1/routes/admin/organization/model";
import { AdminUsersModel } from "../server/lib/api/versions/v1/routes/admin/users/model";
import { AuthInvitationsModel } from "../server/lib/api/versions/v1/routes/auth/invitations/model";
import { DB } from "../server/lib/db";
import { UsernameSchema } from "../server/lib/utils/usernameSchema";
import { makeAPIRequest } from "./helpers/api";
import { createMemoryTransport } from "./helpers/memory-transport";
import { setTestOrgUsernameMode } from "./helpers/orgs";
import { type SeededSession, type SeededUser, seedSession, seedUser } from "./helpers/seed";

describe("UsernameSchema", () => {
	const generate = (first: string, last: string, schema = UsernameSchema.DEFAULT) =>
		UsernameSchema.generate(schema, first, last);

	test("first of the first names and the whole last name", () => {
		expect(generate("Max", "Mustermann")).toBe("max.mustermann");
		expect(generate("Anna Maria", "Schmidt")).toBe("anna.schmidt");
		expect(generate("  Anna   Maria ", " Schmidt ")).toBe("anna.schmidt");
		expect(generate("Hans-Peter", "Müller-Lüdenscheidt")).toBe("hans-peter.mueller-luedenscheidt");
		expect(generate("Ursula", "von der Leyen")).toBe("ursula.von-der-leyen");
	});

	test("umlauts spelled out, accents dropped, other characters removed", () => {
		expect(generate("Jürgen", "Weiß")).toBe("juergen.weiss");
		expect(generate("ÄNNE", "ÖZTÜRK")).toBe("aenne.oeztuerk");
		expect(generate("Zoë", "Lefèvre")).toBe("zoe.lefevre");
		expect(generate("Seán", "O'Brien")).toBe("sean.obrien");
		expect(generate("Łukasz", "Søren")).toBe("lukasz.soeren");
	});

	test("other placeholders and literals", () => {
		expect(generate("Max", "Mustermann", "{FIRSTNAME_INITIAL}{LASTNAME}")).toBe("mmustermann");
		expect(generate("Max", "Mustermann", "{LASTNAME}_{FIRSTNAME_INITIAL}")).toBe("mustermann_m");
		expect(generate("Max", "Mustermann", "{firstname}-{lastname}")).toBe("max-mustermann");
	});

	test("the result always follows the username policy", () => {
		// Separators don't double up or end the name.
		expect(generate("Max", "-")).toBe("max");
		expect(generate("Max", "Mustermann", "{FIRSTNAME}..{LASTNAME}.")).toBe("max.mustermann");
		// Too long: cut to 40.
		const long = generate("Maximilian", "Mustermann-Musterfrau-Beispielmensch");
		expect(long.length).toBeLessThanOrEqual(40);
		expect(UsernameSchema.isValid(long)).toBe(true);
		// Nothing usable.
		expect(generate("💥", "!!!")).toBe("");
	});

	test("candidates: a number is appended, the result stays valid", () => {
		expect(UsernameSchema.candidate("max.mustermann", 0)).toBe("max.mustermann");
		expect(UsernameSchema.candidate("max.mustermann", 1)).toBe("max.mustermann2");
		expect(UsernameSchema.candidate("max.mustermann", 9)).toBe("max.mustermann10");
		// Too short alone, fine with a number.
		expect(UsernameSchema.candidate("a.li", 0)).toBeNull();
		expect(UsernameSchema.candidate("a.li", 1)).toBe("a.li2");
		// A 40-character base is shortened to fit the number.
		const base = "a".repeat(40);
		expect(UsernameSchema.candidate(base, 1)).toBe(`${"a".repeat(39)}2`);
	});

	test("validate", () => {
		expect(UsernameSchema.validate("{FIRSTNAME}.{LASTNAME}")).toBeNull();
		expect(UsernameSchema.validate("{LASTNAME}")).toBeNull();
		expect(UsernameSchema.validate("")).not.toBeNull();
		expect(UsernameSchema.validate("team.{FIRSTNAME_INITIAL}")).not.toBeNull();
		expect(UsernameSchema.validate("{FIRSTNAME}.{NAME}")).not.toBeNull();
		expect(UsernameSchema.validate("{FIRSTNAME} {LASTNAME}")).not.toBeNull();
		expect(UsernameSchema.validate("{FIRSTNAME}/{LASTNAME}")).not.toBeNull();
	});
});

let admin: SeededUser;
let adminSession: SeededSession;
let coreSession: SeededSession;

beforeAll(async () => {
	admin = await seedUser("admin");
	adminSession = await seedSession(admin.id);
	coreSession = await seedSession((await seedUser("core_team")).id);
});

afterAll(() => setTestOrgUsernameMode("schema", UsernameSchema.DEFAULT));

describe("Organisation setting", () => {
	test("schema is the default; only admins change it, invalid schemas are rejected", async () => {
		const settings = await makeAPIRequest("/v1/admin/organization", {
			authToken: adminSession.token,
			expectedBodySchema: AdminOrganizationModel.Settings,
		});
		expect(settings.accounts).toEqual({
			username_mode: "schema",
			username_schema: "{FIRSTNAME}.{LASTNAME}",
		});

		await makeAPIRequest(
			"/v1/admin/organization",
			{ method: "PUT", authToken: coreSession.token, body: { username_mode: "free" } },
			403,
		);
		for (const username_schema of ["{VORNAME}.{NACHNAME}", "{FIRSTNAME} {LASTNAME}", "admin"]) {
			await makeAPIRequest(
				"/v1/admin/organization",
				{ method: "PUT", authToken: adminSession.token, body: { username_schema } },
				400,
			);
		}

		const updated = await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: adminSession.token,
			body: { username_schema: "{FIRSTNAME_INITIAL}{LASTNAME}" },
			expectedBodySchema: AdminOrganizationModel.Settings,
		});
		expect(updated.accounts.username_schema).toBe("{FIRSTNAME_INITIAL}{LASTNAME}");

		// Free mode keeps the schema for later.
		const free = await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: adminSession.token,
			body: { username_mode: "free" },
		});
		expect(free.accounts).toEqual({
			username_mode: "free",
			username_schema: "{FIRSTNAME_INITIAL}{LASTNAME}",
		});

		const log = DB.instance()
			.select()
			.from(DB.Tables.auditLogs)
			.where(eq(DB.Tables.auditLogs.entity_type, "organization"))
			.all();
		expect(log.some((entry) => entry.summary.includes("Benutzernamen frei wählbar"))).toBe(true);

		await setTestOrgUsernameMode("schema", UsernameSchema.DEFAULT);
	});
});

describe("Creating accounts under the schema", () => {
	const create = (body: Record<string, unknown>, status = 201) =>
		makeAPIRequest(
			"/v1/admin/users",
			{
				method: "POST",
				authToken: adminSession.token,
				body: { email: `${randomUUID()}@example.com`, role: "volunteer", ...body },
			},
			status,
		);

	test("admins give the name; the username follows the schema, with a number when taken", async () => {
		await create({ display_name: "Ohne Namen", username: "ohne.namen" }, 400);
		await create({ display_name: "Nur Vorname", first_name: "Nur" }, 400);

		const first = await create({
			first_name: "Ida Marie",
			last_name: "Größer",
			display_name: "Ida Größer",
			// Ignored under a schema.
			username: "selbst.gewaehlt",
			password: "Direkt!Pass123",
		});
		expect(AdminUsersModel.Create.Response.parse(first).user.username).toBe("ida.groesser");

		const second = await create({ first_name: "Ida", last_name: "Grösser", display_name: "Ida 2" });
		expect(second.user.username).toBe("ida.groesser2");
		const third = await create({ first_name: "Ida", last_name: "Größer", display_name: "Ida 3" });
		expect(third.user.username).toBe("ida.groesser3");

		await create({ first_name: "!!!", last_name: "???", display_name: "Kein Name" }, 400);

		// The new account signs in with its generated username.
		await makeAPIRequest("/v1/auth/login", {
			method: "POST",
			body: { username: "ida.groesser", password: "Direkt!Pass123" },
		});
	});

	test("invitees give their name; the username follows the schema", async () => {
		const captured: CapturedEmail[] = [];
		EmailService.init(createMemoryTransport(captured));
		const email = `invitee-${randomUUID().slice(0, 8)}@example.com`;
		const issued = await makeAPIRequest("/v1/admin/invitations", {
			method: "POST",
			authToken: adminSession.token,
			body: { email, display_name: "Jonas Ölmann", role: "volunteer" },
		});
		EmailService.reset();
		const token = new URL(issued.invite_url).searchParams.get("token")!;

		const info = await makeAPIRequest("/v1/auth/invitations/inspect", {
			method: "POST",
			body: { token },
			expectedBodySchema: AuthInvitationsModel.Inspect.Response,
		});
		expect(info.username_schema).toBe("{FIRSTNAME}.{LASTNAME}");

		// A picked username alone is not enough under a schema.
		await makeAPIRequest(
			"/v1/auth/invitations/accept",
			{
				method: "POST",
				body: { token, username: "jonas.frei", display_name: "Jonas", password: "Invit3d!Pass" },
			},
			400,
		);

		const session = await makeAPIRequest(
			"/v1/auth/invitations/accept",
			{
				method: "POST",
				body: {
					token,
					first_name: "Jonas Elias",
					last_name: "Ölmann",
					display_name: "Jonas Ölmann",
					password: "Invit3d!Pass",
				},
				expectedBodySchema: AuthInvitationsModel.Accept.Response,
			},
			201,
		);
		const account = await makeAPIRequest("/v1/account", {
			authToken: session.token,
			expectedBodySchema: AccountModel.GetInfo.Response,
		});
		expect(account.username).toBe("jonas.oelmann");
		expect(account.username_managed).toBe(true);
	});

	test("nobody renames themselves under a schema; existing names stay; free mode allows it", async () => {
		const person = await seedUser("volunteer", { username: "alter_name" });
		const session = await seedSession(person.id);
		const rename = (username: string, status?: number) =>
			makeAPIRequest(
				"/v1/account",
				{
					method: "PUT",
					authToken: session.token,
					body: { username, current_password: person.password },
				},
				status,
			);

		await rename("neuer.name", 403);
		// Other fields still work, and sending the unchanged username is fine.
		await makeAPIRequest("/v1/account", {
			method: "PUT",
			authToken: session.token,
			body: { username: "alter_name", display_name: "Neu", current_password: person.password },
		});
		const row = DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, person.id))
			.get();
		expect(row?.username).toBe("alter_name");
		expect(row?.display_name).toBe("Neu");

		// Admins can still change it.
		await makeAPIRequest(`/v1/admin/users/${person.id}`, {
			method: "PUT",
			authToken: adminSession.token,
			body: { username: "vom.admin" },
		});

		await setTestOrgUsernameMode("free");
		try {
			const account = await makeAPIRequest("/v1/account", {
				authToken: session.token,
				expectedBodySchema: AccountModel.GetInfo.Response,
			});
			expect(account.username_managed).toBe(false);
			await rename("selbst.gewaehlt");
		} finally {
			await setTestOrgUsernameMode("schema");
		}
	});

	test("free mode: admins pick the username, names are not needed", async () => {
		await setTestOrgUsernameMode("free");
		try {
			await create({ display_name: "Ohne Benutzername", first_name: "A", last_name: "B" }, 400);
			const created = await create({ display_name: "Frei", username: "frei.gewaehlt" });
			expect(created.user.username).toBe("frei.gewaehlt");
		} finally {
			await setTestOrgUsernameMode("schema");
		}
	});
});
