import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp, eventHandler, toWebHandler } from "h3";
import { OrgContext } from "../server/lib/orgs/context";
import { DomainService } from "../server/lib/orgs/domains";
import { OrgService } from "../server/lib/orgs/service";
import redirectMiddleware from "../server/middleware/org-redirect";

// The Nitro middleware that sends page loads to an org's primary custom domain.
const app = createApp();
app.use(redirectMiddleware);
app.use(eventHandler(() => "page"));
const handle = toWebHandler(app);

const request = (host: string, path = "/events/3?tab=x", method = "GET") =>
	handle(new Request(`http://${host}${path}`, { method, headers: { host } }));

let orgId: number;

beforeAll(async () => {
	const org = await OrgService.create({ slug: "redirecting", display_name: "Redirecting" });
	orgId = org.id;
	DomainService.useDns({
		txt: async () => [],
		cname: async (name) => (name === "camp.example.org" ? ["redirecting.localhost"] : []),
		addresses: async () => [],
	});
	await OrgContext.run(org, async () => {
		const domain = await DomainService.add("camp.example.org");
		DomainService.useDns({
			txt: async (name) => (name === domain.dns.txt_name ? [domain.dns.txt_value] : []),
			cname: async (name) => (name === "camp.example.org" ? ["redirecting.localhost"] : []),
			addresses: async () => [],
		});
		const verified = await DomainService.verify(domain.id);
		expect(verified.is_primary).toBe(true);
	});
});

afterAll(async () => {
	DomainService.useDns(null);
	await OrgService.delete(orgId);
});

describe("Primary domain redirect", () => {
	test("page loads on the default domain go to the primary domain, path and query kept", async () => {
		const res = await request("redirecting.localhost:31316");
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("http://camp.example.org:31316/events/3?tab=x");
	});

	test("the primary domain itself is served", async () => {
		const res = await request("camp.example.org");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("page");
	});

	test("API requests are answered on every host", async () => {
		const res = await request("redirecting.localhost", "/api/v1/instance");
		expect(res.status).toBe(200);
	});

	test("only GET/HEAD page loads redirect", async () => {
		const res = await request("redirecting.localhost", "/", "POST");
		expect(res.status).toBe(200);
	});

	test("other orgs and unknown hosts are left alone", async () => {
		expect((await request("test.localhost")).status).toBe(200);
		expect((await request("nobody.localhost")).status).toBe(200);
		expect((await request("localhost")).status).toBe(200);
	});

	test("X-Iventworks-Host decides, like in the API", async () => {
		const res = await handle(
			new Request("http://localhost/", {
				headers: { host: "localhost", "x-iventworks-host": "redirecting.localhost" },
			}),
		);
		expect(res.status).toBe(302);
	});
});
