/**
 * Changing documents: new versions by upload (who may, coalescing per person), version history
 * (contents, restore), locks while the office server edits (no uploads, restores or deletes — also
 * of the folder above), how contents are served (what the browser may show) and housekeeping.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { FileLocks } from "../server/lib/api/utils/fileLocks";
import { FileVersions } from "../server/lib/api/utils/fileVersions";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { FileStorage } from "../server/lib/utils/fileStorage";
import { makeAPIRequest } from "./helpers/api";
import { type SeededSession, type SeededUser, seedSession, seedUser } from "./helpers/seed";

const EDIT = { read: true, upload: true, edit: true, delete: false };
const VIEW = { read: true, upload: false, edit: false, delete: false };

let core: SeededSession;
let anna: SeededSession; // volunteer, may edit in the folder
let reader: SeededSession; // volunteer, may only view
let annaUser: SeededUser;
let folderId: number;
let docId: number;

async function request(path: string, token: string, method = "GET") {
	const { API } = await import("../server/lib/api");
	return await API.getApp().request(path, {
		method,
		headers: { "X-Iventworks-Host": "test.localhost", Authorization: `Bearer ${token}` },
	});
}

async function text(fileId: number, token: string, path = `/v1/files/${fileId}/content/x.md`) {
	const res = await request(path, token);
	expect(res.status).toBe(200);
	return await res.text();
}

function uploadForm(content: string, name = "protokoll.md", type = "text/markdown") {
	const form = new FormData();
	form.append("file", new File([content], name, { type }));
	return form;
}

async function upload(token: string, content: string, name: string, type: string) {
	return await makeAPIRequest(
		"/v1/org/documents",
		{
			authToken: token,
			additionalOptions: {
				method: "POST",
				body: (() => {
					const form = uploadForm(content, name, type);
					form.append("parent_id", String(folderId));
					return form;
				})(),
			},
		},
		201,
	);
}

const replace = (token: string, fileId: number, content: string, code = 200) =>
	makeAPIRequest(
		`/v1/files/${fileId}/content`,
		{ authToken: token, additionalOptions: { method: "PUT", body: uploadForm(content) } },
		code,
	);

const versionsOf = (fileId: number) =>
	makeAPIRequest(`/v1/files/${fileId}/versions`, { authToken: reader.token });

beforeAll(async () => {
	core = await seedSession((await seedUser("core_team")).id);
	annaUser = await seedUser("volunteer", { display_name: "Anna" });
	const readerUser = await seedUser("volunteer");
	anna = await seedSession(annaUser.id);
	reader = await seedSession(readerUser.id);

	const folder = await makeAPIRequest(
		"/v1/org/documents/folders",
		{ method: "POST", authToken: core.token, body: { name: "Protokolle" } },
		201,
	);
	folderId = folder.id;
	await makeAPIRequest(`/v1/files/${folderId}/access`, {
		method: "PUT",
		authToken: core.token,
		body: {
			custom: true,
			entries: [
				{ principal: "user", id: annaUser.id, permissions: EDIT },
				{ principal: "user", id: readerUser.id, permissions: VIEW },
			],
		},
	});
	docId = (await upload(core.token, "# Sitzung März\n", "protokoll.md", "text/markdown")).id;
});

describe("Versions", () => {
	test("only people who may edit upload a new version", async () => {
		await replace(reader.token, docId, "nope", 403);
		await replace(anna.token, docId, "# Von Anna");
		expect(await text(docId, reader.token)).toBe("# Von Anna");
	});

	test("the same person's quick changes keep one version; others' contents are always kept", async () => {
		const before = await versionsOf(docId);
		await replace(anna.token, docId, "# Anna, zweite Fassung");
		const afterAnna = await versionsOf(docId);
		// Anna's own contents of a moment ago: not kept again.
		expect(afterAnna.length).toBe(before.length);

		await replace(core.token, docId, "# Vom Kernteam");
		const versions = await versionsOf(docId);
		expect(versions.length).toBe(afterAnna.length + 1);
		expect(versions[0].modified_by.display_name).toBe("Anna");
		expect(await text(docId, reader.token, versions[0].content_url.replace("/api", ""))).toBe(
			"# Anna, zweite Fassung",
		);
	});

	test("restoring makes an old version current and keeps the current one", async () => {
		const versions = await versionsOf(docId);
		const oldest = versions.at(-1);
		await makeAPIRequest(
			`/v1/files/${docId}/versions/${oldest.id}/restore`,
			{ method: "POST", authToken: reader.token },
			403,
		);
		await makeAPIRequest(`/v1/files/${docId}/versions/${oldest.id}/restore`, {
			method: "POST",
			authToken: anna.token,
		});
		expect(await text(docId, reader.token)).toBe("# Sitzung März\n");
		// The restored version stays; the contents it replaced became one.
		const after = await versionsOf(docId);
		expect(after.map((version: any) => version.id)).toContain(oldest.id);
		expect(after).toHaveLength(versions.length + 1);
	});

	test("a version says when its contents were written, not when the file was renamed", async () => {
		const file = await upload(core.token, "Entwurf", "entwurf.txt", "text/plain");
		await Bun.sleep(5);
		const renamed = await makeAPIRequest(`/v1/files/${file.id}`, {
			method: "PUT",
			authToken: core.token,
			body: { name: "entwurf-umbenannt.txt" },
		});

		await replace(anna.token, file.id, "Von Anna");
		const [version] = await versionsOf(file.id);
		expect(version.modified_by.display_name).not.toBe("Anna");
		expect(version.modified_at).toBeLessThan(renamed.updated_at);
	});

	test("saving right after a restore doesn't lose the restored contents", async () => {
		const versions = await versionsOf(docId);
		const oldest = versions.at(-1);
		// Anna restored a moment ago: her next save coalesces with the version the restore made.
		await replace(anna.token, docId, "# Anna, nach dem Zurückholen");
		const after = await versionsOf(docId);
		expect(after).toHaveLength(versions.length);
		expect(after.map((version: any) => version.id)).toContain(oldest.id);
		expect(await text(docId, reader.token, oldest.content_url.replace("/api", ""))).toBe(
			"# Sitzung März\n",
		);
	});
});

describe("While the office server edits", () => {
	test("no uploads, restores, share-link replacements or deletes — also not of the folder", async () => {
		const running = await makeAPIRequest(
			"/v1/org/documents/folders",
			{ method: "POST", authToken: core.token, body: { name: "Laufend", parent_id: folderId } },
			201,
		);
		const form = uploadForm("PK pretend docx", "bericht.docx", "application/octet-stream");
		form.append("parent_id", String(running.id));
		const doc = await makeAPIRequest(
			"/v1/org/documents",
			{ authToken: core.token, additionalOptions: { method: "POST", body: form } },
			201,
		);
		await replace(core.token, doc.id, "v2");
		const [version] = await versionsOf(doc.id);
		const share = await makeAPIRequest(
			`/v1/files/${doc.id}/shares`,
			{
				method: "POST",
				authToken: core.token,
				body: { permissions: { read: true, upload: false, edit: true, delete: false } },
			},
			201,
		);
		const token = share.url.split("/s/")[1];

		expect(FileLocks.officeLock(doc.id, "office-lock")).toEqual({ ok: true });

		const details = await makeAPIRequest(`/v1/files/${doc.id}`, { authToken: reader.token });
		expect(details.editing).toEqual({ expires_at: expect.any(Number) });
		await replace(core.token, doc.id, "v3", 409);
		await makeAPIRequest(
			`/v1/files/${doc.id}/versions/${version.id}/restore`,
			{ method: "POST", authToken: core.token },
			409,
		);
		await makeAPIRequest(
			`/v1/shares/${token}/files/${doc.id}/content`,
			{ additionalOptions: { method: "PUT", body: uploadForm("von außen") } },
			409,
		);
		await makeAPIRequest(`/v1/files/${doc.id}`, { method: "DELETE", authToken: core.token }, 409);
		await makeAPIRequest(`/v1/files/${running.id}`, { method: "DELETE", authToken: core.token }, 409);

		await FileLocks.officeUnlock(doc.id, "office-lock");
		await makeAPIRequest(`/v1/files/${running.id}`, { method: "DELETE", authToken: core.token });
	});
});

describe("Contents", () => {
	test("text formats open as plain text, a PDF by its first bytes, everything else downloads", async () => {
		const csv = await upload(core.token, "a,b\n1,2", "liste.csv", "text/csv");
		const json = await upload(core.token, '{"a":1}', "daten.json", "application/json");
		const html = await upload(core.token, "<script>alert(1)</script>", "seite.html", "text/html");
		const pdf = await upload(core.token, "%PDF-1.7\n…", "plan.pdf", "application/octet-stream");
		const notPdf = await upload(core.token, "<html>", "falsch.pdf", "application/octet-stream");

		for (const file of [docId, csv.id, json.id]) {
			const res = await request(`/v1/files/${file}/content/x`, reader.token);
			expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
			expect(res.headers.get("Content-Disposition")).toStartWith("inline");
			expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
		}

		const asPdf = await request(`/v1/files/${pdf.id}/content/plan.pdf`, reader.token);
		expect(asPdf.headers.get("Content-Type")).toBe("application/pdf");
		expect(asPdf.headers.get("Content-Disposition")).toStartWith("inline");
		// The browser's own viewer, embedded by our pages.
		expect(asPdf.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'self'");
		expect(asPdf.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
		// The preview asks with HEAD first whether it gets a PDF to show.
		const head = await request(`/v1/files/${pdf.id}/content/plan.pdf`, reader.token, "HEAD");
		expect(head.status).toBe(200);
		expect(head.headers.get("Content-Type")).toBe("application/pdf");
		const notPdfHead = await request(`/v1/files/${notPdf.id}/content/x`, reader.token, "HEAD");
		expect(notPdfHead.headers.get("Content-Type")).toBe("application/octet-stream");

		for (const file of [html.id, notPdf.id]) {
			const res = await request(`/v1/files/${file}/content/x`, reader.token);
			expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
			expect(res.headers.get("Content-Disposition")).toStartWith("attachment");
		}

		const download = await request(`/v1/files/${csv.id}/content/x?download=1`, reader.token);
		expect(download.headers.get("Content-Disposition")).toStartWith("attachment");
	});
});

describe("Housekeeping", () => {
	test("thins out old versions and keeps the blobs of the rest", async () => {
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");
		const old = Date.now() - (FileVersions.KEEP_DAYS + 5) * 86_400_000;
		// 60 old versions, each with its own stored file as in real life.
		const blobs = await Promise.all(
			Array.from({ length: 60 }, (_, index) => FileStorage.save(new Blob([`Fassung ${index}`]))),
		);
		DB.instance()
			.insert(DB.Tables.fileVersions)
			.values(
				blobs.map((blob, index) => ({
					org_id: OrgContext.id(),
					file_id: docId,
					storage_key: blob.storageKey,
					size: blob.size,
					modified_at: old + index,
					created_at: old + index,
				})),
			)
			.run();

		const result = await Housekeeping.run(Date.now() + 2 * 86_400_000);
		expect(result.versions).toBeGreaterThan(0);

		const left = (await DB.instance().select().from(DB.Tables.fileVersions).all()).filter(
			(row) => row.file_id === docId,
		);
		expect(left.length).toBe(FileVersions.KEEP_MIN);
		// The files of the versions that went are removed; those of the kept ones aren't orphans.
		const kept = new Set(left.map((row) => row.storage_key));
		for (const blob of blobs) {
			expect(await FileStorage.open(blob.storageKey).exists()).toBe(kept.has(blob.storageKey));
		}
		const versions = await versionsOf(docId);
		await text(docId, reader.token, versions[0].content_url.replace("/api", ""));
	});
});
