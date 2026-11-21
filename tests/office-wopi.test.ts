/**
 * Office documents over WOPI (`server/lib/office`, `routes/wopi`): opening a document in the
 * office editor, and the office server's calls — signed with proof keys (a key pair made here plays
 * the office server), checked against the access token, the session, the person's current rights,
 * the Papierkorb and locks.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { API } from "../server/lib/api";
import { DB } from "../server/lib/db";
import { OfficeDiscovery } from "../server/lib/office/discovery";
import { WopiProof } from "../server/lib/office/proof";
import { WopiIds } from "../server/lib/office/wopiIds";
import { inOrg, OrgContext } from "../server/lib/orgs/context";
import { RequestLimits } from "../server/lib/utils/requestLimits";
import { SecurityHeaders } from "../server/lib/utils/securityHeaders";
import { makeAPIRequest } from "./helpers/api";
import { TEST_HOST } from "./helpers/orgs";
import { addEventMember, type SeededSession, seedSession, seedUser } from "./helpers/seed";

let privateKey: KeyObject;
let leader: SeededSession;
let staff: SeededSession;
let viewer: SeededSession;
let eventId: number;
let docId: number;
let base: string;

const DOCX = Buffer.from("PK\u0003\u0004 pretend this is a docx");

function discovery(): OfficeDiscovery.Discovery {
	const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
	privateKey = pair.privateKey;
	const jwk = pair.publicKey.export({ format: "jwk" });
	const b64 = (value: string | undefined) =>
		Buffer.from(value as string, "base64url").toString("base64");
	const edit =
		"https://office.test/hosting/wopi/word/edit?<ui=UI_LLCC&><rs=DC_LLCC&><dchat=DISABLE_CHAT&>";
	return {
		actions: [
			{ app: "Word", name: "edit", ext: "docx", urlsrc: edit },
			{
				app: "Word",
				name: "view",
				ext: "docx",
				urlsrc: "https://office.test/hosting/wopi/word/view?",
			},
			{
				app: "Excel",
				name: "edit",
				ext: "xlsx",
				urlsrc: "https://office.test/hosting/wopi/cell/edit?",
			},
			{
				app: "PowerPoint",
				name: "edit",
				ext: "pptx",
				urlsrc: "https://office.test/hosting/wopi/slide/edit?",
			},
		],
		proofKey: { modulus: b64(jwk.n), exponent: b64(jwk.e) },
		oldProofKey: null,
	};
}

async function wopiIdOf(fileId: number) {
	const file = DB.instance()
		.select()
		.from(DB.Tables.files)
		.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, fileId)))
		.get();
	return WopiIds.of(file as DB.Models.File);
}

/** A call of the office server, signed like it would be. */
async function wopi(
	fileId: number,
	token: string,
	options: {
		method?: "GET" | "POST";
		suffix?: string;
		headers?: Record<string, string>;
		body?: BodyInit;
		proof?: "valid" | "wrong" | "old";
		/** Call with this id instead of the file's WOPI id. */
		rawId?: string;
	} = {},
) {
	const id = options.rawId ?? (await wopiIdOf(fileId));
	const path = `/v1/wopi/files/${id}${options.suffix ?? ""}?access_token=${encodeURIComponent(token)}`;
	const url = `${OrgContext.current().url}/api${path}`;
	const at = options.proof === "old" ? Date.now() - 30 * 60_000 : Date.now();
	const timestamp = WopiProof.msToTicks(at);
	const signed = sign(
		"RSA-SHA256",
		WopiProof.expected(options.proof === "wrong" ? "other" : token, url, timestamp),
		privateKey,
	).toString("base64");
	return await API.getApp().request(path, {
		method: options.method ?? "GET",
		headers: {
			"X-Iventworks-Host": TEST_HOST,
			"X-WOPI-TimeStamp": String(timestamp),
			"X-WOPI-Proof": signed,
			...options.headers,
		},
		body: options.body,
	});
}

async function open(token: string, fileId = docId, code = 200) {
	return await makeAPIRequest(
		`/v1/files/${fileId}/office`,
		{ method: "POST", authToken: token },
		code,
	);
}

const tokenOf = (opened: any) => opened.access_token as string;

beforeAll(async () => {
	OfficeDiscovery.setForTests(discovery());
	eventId = DB.instance()
		.insert(DB.Tables.events)
		.values({
			org_id: OrgContext.id(),
			name: "Wintercamp",
			start_date: "2027-12-27",
			end_date: "2027-12-30",
		})
		.returning()
		.get().id;
	base = `/v1/events/${eventId}/files`;
	const leaderUser = await seedUser("volunteer", { display_name: "Lea" });
	const staffUser = await seedUser("volunteer", { display_name: "Sam" });
	const viewerUser = await seedUser("volunteer");
	await addEventMember(eventId, leaderUser.id, "leader");
	await addEventMember(eventId, staffUser.id, "staff");
	await addEventMember(eventId, viewerUser.id, "staff");
	leader = await seedSession(leaderUser.id);
	staff = await seedSession(staffUser.id);
	viewer = await seedSession(viewerUser.id);

	const folder = await makeAPIRequest(
		`${base}/folders`,
		{ method: "POST", authToken: leader.token, body: { name: "Pläne" } },
		201,
	);
	await makeAPIRequest(`/v1/files/${folder.id}/access`, {
		method: "PUT",
		authToken: leader.token,
		body: {
			custom: true,
			entries: [
				{
					principal: "user",
					id: staffUser.id,
					permissions: { read: true, upload: true, edit: true, delete: false },
				},
				{
					principal: "user",
					id: viewerUser.id,
					permissions: { read: true, upload: false, edit: false, delete: false },
				},
			],
		},
	});
	const form = new FormData();
	form.append(
		"file",
		new File([DOCX], "Ablauf.docx", {
			type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		}),
	);
	form.append("parent_id", String(folder.id));
	docId = (
		await makeAPIRequest(
			base,
			{ authToken: leader.token, additionalOptions: { method: "POST", body: form } },
			201,
		)
	).id;
});

afterAll(() => OfficeDiscovery.setForTests(null));

describe("Opening documents in the office editor", () => {
	test("the instance says office editing is there; the page may frame the office server", async () => {
		const instance = await makeAPIRequest("/v1/instance");
		expect(instance.office).toBe(true);
		const csp = SecurityHeaders.pageCsp("<html></html>", true);
		expect(csp).toContain("frame-src 'self' blob: https://office.test");
		expect(csp).toContain("form-action 'self' https://office.test");
	});

	test("editors get the editor, readers the viewer; the URL carries WOPISrc", async () => {
		const edit = await open(staff.token);
		expect(edit.mode).toBe("edit");
		expect(edit.url).toStartWith(
			"https://office.test/hosting/wopi/word/edit?ui=de-DE&rs=de-DE&WOPISrc=",
		);
		expect(decodeURIComponent(edit.url.split("WOPISrc=")[1])).toBe(
			`${OrgContext.current().url}/api/v1/wopi/files/${await wopiIdOf(docId)}`,
		);
		// Not the bare file id: office servers keep documents by this id alone.
		expect(await wopiIdOf(docId)).toMatch(new RegExp(`^${docId}-[0-9a-f]{16}$`));
		expect(edit.access_token_ttl).toBeGreaterThan(Date.now());

		expect((await open(viewer.token)).mode).toBe("view");
	});

	test("saves to the WOPISrc handed out may be as large as uploads", async () => {
		// The server entry limits bodies by path before the app sees them (`server/runtime/bun.ts`).
		const src = decodeURIComponent((await open(staff.token)).url.split("WOPISrc=")[1]);
		const octets = new Headers({ "content-type": "application/octet-stream" });
		const upload = 26 * 1024 * 1024;
		expect(RequestLimits.limitFor(octets, upload, `${new URL(src).pathname}/contents`)).toBe(upload);
		expect(RequestLimits.limitFor(octets, upload, new URL(src).pathname)).toBe(
			RequestLimits.DEFAULT_BYTES,
		);
	});

	test("only office types, only documents", async () => {
		const form = new FormData();
		form.append("file", new File(["# Notiz"], "notiz.md", { type: "text/markdown" }));
		const md = await makeAPIRequest(
			base,
			{ authToken: leader.token, additionalOptions: { method: "POST", body: form } },
			201,
		);
		await open(leader.token, md.id, 400);
	});
});

describe("New office documents", () => {
	test("start empty; the office server fills them with its template", async () => {
		for (const type of ["docx", "xlsx", "pptx"] as const) {
			const created = await makeAPIRequest(
				`${base}/office`,
				{ method: "POST", authToken: staff.token, body: { name: "Neu", type } },
				201,
			);
			expect(created.name).toBe(`Neu.${type}`);
			expect(created.size).toBe(0);
			expect(created.permissions.edit).toBe(true);
			const editor = await open(staff.token, created.id);
			expect(editor.mode).toBe("edit");

			// Opening an empty file, the office server writes its template — before any lock.
			const token = tokenOf(editor);
			const filled = await wopi(created.id, token, {
				method: "POST",
				suffix: "/contents",
				headers: { "X-WOPI-Override": "PUT" },
				body: `${type} template`,
			});
			expect(filled.status).toBe(200);
			expect(await (await wopi(created.id, token, { suffix: "/contents" })).text()).toBe(
				`${type} template`,
			);
			// The empty file isn't kept as a version.
			const versions = await makeAPIRequest(`/v1/files/${created.id}/versions`, {
				authToken: staff.token,
			});
			expect(versions).toHaveLength(0);
		}
		// The extension isn't doubled.
		const named = await makeAPIRequest(
			`${base}/office`,
			{ method: "POST", authToken: staff.token, body: { name: "Plan.xlsx", type: "xlsx" } },
			201,
		);
		expect(named.name).toBe("Plan.xlsx");
	});

	test("not without an office server, not where one may not upload", async () => {
		await makeAPIRequest(
			`${base}/office`,
			{
				method: "POST",
				authToken: viewer.token,
				body: {
					name: "X",
					type: "docx",
					parent_id: (await makeAPIRequest(`/v1/files/${docId}`, { authToken: viewer.token })).parent_id,
				},
			},
			403,
		);
		OfficeDiscovery.setForTests(null);
		await makeAPIRequest(
			`${base}/office`,
			{ method: "POST", authToken: staff.token, body: { name: "X", type: "docx" } },
			404,
		);
		OfficeDiscovery.setForTests(discovery());
	});
});

describe("WOPI calls", () => {
	test("CheckFileInfo describes the file and the person", async () => {
		const token = tokenOf(await open(staff.token));
		const res = await wopi(docId, token);
		expect(res.status).toBe(200);
		const info = (await res.json()) as any;
		expect(info).toMatchObject({
			BaseFileName: "Ablauf.docx",
			Size: DOCX.length,
			UserFriendlyName: "Sam",
			UserCanWrite: true,
			SupportsLocks: true,
		});

		// The editor's version history opens the page's; its share button only for managers.
		expect(info.FileVersionPostMessage).toBe(true);
		const managed = await (await wopi(docId, tokenOf(await open(leader.token)))).json();
		expect((managed as any).FileSharingPostMessage).toBe(true);

		const view = await (await wopi(docId, tokenOf(await open(viewer.token)))).json();
		expect((view as any).UserCanWrite).toBe(false);
		expect((view as any).FileSharingPostMessage).toBe(false);

		// Not while the org has switched share links off.
		const admin = await seedSession((await seedUser("admin")).id);
		const sharing = (enabled: boolean) =>
			makeAPIRequest("/v1/admin/organization", {
				method: "PUT",
				authToken: admin.token,
				body: { file_sharing_enabled: enabled },
			});
		await sharing(false);
		try {
			const off = await (await wopi(docId, tokenOf(await open(leader.token)))).json();
			expect((off as any).FileSharingPostMessage).toBe(false);
		} finally {
			await sharing(true);
		}
	});

	test("calls without a valid proof, token or fresh timestamp are refused", async () => {
		const token = tokenOf(await open(staff.token));
		expect((await wopi(docId, token, { proof: "wrong" })).status).toBe(500);
		expect((await wopi(docId, token, { proof: "old" })).status).toBe(500);
		expect((await wopi(docId, "nicht-gültig")).status).toBe(401);
		const other = await makeAPIRequest(
			`${base}/folders`,
			{ method: "POST", authToken: leader.token, body: { name: "Anderes" } },
			201,
		);
		expect((await wopi(other.id, token)).status).toBe(401);

		// Only the WOPI id names the file — not the bare id, not another installation's suffix.
		expect((await wopi(docId, token, { rawId: String(docId) })).status).toBe(404);
		expect((await wopi(docId, token, { rawId: `${docId}-0000000000000000` })).status).toBe(404);
	});

	test("an Authorization header with the access token is fine (not taken for a login)", async () => {
		const token = tokenOf(await open(staff.token));
		const res = await wopi(docId, token, { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(200);
	});

	test("without the office server's proof keys every call is refused", async () => {
		const token = tokenOf(await open(staff.token));
		OfficeDiscovery.setForTests({ ...discovery(), proofKey: null });
		try {
			expect((await wopi(docId, token)).status).toBe(500);
			expect((await wopi(docId, token, { suffix: "/contents" })).status).toBe(500);
		} finally {
			OfficeDiscovery.setForTests(discovery());
		}
		expect((await wopi(docId, token)).status).toBe(200);
	});

	test("GetFile returns the bytes", async () => {
		const res = await wopi(docId, tokenOf(await open(staff.token)), { suffix: "/contents" });
		expect(res.status).toBe(200);
		expect(Buffer.from(await res.arrayBuffer()).equals(DOCX)).toBe(true);
	});

	test("locks guard PutFile; saving keeps the old contents as a version", async () => {
		const token = tokenOf(await open(staff.token));
		const lock = (operation: string, id: string, extra: Record<string, string> = {}) =>
			wopi(docId, token, {
				method: "POST",
				headers: { "X-WOPI-Override": operation, "X-WOPI-Lock": id, ...extra },
			});
		const put = (id: string, body: string) =>
			wopi(docId, token, {
				method: "POST",
				suffix: "/contents",
				headers: { "X-WOPI-Override": "PUT", "X-WOPI-Lock": id },
				body,
			});

		// A non-empty file needs the lock.
		expect((await put("", "x")).status).toBe(409);
		expect((await lock("LOCK", "lock-a")).status).toBe(200);
		const taken = await lock("LOCK", "lock-b");
		expect(taken.status).toBe(409);
		expect(taken.headers.get("X-WOPI-Lock")).toBe("lock-a");
		expect((await lock("GET_LOCK", "")).headers.get("X-WOPI-Lock")).toBe("lock-a");

		// Nobody else changes the file meanwhile.
		const upload = new FormData();
		upload.append("file", new File(["neu"], "Ablauf.docx"));
		await makeAPIRequest(
			`/v1/files/${docId}/content`,
			{ authToken: leader.token, additionalOptions: { method: "PUT", body: upload } },
			409,
		);
		await makeAPIRequest(`/v1/files/${docId}`, { method: "DELETE", authToken: leader.token }, 409);

		const wrong = await put("lock-b", "x");
		expect(wrong.status).toBe(409);
		expect(wrong.headers.get("X-WOPI-Lock")).toBe("lock-a");
		const saved = await put("lock-a", "neuer Inhalt");
		expect(saved.status).toBe(200);
		expect(saved.headers.get("X-WOPI-ItemVersion")).toBeTruthy();
		const contents = await wopi(docId, token, { suffix: "/contents" });
		expect(await contents.text()).toBe("neuer Inhalt");
		const versions = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: viewer.token });
		expect(versions).toHaveLength(1);

		expect((await lock("REFRESH_LOCK", "lock-a")).status).toBe(200);
		expect((await lock("LOCK", "lock-c", { "X-WOPI-OldLock": "lock-a" })).status).toBe(200);
		expect((await lock("UNLOCK", "lock-a")).status).toBe(409);
		expect((await lock("UNLOCK", "lock-c")).status).toBe(200);
		expect((await lock("GET_LOCK", "")).headers.get("X-WOPI-Lock")).toBe("");
		// A free file can't be refreshed or unlocked: a conflict with an empty lock (MS-WOPI).
		for (const operation of ["REFRESH_LOCK", "UNLOCK"]) {
			const free = await lock(operation, "");
			expect(free.status).toBe(409);
			expect(free.headers.get("X-WOPI-Lock")).toBe("");
		}

		expect(
			(await wopi(docId, token, { method: "POST", headers: { "X-WOPI-Override": "PUT_RELATIVE" } }))
				.status,
		).toBe(501);
	});

	test("viewers can't lock or save", async () => {
		const token = tokenOf(await open(viewer.token));
		const locked = await wopi(docId, token, {
			method: "POST",
			headers: { "X-WOPI-Override": "LOCK", "X-WOPI-Lock": "v" },
		});
		expect(locked.status).toBe(401);
		const saved = await wopi(docId, token, {
			method: "POST",
			suffix: "/contents",
			headers: { "X-WOPI-Override": "PUT", "X-WOPI-Lock": "v" },
			body: "x",
		});
		expect(saved.status).toBe(401);
	});

	test("tokens stop with the rights, the session and the Papierkorb", async () => {
		const token = tokenOf(await open(staff.token));
		expect((await wopi(docId, token)).status).toBe(200);

		// Rights change: write access is taken away → read-only, then no access at all.
		const folderId = (await makeAPIRequest(`/v1/files/${docId}`, { authToken: leader.token }))
			.parent_id;
		await makeAPIRequest(`/v1/files/${folderId}/access`, {
			method: "PUT",
			authToken: leader.token,
			body: { custom: true, entries: [] },
		});
		expect((await wopi(docId, token)).status).toBe(401);
		await makeAPIRequest(`/v1/files/${folderId}/access`, {
			method: "PUT",
			authToken: leader.token,
			body: { custom: false, entries: [] },
		});
		expect((await wopi(docId, token)).status).toBe(200);

		// Logged out: the session is gone.
		const sessionId = staff.token.split(":")[0]!.split("_").at(-1)!;
		DB.instance()
			.delete(DB.Tables.sessions)
			.where(and(inOrg(DB.Tables.sessions), eq(DB.Tables.sessions.id, sessionId)))
			.run();
		expect((await wopi(docId, token)).status).toBe(401);

		// In the Papierkorb.
		const leaderToken = tokenOf(await open(leader.token));
		await makeAPIRequest(`/v1/files/${docId}`, { method: "DELETE", authToken: leader.token });
		expect((await wopi(docId, leaderToken)).status).toBe(401);
	});
});
