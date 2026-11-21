/**
 * The office server's WOPI discovery (`OfficeDiscovery`), fetched from a stand-in office server:
 * parsing, editor URLs on the public address, keeping the last good keys when a refresh fails, the
 * office settings and proof keys across a key change.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { OfficeDiscovery } from "../server/lib/office/discovery";
import { WopiProof } from "../server/lib/office/proof";
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

describe("Office settings", () => {
	const APP_URL = "https://app.example.org";

	test("a host of its own, as an http(s) address", () => {
		expect(OfficeDiscovery.validate({ APP_URL })).toEqual([]);
		expect(
			OfficeDiscovery.validate({
				APP_URL,
				OFFICE_URL: "https://office.ivb.example.org",
				OFFICE_INTERNAL_URL: "http://office",
			}),
		).toEqual([]);

		const errors = (OFFICE_URL: string) => OfficeDiscovery.validate({ APP_URL, OFFICE_URL });
		expect(errors("office.ivb.example.org")[0]).toContain("http(s) address");
		expect(errors("https://app.example.org:8443")[0]).toContain("not be the app's own host");
		expect(errors("https://office.example.org/office")[0]).toContain("without a path");
		expect(OfficeDiscovery.validate({ APP_URL, OFFICE_INTERNAL_URL: "http://office" })[0]).toContain(
			"needs IVENTWORKS_OFFICE_URL",
		);
	});
});

describe("Proof keys", () => {
	const pair = () => {
		const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const jwk = publicKey.export({ format: "jwk" });
		const b64 = (value: string | undefined) =>
			Buffer.from(value as string, "base64url").toString("base64");
		return { privateKey, key: { modulus: b64(jwk.n), exponent: b64(jwk.e) } };
	};
	const oldPair = pair();
	const newPair = pair();
	const url = "https://org.test/api/v1/wopi/files/1-0123456789abcdef?access_token=t";
	const now = Date.now();
	const timestamp = WopiProof.msToTicks(now);
	const signed = (privateKey: KeyObject) =>
		sign("RSA-SHA256", WopiProof.expected("t", url, timestamp), privateKey).toString("base64");
	const check = (
		proof: string,
		proofOld: string | undefined,
		current: OfficeDiscovery.ProofKey,
		old: OfficeDiscovery.ProofKey | null,
	) =>
		WopiProof.check({
			accessToken: "t",
			url,
			timestamp: String(timestamp),
			proof,
			proofOld,
			current,
			old,
			now,
		});

	test("calls stay valid while the office server changes its keys", () => {
		// The office server has new keys, we still have the old discovery: its old signature matches.
		expect(check(signed(newPair.privateKey), signed(oldPair.privateKey), oldPair.key, null)).toBe(
			true,
		);
		// We have the new discovery, the office server still signs with the old key.
		expect(check(signed(oldPair.privateKey), undefined, newPair.key, oldPair.key)).toBe(true);
		// Someone else's key matches neither.
		expect(check(signed(pair().privateKey), undefined, newPair.key, oldPair.key)).toBe(false);
		// A stale timestamp is refused even with the right key.
		expect(
			WopiProof.check({
				accessToken: "t",
				url,
				timestamp: String(timestamp),
				proof: signed(newPair.privateKey),
				proofOld: undefined,
				current: newPair.key,
				old: null,
				now: now + WopiProof.MAX_AGE_MS + 1,
			}),
		).toBe(false);
	});
});
