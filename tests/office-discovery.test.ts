/**
 * The office server's WOPI discovery (`OfficeDiscovery`), fetched from a stand-in office server:
 * parsing, editor URLs on the public address, and keeping the last good keys when a refresh fails.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OfficeDiscovery } from "../server/lib/office/discovery";
import { ConfigHandler } from "../server/lib/utils/config";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<wopi-discovery>
	<net-zone name="external-http">
		<app name="Word">
			<action name="edit" ext="docx" urlsrc="http://office/hosting/wopi/word/edit?&lt;ui=UI_LLCC&amp;&gt;&lt;rs=DC_LLCC&amp;&gt;" />
			<action name="view" ext="docx" urlsrc="http://office/hosting/wopi/word/view?&lt;ui=UI_LLCC&amp;&gt;" />
		</app>
	</net-zone>
	<proof-key value="x" modulus="bmV3" exponent="AQAB" oldvalue="y" oldmodulus="b2xk" oldexponent="AQAB" />
</wopi-discovery>`;

let up = true;
let server: ReturnType<typeof Bun.serve>;
let saved: { url?: string; internal?: string };

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch: () => (up ? new Response(XML) : new Response("restarting", { status: 502 })),
	});
	const config = ConfigHandler.getConfig()!;
	saved = { url: config.OFFICE_URL, internal: config.OFFICE_INTERNAL_URL };
	config.OFFICE_URL = "https://office.example.org";
	config.OFFICE_INTERNAL_URL = server.url.origin;
	OfficeDiscovery.setForTests(null);
});

afterAll(() => {
	const config = ConfigHandler.getConfig()!;
	config.OFFICE_URL = saved.url;
	config.OFFICE_INTERNAL_URL = saved.internal;
	OfficeDiscovery.setForTests(null);
	server.stop(true);
});

describe("Office discovery", () => {
	const HOUR = 60 * 60 * 1000;
	const start = Date.now();

	test("actions and both proof keys; editors open on the public address", async () => {
		const discovery = await OfficeDiscovery.get(start);
		expect(discovery?.proofKey).toEqual({ modulus: "bmV3", exponent: "AQAB" });
		expect(discovery?.oldProofKey).toEqual({ modulus: "b2xk", exponent: "AQAB" });

		const choice = OfficeDiscovery.actionFor(discovery!, "DOCX", true);
		expect(choice?.mode).toBe("edit");
		expect(OfficeDiscovery.editorUrl(choice!.action, "https://org.test/api/v1/wopi/files/1-a")).toBe(
			"https://office.example.org/hosting/wopi/word/edit?ui=de-DE&rs=de-DE&WOPISrc=https%3A%2F%2Forg.test%2Fapi%2Fv1%2Fwopi%2Ffiles%2F1-a",
		);
	});

	test("a failed refresh keeps the keys it had", async () => {
		const before = await OfficeDiscovery.get(start);
		up = false;
		// The hourly refresh while the office server restarts, then a reload after a failed proof.
		expect(await OfficeDiscovery.get(start + HOUR + 1)).toBe(before);
		expect(await OfficeDiscovery.reload(start + HOUR + 2 * 60 * 1000)).toBe(before);

		up = true;
		const after = await OfficeDiscovery.reload(start + HOUR + 4 * 60 * 1000);
		expect(after).not.toBe(before);
		expect(after?.proofKey).toEqual(before?.proofKey);
	});
});
