import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { API } from "../server/lib/api";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { type DnsLookup, DomainService } from "../server/lib/orgs/domains";
import { OrgRegistry } from "../server/lib/orgs/registry";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders, SYSTEM_HOST, TEST_HOST, testOrg } from "./helpers/orgs";
import { seedSession, seedUser } from "./helpers/seed";

const SYSTEM = { additionalOptions: { headers: hostHeaders(SYSTEM_HOST) } };

let systemToken: string;
let orgAdminToken: string;
let orgVolunteerToken: string;

/** Fake DNS: records per name, set by each test. */
const records: {
	txt: Record<string, string[]>;
	cname: Record<string, string[]>;
	a: Record<string, string[]>;
} = {
	txt: {},
	cname: {},
	a: {},
};
const fakeDns: DnsLookup = {
	async txt(name) {
		return records.txt[name] ?? [];
	},
	async cname(name) {
		return records.cname[name] ?? [];
	},
	async addresses(name) {
		return records.a[name] ?? [];
	},
};

function png(width: number, height: number) {
	const bytes = new Uint8Array(64);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

async function upload(
	kind: "logo" | "icon",
	bytes: Uint8Array,
	type: string,
	token = orgAdminToken,
) {
	const form = new FormData();
	form.append("file", new File([bytes as BlobPart], `upload.${type.split("/")[1]}`, { type }));
	return API.getApp().request(`/v1/admin/organization/assets/${kind}`, {
		method: "PUT",
		headers: { Authorization: `Bearer ${token}`, "X-Iventworks-Host": TEST_HOST },
		body: form,
	});
}

beforeAll(async () => {
	DomainService.useDns(fakeDns);

	const systemOrg = OrgRegistry.systemOrg()!;
	const systemAdmin = await OrgContext.run(systemOrg, () => seedUser("admin"));
	systemToken = (await OrgContext.run(systemOrg, () => seedSession(systemAdmin.id))).token;

	const admin = await seedUser("admin");
	orgAdminToken = (await seedSession(admin.id)).token;
	const volunteer = await seedUser("volunteer");
	orgVolunteerToken = (await seedSession(volunteer.id)).token;
});

afterAll(() => {
	DomainService.useDns(null);
});

describe("Instance info", () => {
	test("org host", async () => {
		const data = await makeAPIRequest("/v1/instance");
		expect(data.kind).toBe("org");
		expect(data.multi_org).toBe(true);
		expect(data.app_name).toBe("Iventworks");
		expect(data.org.slug).toBe("test");
		expect(data.org.primary_color).toBe("fuchsia");
		expect(data.org.url).toBe("http://test.localhost:31316");
		expect(data.org.logo_url).toBeNull();
		expect(data.redirect_to).toBeNull();
	});

	test("system host", async () => {
		const data = await makeAPIRequest("/v1/instance", SYSTEM);
		expect(data.kind).toBe("system");
		expect(data.org).toBeNull();
		expect(data.base_url).toBe("http://localhost:31316");
	});

	test("unknown host only serves the instance info", async () => {
		const unknown = { additionalOptions: { headers: hostHeaders("nobody.localhost") } };
		const data = await makeAPIRequest("/v1/instance", unknown);
		expect(data.kind).toBe("unknown");
		await makeAPIRequest(
			"/v1/auth/login",
			{ ...unknown, method: "POST", body: { username: "x", password: "y" } },
			404,
		);
		await makeAPIRequest("/v1/events", { ...unknown, authToken: orgAdminToken }, 404);
	});

	test("X-Iventworks-Host wins over X-Forwarded-Host and Host", async () => {
		const res = await API.getApp().request("/v1/instance", {
			headers: { "X-Iventworks-Host": "localhost", "X-Forwarded-Host": TEST_HOST, Host: TEST_HOST },
		});
		expect(((await res.json()) as any).data.kind).toBe("system");

		const forwarded = await API.getApp().request("/v1/instance", {
			headers: { "X-Forwarded-Host": TEST_HOST, Host: "localhost" },
		});
		expect(((await forwarded.json()) as any).data.kind).toBe("org");
	});

	test("default assets redirect, manifest names the org", async () => {
		const logo = await API.getApp().request("/v1/instance/logo", { headers: hostHeaders(TEST_HOST) });
		expect(logo.status).toBe(302);
		expect(logo.headers.get("location")).toBe("/static/brand/logo-on-dark.svg");

		const manifest = await API.getApp().request("/v1/instance/manifest.webmanifest", {
			headers: hostHeaders(TEST_HOST),
		});
		expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
		const body = (await manifest.json()) as any;
		expect(body.name).toBe(testOrg().display_name);
		expect(body.icons.length).toBe(3);
	});

	test("TLS check", async () => {
		const check = (domain: string) =>
			API.getApp().request(`/v1/instance/tls-check?domain=${domain}`, {
				headers: hostHeaders(SYSTEM_HOST),
			});
		expect((await check("test.localhost")).status).toBe(200);
		expect((await check("localhost")).status).toBe(200);
		expect((await check("nobody.localhost")).status).toBe(404);
		expect((await check("evil.example")).status).toBe(404);
	});
});

describe("System API", () => {
	let createdId: number;

	test("is only for system admins on the system host", async () => {
		await makeAPIRequest("/v1/system/orgs", { authToken: orgAdminToken }, 404);
		await makeAPIRequest("/v1/system/orgs", SYSTEM, 401);
		// An org admin's token is unknown on the system host.
		await makeAPIRequest("/v1/system/orgs", { ...SYSTEM, authToken: orgAdminToken }, 401);
	});

	test("the system host only serves sign-in, account and admin of system admins", async () => {
		await makeAPIRequest("/v1/events", { ...SYSTEM, authToken: systemToken }, 404);
		await makeAPIRequest("/v1/admin/organization", { ...SYSTEM, authToken: systemToken }, 404);
		await makeAPIRequest("/v1/admin/users", { ...SYSTEM, authToken: systemToken });
		await makeAPIRequest("/v1/account", { ...SYSTEM, authToken: systemToken });
	});

	test("validates slugs", async () => {
		for (const slug of ["a", "-abc", "abc-", "ab_c", "system", "admin", "www"]) {
			await makeAPIRequest(
				"/v1/system/orgs",
				{ ...SYSTEM, method: "POST", authToken: systemToken, body: { slug, display_name: "Name" } },
				400,
			);
		}
		await makeAPIRequest(
			"/v1/system/orgs",
			{
				...SYSTEM,
				method: "POST",
				authToken: systemToken,
				body: { slug: "test", display_name: "Dup" },
			},
			409,
		);
	});

	test("creates an org with an admin invitation", async () => {
		const data = await makeAPIRequest(
			"/v1/system/orgs",
			{
				...SYSTEM,
				method: "POST",
				authToken: systemToken,
				body: {
					slug: "crossover",
					display_name: "Crossover",
					primary_color: "orange",
					admin_email: "leitung@crossover.example",
				},
			},
			201,
		);
		createdId = data.org.id;
		expect(data.org.url).toBe("http://crossover.localhost:31316");
		expect(data.org.primary_color).toBe("orange");
		expect(data.invitation.invite_url).toStartWith(
			"http://crossover.localhost:31316/auth/accept-invite?token=",
		);

		// The invitation lives in the new org and makes an admin there.
		const info = await makeAPIRequest("/v1/instance", {
			additionalOptions: { headers: hostHeaders("crossover.localhost") },
		});
		expect(info.org.display_name).toBe("Crossover");
		const token = data.invitation.invite_url.split("token=")[1];
		const inspect = await makeAPIRequest("/v1/auth/invitations/inspect", {
			method: "POST",
			body: { token },
			additionalOptions: { headers: hostHeaders("crossover.localhost") },
		});
		expect(inspect.role).toBe("admin");
		// …and not in the test org.
		const elsewhere = await API.getApp().request("/v1/auth/invitations/inspect", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...hostHeaders(TEST_HOST) },
			body: JSON.stringify({ token }),
		});
		expect(elsewhere.status).toBeGreaterThanOrEqual(400);
	});

	test("lists, updates and audits", async () => {
		const list = await makeAPIRequest("/v1/system/orgs", { ...SYSTEM, authToken: systemToken });
		expect(list.map((o: any) => o.slug)).toContain("crossover");
		expect(list.map((o: any) => o.slug)).not.toContain("system");

		const updated = await makeAPIRequest(`/v1/system/orgs/${createdId}`, {
			...SYSTEM,
			method: "PUT",
			authToken: systemToken,
			body: { display_name: "Crossover e.V." },
		});
		expect(updated.display_name).toBe("Crossover e.V.");
		expect(OrgRegistry.get(createdId)?.display_name).toBe("Crossover e.V.");

		const log = await makeAPIRequest("/v1/admin/audit-log", { ...SYSTEM, authToken: systemToken });
		expect(log.entries.some((e: any) => e.entity_type === "org" && e.action === "create")).toBe(true);
	});

	test("the system org is not addressable", async () => {
		const systemOrg = OrgRegistry.systemOrg()!;
		await makeAPIRequest(
			`/v1/system/orgs/${systemOrg.id}`,
			{ ...SYSTEM, authToken: systemToken },
			404,
		);
		await makeAPIRequest(
			`/v1/system/orgs/${systemOrg.id}`,
			{ ...SYSTEM, method: "DELETE", authToken: systemToken },
			404,
		);
	});

	test("deleting an org removes its data", async () => {
		const org = OrgRegistry.get(createdId)!;
		await OrgContext.run(org, async () => {
			const user = await seedUser("admin", { username: "willgo" });
			await DB.instance()
				.insert(DB.Tables.events)
				.values({
					org_id: org.id,
					name: "Weg",
					start_date: "2027-01-01",
					end_date: "2027-01-02",
					created_by: user.id,
				})
				.run();
		});

		await makeAPIRequest(`/v1/system/orgs/${createdId}`, {
			...SYSTEM,
			method: "DELETE",
			authToken: systemToken,
		});
		expect(OrgRegistry.get(createdId)).toBeNull();
		const left = await OrgContext.unscoped(async () => ({
			users: await DB.instance()
				.select()
				.from(DB.Tables.users)
				.where(eq(DB.Tables.users.org_id, createdId))
				.all(),
			events: await DB.instance()
				.select()
				.from(DB.Tables.events)
				.where(eq(DB.Tables.events.org_id, createdId))
				.all(),
		}));
		expect(left.users.length).toBe(0);
		expect(left.events.length).toBe(0);
		const info = await makeAPIRequest("/v1/instance", {
			additionalOptions: { headers: hostHeaders("crossover.localhost") },
		});
		expect(info.kind).toBe("unknown");
	});
});

describe("Organisation settings (org admins)", () => {
	test("only admins", async () => {
		await makeAPIRequest("/v1/admin/organization", { authToken: orgVolunteerToken }, 403);
	});

	test("rename and recolour", async () => {
		const data = await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: orgAdminToken,
			body: { display_name: "Test-Org umbenannt", primary_color: "sky" },
		});
		expect(data.org.display_name).toBe("Test-Org umbenannt");
		expect(data.org.primary_color).toBe("sky");
		expect(data.org.slug).toBe("test");
		const info = await makeAPIRequest("/v1/instance");
		expect(info.org.primary_color).toBe("sky");

		await makeAPIRequest(
			"/v1/admin/organization",
			{ method: "PUT", authToken: orgAdminToken, body: { primary_color: "beige" } },
			400,
		);
		await makeAPIRequest(
			"/v1/admin/organization",
			{ method: "PUT", authToken: orgAdminToken, body: {} },
			400,
		);
	});

	test("icon: square PNG ≥ 192 px or SVG", async () => {
		expect((await upload("icon", png(100, 100), "image/png")).status).toBe(400);
		expect((await upload("icon", png(512, 256), "image/png")).status).toBe(400);
		expect((await upload("icon", new TextEncoder().encode("GIF89a"), "image/gif")).status).toBe(400);

		const ok = await upload("icon", png(512, 512), "image/png");
		expect(ok.status).toBe(200);
		const info = await makeAPIRequest("/v1/instance");
		expect(info.org.icon_url).toStartWith("/api/v1/instance/icon?v=");

		const icon = await API.getApp().request("/v1/instance/icon", { headers: hostHeaders(TEST_HOST) });
		expect(icon.status).toBe(200);
		expect(icon.headers.get("content-type")).toBe("image/png");

		const manifest = (await (
			await API.getApp().request("/v1/instance/manifest.webmanifest", {
				headers: hostHeaders(TEST_HOST),
			})
		).json()) as any;
		expect(manifest.icons[0].sizes).toBe("512x512");

		// The type comes from the bytes, not from what the client claims.
		expect((await upload("icon", png(512, 512), "image/svg+xml")).status).toBe(200);
		const again = await API.getApp().request("/v1/instance/icon", {
			headers: hostHeaders(TEST_HOST),
		});
		expect(again.headers.get("content-type")).toBe("image/png");
	});

	test("logo: unsafe SVG rejected, safe SVG served sandboxed", async () => {
		const evil = [
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.example/x.png"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
		];
		for (const svg of evil) {
			expect((await upload("logo", new TextEncoder().encode(svg), "image/svg+xml")).status).toBe(400);
		}

		const safe =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f0f"/></svg>';
		expect((await upload("logo", new TextEncoder().encode(safe), "image/svg+xml")).status).toBe(200);
		const logo = await API.getApp().request("/v1/instance/logo", { headers: hostHeaders(TEST_HOST) });
		expect(logo.headers.get("content-type")).toBe("image/svg+xml");
		expect(logo.headers.get("content-security-policy")).toContain("sandbox");
		expect(logo.headers.get("x-content-type-options")).toBe("nosniff");

		// Another org's host doesn't serve it.
		const otherLogo = await API.getApp().request("/v1/instance/logo", {
			headers: hostHeaders("localhost"),
		});
		expect(otherLogo.status).toBe(302);

		await makeAPIRequest("/v1/admin/organization/assets/logo", {
			method: "DELETE",
			authToken: orgAdminToken,
		});
		const info = await makeAPIRequest("/v1/instance");
		expect(info.org.logo_url).toBeNull();
	});

	test("too large", async () => {
		const big = new Uint8Array(600 * 1024);
		big.set(png(512, 512));
		expect((await upload("icon", big, "image/png")).status).toBe(400);
	});
});

describe("Custom domains", () => {
	let domainId: number;
	let txtName: string;
	let txtValue: string;

	test("add validates and returns the DNS records", async () => {
		for (const domain of ["not a domain", "localhost", "x.test.localhost", "127.0.0.1"]) {
			await makeAPIRequest(
				"/v1/admin/organization/domains",
				{ method: "POST", authToken: orgAdminToken, body: { domain } },
				400,
			);
		}

		const data = await makeAPIRequest(
			"/v1/admin/organization/domains",
			{ method: "POST", authToken: orgAdminToken, body: { domain: "https://Plan.Example.org/" } },
			201,
		);
		domainId = data.id;
		expect(data.domain).toBe("plan.example.org");
		expect(data.verified).toBe(false);
		expect(data.dns.txt_name).toBe("_iventworks-challenge.plan.example.org");
		expect(data.dns.cname_target).toBe("test.localhost");
		txtName = data.dns.txt_name;
		txtValue = data.dns.txt_value;

		await makeAPIRequest(
			"/v1/admin/organization/domains",
			{ method: "POST", authToken: orgAdminToken, body: { domain: "plan.example.org" } },
			409,
		);
	});

	test("a pending domain does not serve the org", async () => {
		expect(OrgRegistry.resolveHost("plan.example.org").kind).toBe("unknown");
	});

	test("another org can't take it", async () => {
		const { OrgService } = await import("../server/lib/orgs/service");
		const other = await OrgService.create({ slug: "domain-rival", display_name: "Rival" });
		try {
			await OrgContext.run(other, async () => {
				await expect(DomainService.add("plan.example.org")).rejects.toThrow(/another organisation/);
			});
		} finally {
			await OrgService.delete(other.id);
		}
	});

	test("verification needs TXT and CNAME", async () => {
		let data = await makeAPIRequest(`/v1/admin/organization/domains/${domainId}/verify`, {
			method: "POST",
			authToken: orgAdminToken,
		});
		expect(data.verified).toBe(false);
		expect(data.last_check_error).toContain("TXT");

		records.txt[txtName] = [txtValue];
		data = await makeAPIRequest(`/v1/admin/organization/domains/${domainId}/verify`, {
			method: "POST",
			authToken: orgAdminToken,
		});
		expect(data.verified).toBe(false);
		expect(data.last_check_error).toContain("CNAME");

		records.cname["plan.example.org"] = ["test.localhost"];
		data = await makeAPIRequest(`/v1/admin/organization/domains/${domainId}/verify`, {
			method: "POST",
			authToken: orgAdminToken,
		});
		expect(data.verified).toBe(true);
		expect(data.is_primary).toBe(true);
	});

	test("the verified primary domain serves the org and the default domain redirects", async () => {
		const resolution = OrgRegistry.resolveHost("plan.example.org");
		expect(resolution.kind).toBe("org");
		expect(resolution.kind === "org" && resolution.org.slug).toBe("test");

		const info = await makeAPIRequest("/v1/instance");
		expect(info.redirect_to).toBe("http://plan.example.org:31316");
		expect(info.org.url).toBe("http://plan.example.org:31316");

		const onPrimary = await makeAPIRequest("/v1/instance", {
			additionalOptions: { headers: hostHeaders("plan.example.org") },
		});
		expect(onPrimary.redirect_to).toBeNull();
		// The API still answers on the default domain.
		await makeAPIRequest("/v1/account", { authToken: orgAdminToken });
		// And the same session works on the custom domain (same org).
		await makeAPIRequest("/v1/account", {
			authToken: orgAdminToken,
			additionalOptions: { headers: hostHeaders("plan.example.org") },
		});
	});

	test("apex domains may use flattened addresses instead of a CNAME", async () => {
		const added = await makeAPIRequest(
			"/v1/admin/organization/domains",
			{ method: "POST", authToken: orgAdminToken, body: { domain: "example.net" } },
			201,
		);
		records.txt[added.dns.txt_name] = [added.dns.txt_value];
		records.a["example.net"] = ["203.0.113.7"];
		records.a["test.localhost"] = ["203.0.113.7"];
		const data = await makeAPIRequest(`/v1/admin/organization/domains/${added.id}/verify`, {
			method: "POST",
			authToken: orgAdminToken,
		});
		expect(data.verified).toBe(true);
		// The first verified domain stays primary.
		expect(data.is_primary).toBe(false);

		const primary = await makeAPIRequest(`/v1/admin/organization/domains/${added.id}`, {
			method: "PUT",
			authToken: orgAdminToken,
			body: { is_primary: true },
		});
		expect(primary.is_primary).toBe(true);
		const list = await makeAPIRequest("/v1/admin/organization/domains", { authToken: orgAdminToken });
		expect(list.filter((d: any) => d.is_primary).length).toBe(1);

		await makeAPIRequest(`/v1/admin/organization/domains/${added.id}`, {
			method: "DELETE",
			authToken: orgAdminToken,
		});
		// The other verified domain takes over as primary.
		const after = await makeAPIRequest("/v1/admin/organization/domains", {
			authToken: orgAdminToken,
		});
		expect(after.find((d: any) => d.id === domainId).is_primary).toBe(true);
	});

	test("unsetting the primary domain stops the redirect", async () => {
		await makeAPIRequest(`/v1/admin/organization/domains/${domainId}`, {
			method: "PUT",
			authToken: orgAdminToken,
			body: { is_primary: false },
		});
		const info = await makeAPIRequest("/v1/instance");
		expect(info.redirect_to).toBeNull();
		await makeAPIRequest(`/v1/admin/organization/domains/${domainId}`, {
			method: "DELETE",
			authToken: orgAdminToken,
		});
		expect(OrgRegistry.resolveHost("plan.example.org").kind).toBe("unknown");
	});

	test("system admins manage domains of an org", async () => {
		const org = testOrg();
		const added = await makeAPIRequest(
			`/v1/system/orgs/${org.id}/domains`,
			{
				...SYSTEM,
				method: "POST",
				authToken: systemToken,
				body: { domain: "system-added.example.com" },
			},
			201,
		);
		const own = await makeAPIRequest("/v1/admin/organization/domains", { authToken: orgAdminToken });
		expect(own.map((d: any) => d.domain)).toContain("system-added.example.com");
		await makeAPIRequest(`/v1/system/orgs/${org.id}/domains/${added.id}`, {
			...SYSTEM,
			method: "DELETE",
			authToken: systemToken,
		});

		// The audit entry is in the system log, not the org's.
		const orgLog = await makeAPIRequest("/v1/admin/audit-log?search=system-added", {
			authToken: orgAdminToken,
		});
		expect(orgLog.total).toBe(0);
		const systemLog = await makeAPIRequest("/v1/admin/audit-log?search=system-added", {
			...SYSTEM,
			authToken: systemToken,
		});
		expect(systemLog.total).toBeGreaterThan(0);
	});

	test("pending domains are checked by the cron job", async () => {
		const added = await makeAPIRequest(
			"/v1/admin/organization/domains",
			{ method: "POST", authToken: orgAdminToken, body: { domain: "later.example.com" } },
			201,
		);
		expect(await DomainService.verifyPending()).toBe(0);
		records.txt[added.dns.txt_name] = [added.dns.txt_value];
		records.cname["later.example.com"] = ["test.localhost"];
		expect(await DomainService.verifyPending()).toBe(1);
		const row = await OrgContext.unscoped(() =>
			DB.instance()
				.select()
				.from(DB.Tables.orgDomains)
				.where(and(eq(DB.Tables.orgDomains.id, added.id)))
				.get(),
		);
		expect(row?.verified_at).not.toBeNull();
		await makeAPIRequest(`/v1/admin/organization/domains/${added.id}`, {
			method: "DELETE",
			authToken: orgAdminToken,
		});
	});
});
