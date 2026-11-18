/**
 * Editing documents: new Markdown documents, the editor lock, saving text, new versions by
 * upload, version history (coalescing, restore, contents), and that locks block others.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { FileVersions } from "../server/lib/api/utils/fileVersions";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { makeAPIRequest } from "./helpers/api";
import { type SeededSession, type SeededUser, seedSession, seedUser } from "./helpers/seed";

const EDIT = { read: true, upload: true, edit: true, delete: false };

let core: SeededSession;
let editor: SeededSession; // volunteer with edit rights in the folder
let reader: SeededSession; // volunteer with view rights
let editorUser: SeededUser;
let folderId: number;
let docId: number;

async function text(fileId: number, token: string, path = `/v1/files/${fileId}/content/x.md`) {
	const { API } = await import("../server/lib/api");
	const res = await API.getApp().request(path, {
		headers: { "X-Iventworks-Host": "test.localhost", Authorization: `Bearer ${token}` },
	});
	expect(res.status).toBe(200);
	return await res.text();
}

async function lock(fileId: number, token: string) {
	return await makeAPIRequest(`/v1/files/${fileId}/lock`, { method: "POST", authToken: token });
}

async function save(fileId: number, token: string, content: string, lockId: string, code = 200) {
	return await makeAPIRequest(
		`/v1/files/${fileId}/text`,
		{ method: "PUT", authToken: token, body: { content, lock_id: lockId } },
		code,
	);
}

function uploadForm(content: string, name = "neu.md") {
	const form = new FormData();
	form.append("file", new File([content], name, { type: "text/markdown" }));
	return form;
}

beforeAll(async () => {
	core = await seedSession((await seedUser("core_team")).id);
	editorUser = await seedUser("volunteer", { display_name: "Edda" });
	editor = await seedSession(editorUser.id);
	const readerUser = await seedUser("volunteer");
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
				{ principal: "user", id: editorUser.id, permissions: EDIT },
				{
					principal: "user",
					id: readerUser.id,
					permissions: { read: true, upload: false, edit: false, delete: false },
				},
			],
		},
	});
});

describe("Markdown documents", () => {
	test("new documents get .md and their title as heading", async () => {
		const doc = await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: editor.token, body: { name: "Sitzung März", parent_id: folderId } },
			201,
		);
		docId = doc.id;
		expect(doc.name).toBe("Sitzung März.md");
		expect(doc.permissions).toMatchObject({ read: true, edit: true });
		expect(await text(docId, editor.token)).toBe("# Sitzung März\n\n");

		await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: reader.token, body: { name: "Nope", parent_id: folderId } },
			403,
		);
	});

	test("one person edits at a time; others see who", async () => {
		await makeAPIRequest(`/v1/files/${docId}/lock`, { method: "POST", authToken: reader.token }, 403);

		const mine = await lock(docId, editor.token);
		expect(mine.acquired).toBe(true);
		expect(mine.editing.user.display_name).toBe("Edda");

		const theirs = await lock(docId, core.token);
		expect(theirs).toMatchObject({ acquired: false, lock_id: null });
		expect(theirs.editing.user.id).toBe(editorUser.id);

		const details = await makeAPIRequest(`/v1/files/${docId}`, { authToken: reader.token });
		expect(details.editing.user.display_name).toBe("Edda");
		const listing = await makeAPIRequest(`/v1/org/documents?parent_id=${folderId}`, {
			authToken: reader.token,
		});
		expect(listing.items.find((item: any) => item.id === docId).editing.kind).toBe("editor");

		// Others can't replace or delete it meanwhile.
		await makeAPIRequest(
			`/v1/files/${docId}/content`,
			{ authToken: core.token, additionalOptions: { method: "PUT", body: uploadForm("x") } },
			409,
		);
		await makeAPIRequest(`/v1/files/${docId}`, { method: "DELETE", authToken: core.token }, 409);

		// Saving needs the lock; a second tab takes over and the first one's saves are refused.
		await save(docId, core.token, "fremd", "falsch", 409);
		const second = await lock(docId, editor.token);
		await save(docId, editor.token, "alt", mine.lock_id, 409);
		await save(docId, editor.token, "# Sitzung März\n\nTOP 1", second.lock_id);
		expect(await text(docId, reader.token)).toBe("# Sitzung März\n\nTOP 1");

		await makeAPIRequest(`/v1/files/${docId}/lock`, {
			method: "PUT",
			authToken: editor.token,
			body: { lock_id: second.lock_id },
		});
		await makeAPIRequest(`/v1/files/${docId}/lock?lock_id=${second.lock_id}`, {
			method: "DELETE",
			authToken: editor.token,
		});
		expect((await lock(docId, core.token)).acquired).toBe(true);
		// Managers can end someone else's editing.
		await makeAPIRequest(
			`/v1/files/${docId}/lock?force=1`,
			{ method: "DELETE", authToken: editor.token },
			403,
		);
		await makeAPIRequest(`/v1/files/${docId}/lock?force=1`, {
			method: "DELETE",
			authToken: core.token,
		});
	});

	test("autosaves keep one version per person every few minutes", async () => {
		const versionsBefore = await makeAPIRequest(`/v1/files/${docId}/versions`, {
			authToken: reader.token,
		});
		// The template, kept when Edda first saved.
		expect(versionsBefore).toHaveLength(1);
		expect(versionsBefore[0].modified_by.display_name).toBe("Edda");

		const { lock_id } = await lock(docId, editor.token);
		await save(docId, editor.token, "TOP 1, TOP 2", lock_id);
		await save(docId, editor.token, "TOP 1, TOP 2, TOP 3", lock_id);
		await makeAPIRequest(`/v1/files/${docId}/lock?lock_id=${lock_id}`, {
			method: "DELETE",
			authToken: editor.token,
		});
		expect(
			await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token }),
		).toHaveLength(1);

		// Someone else's contents are always kept.
		await makeAPIRequest(`/v1/files/${docId}/content`, {
			authToken: core.token,
			additionalOptions: { method: "PUT", body: uploadForm("# Vom Kernteam") },
		});
		const versions = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		expect(versions).toHaveLength(2);
		expect(await text(docId, reader.token, versions[0].content_url.replace("/api", ""))).toBe(
			"TOP 1, TOP 2, TOP 3",
		);
	});

	test("restoring makes an old version current and keeps the current one", async () => {
		const versions = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		const template = versions.at(-1);
		await makeAPIRequest(
			`/v1/files/${docId}/versions/${template.id}/restore`,
			{ method: "POST", authToken: reader.token },
			403,
		);
		await makeAPIRequest(`/v1/files/${docId}/versions/${template.id}/restore`, {
			method: "POST",
			authToken: editor.token,
		});
		expect(await text(docId, reader.token)).toBe("# Sitzung März\n\n");
		const after = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		expect(after.map((version: any) => version.id)).not.toContain(template.id);
		expect(after).toHaveLength(2);
	});

	test("only Markdown documents open in the editor", async () => {
		const form = new FormData();
		form.append("file", new File(["a,b"], "liste.csv", { type: "text/csv" }));
		form.append("parent_id", String(folderId));
		const csv = await makeAPIRequest(
			"/v1/org/documents",
			{ authToken: core.token, additionalOptions: { method: "POST", body: form } },
			201,
		);
		await makeAPIRequest(`/v1/files/${csv.id}/lock`, { method: "POST", authToken: core.token }, 400);
	});

	test("share links can't replace a file someone is editing", async () => {
		const share = await makeAPIRequest(
			`/v1/files/${docId}/shares`,
			{
				method: "POST",
				authToken: core.token,
				body: { permissions: { read: true, upload: false, edit: true, delete: false } },
			},
			201,
		);
		const token = share.url.split("/s/")[1];
		const { lock_id } = await lock(docId, editor.token);
		await makeAPIRequest(
			`/v1/shares/${token}/files/${docId}/content`,
			{ additionalOptions: { method: "PUT", body: uploadForm("von außen") } },
			409,
		);
		await makeAPIRequest(`/v1/files/${docId}/lock?lock_id=${lock_id}`, {
			method: "DELETE",
			authToken: editor.token,
		});
	});
});

describe("Housekeeping", () => {
	test("thins out old versions and keeps the blobs of the rest", async () => {
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");
		const file = DB.instance()
			.select()
			.from(DB.Tables.files)
			.all()
			.find((row) => row.id === docId)!;
		const old = Date.now() - (FileVersions.KEEP_DAYS + 5) * 86_400_000;
		const blob = (await DB.instance().select().from(DB.Tables.fileVersions).all()).find(
			(row) => row.file_id === docId,
		)!;
		DB.instance()
			.insert(DB.Tables.fileVersions)
			.values(
				Array.from({ length: 60 }, () => ({
					org_id: OrgContext.id(),
					file_id: file.id,
					storage_key: blob.storage_key,
					size: blob.size,
					modified_at: old,
					created_at: old,
				})),
			)
			.run();

		const result = await Housekeeping.run(Date.now() + 2 * 86_400_000);
		expect(result.versions).toBeGreaterThan(0);

		const left = (await DB.instance().select().from(DB.Tables.fileVersions).all()).filter(
			(row) => row.file_id === docId,
		);
		expect(left.length).toBe(FileVersions.KEEP_MIN);
		// Version blobs are not orphans.
		const versions = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		await text(docId, reader.token, versions[0].content_url.replace("/api", ""));
	});
});
