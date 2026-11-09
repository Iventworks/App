import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { API } from "../server/lib/api";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { OrgService } from "../server/lib/orgs/service";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders, TEST_HOST } from "./helpers/orgs";
import { addEventMember, type SeededSession, seedSession, seedUser } from "./helpers/seed";

let admin: SeededSession;
let core: SeededSession;
let volunteer: SeededSession;
let leader: SeededSession;
let staff: SeededSession;

let sharedFolderId: number;
let subFolderId: number;
let nestedFileId: number;
let rootFileId: number;
let outsideFileId: number;
let eventId: number;
let eventFolderId: number;


async function call(
	method: string,
	path: string,
	options: { body?: unknown; form?: FormData; cookie?: string; token?: string; host?: string } = {},
) {
	const headers: Record<string, string> = hostHeaders(options.host ?? TEST_HOST);
	if (options.cookie) headers.Cookie = options.cookie;
	if (options.token) headers.Authorization = `Bearer ${options.token}`;
	if (options.body !== undefined) headers["Content-Type"] = "application/json";
	const res = await API.getApp().request(path, {
		method,
		headers,
		body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
	});
	const text = await res.text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {}
	return { status: res.status, json, text, headers: res.headers };
}

function fileForm(name: string, content: string, extra: Record<string, string> = {}) {
	const form = new FormData();
	form.append("file", new File([content], name, { type: "text/plain" }));
	for (const [key, value] of Object.entries(extra)) form.append(key, value);
	return form;
}

async function uploadOrgDoc(name: string, content: string, parentId?: number) {
	const form = fileForm(name, content, parentId ? { parent_id: String(parentId) } : {});
	return (await makeAPIRequest(
		"/v1/org/documents",
		{ authToken: core.token, additionalOptions: { method: "POST", body: form } },
		201,
	)) as any;
}

async function createShare(fileId: number, body: Record<string, unknown>, token = core.token) {
	return await makeAPIRequest(
		`/v1/files/${fileId}/shares`,
		{ method: "POST", authToken: token, body },
		201,
	);
}

const tokenOf = (url: string) => url.split("/s/")[1]!;
const READ = { read: true, upload: false, edit: false, delete: false };
const ALL = { read: true, upload: true, edit: true, delete: true };

beforeAll(async () => {
	admin = await seedSession((await seedUser("admin")).id);
	core = await seedSession((await seedUser("core_team")).id);
	volunteer = await seedSession((await seedUser("volunteer")).id);
	const leaderUser = await seedUser("volunteer");
	const staffUser = await seedUser("volunteer");
	leader = await seedSession(leaderUser.id);
	staff = await seedSession(staffUser.id);

	const folder = await makeAPIRequest(
		"/v1/org/documents/folders",
		{ method: "POST", authToken: core.token, body: { name: "Elternbrief" } },
		201,
	);
	sharedFolderId = folder.id;
	const sub = await makeAPIRequest(
		"/v1/org/documents/folders",
		{ method: "POST", authToken: core.token, body: { name: "Anhänge", parent_id: sharedFolderId } },
		201,
	);
	subFolderId = sub.id;
	nestedFileId = (await uploadOrgDoc("packliste.txt", "Schlafsack", subFolderId)).id;
	rootFileId = (await uploadOrgDoc("brief.txt", "Liebe Eltern", sharedFolderId)).id;
	outsideFileId = (await uploadOrgDoc("intern.txt", "Nur für uns")).id;

	const event = await makeAPIRequest(
		"/v1/events",
		{
			method: "POST",
			authToken: core.token,
			body: { name: "Sommerfreizeit", type: "camp", start_date: "2027-07-01", end_date: "2027-07-10" },
		},
		201,
	);
	eventId = event.id;
	await addEventMember(eventId, leaderUser.id, "leader");
	await addEventMember(eventId, staffUser.id, "staff");
	const eventFolder = await makeAPIRequest(
		`/v1/events/${eventId}/files/folders`,
		{ method: "POST", authToken: leader.token, body: { name: "Fotos" } },
		201,
	);
	eventFolderId = eventFolder.id;
});

describe("Managing share links", () => {
	test("only people managing the library may share", async () => {
		await makeAPIRequest(`/v1/files/${sharedFolderId}/shares`, { authToken: volunteer.token }, 403);
		await makeAPIRequest(
			`/v1/files/${sharedFolderId}/shares`,
			{ method: "POST", authToken: volunteer.token, body: { permissions: READ } },
			403,
		);
		// Event documents: leaders yes, staff (who may upload) no.
		await createShare(eventFolderId, { permissions: READ }, leader.token);
		await makeAPIRequest(
			`/v1/files/${eventFolderId}/shares`,
			{ method: "POST", authToken: staff.token, body: { permissions: READ } },
			403,
		);
	});

	test("a link points at the org's own address and shows up as shared", async () => {
		const share = await createShare(sharedFolderId, { permissions: READ, label: "Für die Eltern" });
		expect(share.url).toMatch(/^http:\/\/test\.localhost:31316\/s\/[A-Za-z0-9]{32}$/);
		expect(share.label).toBe("Für die Eltern");
		expect(share.has_password).toBe(false);
		expect(share.expires_at).toBeNull();

		const list = await makeAPIRequest(`/v1/files/${sharedFolderId}/shares`, {
			authToken: core.token,
		});
		expect(list.map((s: any) => s.id)).toContain(share.id);

		const docs = await makeAPIRequest("/v1/org/documents", { authToken: core.token });
		const entry = docs.items.find((item: any) => item.id === sharedFolderId);
		expect(entry.shared).toBe(true);
		expect(docs.items.find((item: any) => item.id === outsideFileId).shared).toBe(false);
	});

	test("the org's default expiry applies unless the link says otherwise", async () => {
		await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: admin.token,
			body: { share_default_expiry_days: 7 },
		});
		const withDefault = await createShare(rootFileId, { permissions: READ });
		expect(withDefault.expires_at).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
		expect(withDefault.expires_at).toBeLessThan(Date.now() + 7.1 * 86_400_000);
		const never = await createShare(rootFileId, { permissions: READ, expires_at: null });
		expect(never.expires_at).toBeNull();
		await makeAPIRequest(
			`/v1/files/${rootFileId}/shares`,
			{
				method: "POST",
				authToken: core.token,
				body: { permissions: READ, expires_at: Date.now() - 1000 },
			},
			400,
		);
		await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: admin.token,
			body: { share_default_expiry_days: null },
		});
	});

	test("receipts are never shared", async () => {
		const receipt = await OrgContext.run(OrgContext.current(), () =>
			DB.instance()
				.insert(DB.Tables.files)
				.values({
					org_id: OrgContext.id(),
					scope: "receipt",
					event_id: eventId,
					kind: "file",
					name: "beleg.pdf",
					uploaded_by: null,
				})
				.returning()
				.get(),
		);
		await makeAPIRequest(
			`/v1/files/${receipt.id}/shares`,
			{ method: "POST", authToken: admin.token, body: { permissions: READ } },
			403,
		);
	});
});

describe("A read-only folder link", () => {
	let token: string;

	beforeAll(async () => {
		token = tokenOf((await createShare(sharedFolderId, { permissions: READ })).url);
	});

	test("opens the folder and everything below it", async () => {
		const info = await call("GET", `/v1/shares/${token}`);
		expect(info.status).toBe(200);
		expect(info.json.data.kind).toBe("folder");
		expect(info.json.data.unlocked).toBe(true);
		expect(info.json.data.item.name).toBe("Elternbrief");
		expect(info.json.data.permissions).toEqual(READ);
		// Internal details stay internal.
		expect(info.text).not.toContain("Für die Eltern");
		expect(info.text).not.toContain("uploaded_by");

		const root = await call("GET", `/v1/shares/${token}/items`);
		expect(root.json.data.items.map((i: any) => i.name)).toEqual(["Anhänge", "brief.txt"]);
		expect(root.json.data.path.map((i: any) => i.name)).toEqual(["Elternbrief"]);

		const sub = await call("GET", `/v1/shares/${token}/items?folder_id=${subFolderId}`);
		expect(sub.json.data.path.map((i: any) => i.name)).toEqual(["Elternbrief", "Anhänge"]);
		const nested = sub.json.data.items[0];
		expect(nested.content_url).toBe(
			`/api/v1/shares/${token}/files/${nestedFileId}/content/packliste.txt`,
		);

		const content = await call("GET", nested.content_url.replace("/api", ""));
		expect(content.status).toBe(200);
		expect(content.text).toBe("Schlafsack");
		expect(content.headers.get("cache-control")).toBe("private, no-store");
	});

	test("never reaches files outside the shared folder", async () => {
		expect((await call("GET", `/v1/shares/${token}/files/${outsideFileId}/content`)).status).toBe(
			404,
		);
		expect((await call("GET", `/v1/shares/${token}/items?folder_id=${outsideFileId}`)).status).toBe(
			404,
		);
		// A folder of another library (event) neither.
		expect((await call("GET", `/v1/shares/${token}/items?folder_id=${eventFolderId}`)).status).toBe(
			404,
		);
	});

	test("allows no changes", async () => {
		expect(
			(await call("POST", `/v1/shares/${token}/files`, { form: fileForm("x.txt", "x") })).status,
		).toBe(403);
		expect(
			(await call("POST", `/v1/shares/${token}/folders`, { body: { name: "Neu" } })).status,
		).toBe(403);
		expect(
			(await call("PUT", `/v1/shares/${token}/files/${rootFileId}`, { body: { name: "y.txt" } }))
				.status,
		).toBe(403);
		expect((await call("DELETE", `/v1/shares/${token}/files/${rootFileId}`)).status).toBe(403);
	});

	test("only works on its org's address", async () => {
		await OrgService.create({ slug: "share-other", display_name: "Andere" });
		expect((await call("GET", `/v1/shares/${token}`, { host: "share-other.localhost" })).status).toBe(
			404,
		);
		expect((await call("GET", `/v1/shares/${token}`, { host: "localhost" })).status).toBe(404);
		expect((await call("GET", `/v1/shares/${"x".repeat(32)}`)).status).toBe(404);
	});
});

describe("A full-access folder link", () => {
	let token: string;

	beforeAll(async () => {
		token = tokenOf(
			(await createShare(sharedFolderId, { permissions: ALL, label: "Team extern" })).url,
		);
	});

	test("uploads, creates folders, renames, replaces and deletes inside the folder", async () => {
		const uploaded = await call("POST", `/v1/shares/${token}/files`, {
			form: fileForm("foto.txt", "Bild", { parent_id: String(subFolderId) }),
		});
		expect(uploaded.status).toBe(201);
		const id = uploaded.json.data.id;

		const folder = await call("POST", `/v1/shares/${token}/folders`, {
			body: { name: "Rückmeldungen" },
		});
		expect(folder.status).toBe(201);

		const renamed = await call("PUT", `/v1/shares/${token}/files/${id}`, {
			body: { name: "foto-1.txt" },
		});
		expect(renamed.json.data.name).toBe("foto-1.txt");

		const replaced = await call("PUT", `/v1/shares/${token}/files/${id}/content`, {
			form: fileForm("egal.txt", "Neues Bild"),
		});
		expect(replaced.status).toBe(200);
		expect((await call("GET", `/v1/shares/${token}/files/${id}/content`)).text).toBe("Neues Bild");

		expect((await call("DELETE", `/v1/shares/${token}/files/${id}`)).status).toBe(200);
		expect((await call("DELETE", `/v1/shares/${token}/files/${folder.json.data.id}`)).status).toBe(
			200,
		);

		// Recorded without a user, naming the link.
		const log = await makeAPIRequest("/v1/admin/audit-log?search=Freigabelink", {
			authToken: admin.token,
		});
		expect(
			log.entries.some((e: any) => e.user_id === null && e.summary.includes("„Team extern“")),
		).toBe(true);
	});

	test("the shared folder itself can't be renamed or deleted, nor anything outside", async () => {
		expect(
			(await call("PUT", `/v1/shares/${token}/files/${sharedFolderId}`, { body: { name: "Weg" } }))
				.status,
		).toBe(404);
		expect((await call("DELETE", `/v1/shares/${token}/files/${sharedFolderId}`)).status).toBe(404);
		expect((await call("DELETE", `/v1/shares/${token}/files/${outsideFileId}`)).status).toBe(404);
		expect(
			(
				await call("PUT", `/v1/shares/${token}/files/${outsideFileId}/content`, {
					form: fileForm("x.txt", "x"),
				})
			).status,
		).toBe(404);
		expect(
			(
				await call("POST", `/v1/shares/${token}/files`, {
					form: fileForm("x.txt", "x", { parent_id: String(eventFolderId) }),
				})
			).status,
		).toBe(404);
	});
});

describe("Drop box and file links", () => {
	test("an upload-only folder link hides the contents", async () => {
		const share = await createShare(sharedFolderId, {
			permissions: { read: false, upload: true, edit: false, delete: false },
		});
		const token = tokenOf(share.url);
		expect((await call("GET", `/v1/shares/${token}/items`)).status).toBe(403);
		expect((await call("GET", `/v1/shares/${token}/files/${rootFileId}/content`)).status).toBe(403);
		const uploaded = await call("POST", `/v1/shares/${token}/files`, {
			form: fileForm("abgabe.txt", "Hier"),
		});
		expect(uploaded.status).toBe(201);
		expect(uploaded.json.data.content_url).toBeNull();
	});

	test("a file link is view or edit only", async () => {
		const share = await createShare(rootFileId, { permissions: ALL });
		expect(share.permissions).toEqual({ read: true, upload: false, edit: true, delete: false });
		const token = tokenOf(share.url);
		const info = await call("GET", `/v1/shares/${token}`);
		expect(info.json.data.kind).toBe("file");
		expect(info.json.data.item.content_url).toBe(
			`/api/v1/shares/${token}/files/${rootFileId}/content/brief.txt`,
		);
		expect(
			(
				await call("PUT", `/v1/shares/${token}/files/${rootFileId}/content`, {
					form: fileForm("brief.txt", "Liebe Eltern!"),
				})
			).status,
		).toBe(200);
		expect(
			(await call("PUT", `/v1/shares/${token}/files/${rootFileId}`, { body: { name: "x.txt" } }))
				.status,
		).toBe(404);
		expect((await call("GET", `/v1/shares/${token}/items`)).status).toBe(404);
	});
});

describe("Password, expiry and switching sharing off", () => {
	test("a password-protected link reveals nothing until unlocked", async () => {
		const share = await createShare(sharedFolderId, { permissions: READ, password: "geheim123" });
		expect(share.has_password).toBe(true);
		const token = tokenOf(share.url);

		const locked = await call("GET", `/v1/shares/${token}`);
		expect(locked.json.data.requires_password).toBe(true);
		expect(locked.json.data.unlocked).toBe(false);
		expect(locked.json.data.item).toBeNull();
		expect(locked.text).not.toContain("Elternbrief");
		expect((await call("GET", `/v1/shares/${token}/items`)).status).toBe(401);
		expect((await call("GET", `/v1/shares/${token}/files/${rootFileId}/content`)).status).toBe(401);

		expect(
			(await call("POST", `/v1/shares/${token}/unlock`, { body: { password: "falsch" } })).status,
		).toBe(403);
		const unlocked = await call("POST", `/v1/shares/${token}/unlock`, {
			body: { password: "geheim123" },
		});
		expect(unlocked.status).toBe(200);
		expect(unlocked.json.data.item.name).toBe("Elternbrief");
		const setCookie = unlocked.headers.get("set-cookie") ?? "";
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain(`Path=/api/v1/shares/${token}`);
		const cookie = setCookie.split(";")[0]!;

		expect((await call("GET", `/v1/shares/${token}/items`, { cookie })).status).toBe(200);
		// A forged or expired cookie doesn't help.
		expect(
			(
				await call("GET", `/v1/shares/${token}/items`, {
					cookie: `iventworks_share=${Date.now() + 1e7}.${"0".repeat(64)}`,
				})
			).status,
		).toBe(401);

		// A new password locks everyone out again.
		await makeAPIRequest(`/v1/files/${sharedFolderId}/shares/${share.id}`, {
			method: "PUT",
			authToken: core.token,
			body: { password: "anders123" },
		});
		expect((await call("GET", `/v1/shares/${token}/items`, { cookie })).status).toBe(401);
	});

	test("password guessing is rate-limited", async () => {
		const token = tokenOf(
			(await createShare(sharedFolderId, { permissions: READ, password: "richtig1" })).url,
		);
		for (let i = 0; i < 10; i++) {
			expect(
				(await call("POST", `/v1/shares/${token}/unlock`, { body: { password: `nope${i}` } })).status,
			).toBe(403);
		}
		expect(
			(await call("POST", `/v1/shares/${token}/unlock`, { body: { password: "richtig1" } })).status,
		).toBe(429);
	});

	test("an expired link is gone", async () => {
		const share = await createShare(sharedFolderId, {
			permissions: READ,
			expires_at: Date.now() + 60_000,
		});
		const token = tokenOf(share.url);
		expect((await call("GET", `/v1/shares/${token}`)).status).toBe(200);
		await DB.instance()
			.update(DB.Tables.fileShares)
			.set({ expires_at: Date.now() - 1 })
			.where(eq(DB.Tables.fileShares.id, share.id))
			.run();
		expect((await call("GET", `/v1/shares/${token}`)).status).toBe(404);
		const list = await makeAPIRequest(`/v1/files/${sharedFolderId}/shares`, {
			authToken: core.token,
		});
		expect(list.find((s: any) => s.id === share.id).expired).toBe(true);
	});

	test("switching sharing off stops every link and creating new ones", async () => {
		const token = tokenOf((await createShare(sharedFolderId, { permissions: READ })).url);
		await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: admin.token,
			body: { file_sharing_enabled: false },
		});
		expect((await call("GET", `/v1/shares/${token}`)).status).toBe(404);
		await makeAPIRequest(
			`/v1/files/${sharedFolderId}/shares`,
			{ method: "POST", authToken: core.token, body: { permissions: READ } },
			403,
		);
		await makeAPIRequest("/v1/admin/organization", {
			method: "PUT",
			authToken: admin.token,
			body: { file_sharing_enabled: true },
		});
		expect((await call("GET", `/v1/shares/${token}`)).status).toBe(200);
	});
});

describe("Admin overview and clean-up", () => {
	test("admins see and revoke every link", async () => {
		const share = await createShare(subFolderId, { permissions: READ, label: "Übersicht" });
		const token = tokenOf(share.url);
		await makeAPIRequest("/v1/admin/shares", { authToken: core.token }, 403);

		const all = await makeAPIRequest("/v1/admin/shares", { authToken: admin.token });
		const entry = all.find((s: any) => s.id === share.id);
		expect(entry.file.name).toBe("Anhänge");
		expect(entry.file.path).toBe(`/documents?folder=${subFolderId}`);
		expect(all.some((s: any) => s.file.event?.name === "Sommerfreizeit")).toBe(true);

		await makeAPIRequest(`/v1/admin/shares/${share.id}`, {
			method: "DELETE",
			authToken: admin.token,
		});
		expect((await call("GET", `/v1/shares/${token}`)).status).toBe(404);
	});

	test("deleting the shared item deletes its links", async () => {
		const file = await uploadOrgDoc("kurz.txt", "weg");
		const token = tokenOf((await createShare(file.id, { permissions: READ })).url);
		await makeAPIRequest(`/v1/files/${file.id}`, { method: "DELETE", authToken: core.token });
		expect((await call("GET", `/v1/shares/${token}`)).status).toBe(404);
	});

	test("housekeeping drops long-expired links and orphaned stored files", async () => {
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");
		const { FileStorage } = await import("../server/lib/utils/fileStorage");
		const share = await createShare(sharedFolderId, { permissions: READ });
		await DB.instance()
			.update(DB.Tables.fileShares)
			.set({ expires_at: Date.now() - 31 * 86_400_000 })
			.where(eq(DB.Tables.fileShares.id, share.id))
			.run();
		const orphan = await FileStorage.save(new Blob(["vergessen"]));

		const result = await Housekeeping.run(Date.now() + 2 * 86_400_000);
		expect(result.shares).toBeGreaterThanOrEqual(1);
		expect(result.orphanBlobs).toBeGreaterThanOrEqual(1);
		expect(await FileStorage.open(orphan.storageKey).exists()).toBe(false);
		// Referenced files stay.
		const kept = await call("GET", `/v1/files/${rootFileId}/content`, { token: core.token });
		expect(kept.status).toBe(200);
	});
});

