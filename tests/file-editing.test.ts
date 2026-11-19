/**
 * Editing documents: new Markdown documents, shared editing sessions (Yjs over the API: joining,
 * filling a fresh document, syncing, awareness, saving, locks, leaving, compaction), new versions
 * by upload, version history (coalescing, restore, contents) and housekeeping.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { Collab } from "../server/lib/api/utils/collab";
import { CollabSessions } from "../server/lib/api/utils/collabSessions";
import { FileService } from "../server/lib/api/utils/fileService";
import { FileVersions } from "../server/lib/api/utils/fileVersions";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { makeAPIRequest } from "./helpers/api";
import { type SeededSession, type SeededUser, seedSession, seedUser } from "./helpers/seed";

const EDIT = { read: true, upload: true, edit: true, delete: false };
const VIEW = { read: true, upload: false, edit: false, delete: false };

let core: SeededSession;
let anna: SeededSession; // volunteer, may edit in the folder
let ben: SeededSession; // volunteer, may edit in the folder
let reader: SeededSession; // volunteer, may only view
let annaUser: SeededUser;
let benUser: SeededUser;
let folderId: number;
let docId: number;

const b64 = (data: Uint8Array) => Buffer.from(data).toString("base64");

async function text(fileId: number, token: string, path = `/v1/files/${fileId}/content/x.md`) {
	const { API } = await import("../server/lib/api");
	const res = await API.getApp().request(path, {
		headers: { "X-Iventworks-Host": "test.localhost", Authorization: `Bearer ${token}` },
	});
	expect(res.status).toBe(200);
	return await res.text();
}

/** A browser tab in a shared session: a Yjs document synced through the API. */
class Tab {
	doc = new Y.Doc();
	seq: number | null = null;
	constructor(
		readonly token: string,
		readonly fileId: number,
	) {}

	async sync(body: Record<string, unknown> = {}, code = 200) {
		const result = await makeAPIRequest(
			`/v1/files/${this.fileId}/collab`,
			{
				method: "POST",
				authToken: this.token,
				body: { client_id: this.doc.clientID, after: this.seq, ...body },
			},
			code,
		);
		if (code === 200 && result) {
			if (result.state) Y.applyUpdate(this.doc, Buffer.from(result.state, "base64"), "remote");
			for (const update of result.updates)
				Y.applyUpdate(this.doc, Buffer.from(update.data, "base64"), "remote");
			this.seq = result.seq;
		}
		return result;
	}

	/** Type and send it. */
	async type(textToAdd: string, options: { init?: boolean } = {}) {
		const before = Y.encodeStateVector(this.doc);
		this.doc.getText("body").insert(this.doc.getText("body").length, textToAdd);
		return await this.sync({
			updates: [b64(Y.encodeStateAsUpdate(this.doc, before))],
			init: options.init ?? false,
		});
	}

	get value() {
		return this.doc.getText("body").toString();
	}

	async save(content = this.value, code = 200) {
		return await makeAPIRequest(
			`/v1/files/${this.fileId}/collab/content`,
			{
				method: "PUT",
				authToken: this.token,
				body: { client_id: this.doc.clientID, seq: this.seq, content },
			},
			code,
		);
	}

	async leave() {
		return await makeAPIRequest(`/v1/files/${this.fileId}/collab`, {
			method: "POST",
			authToken: this.token,
			body: { client_id: this.doc.clientID, after: this.seq, leave: true },
		});
	}
}

function uploadForm(content: string, name = "neu.md") {
	const form = new FormData();
	form.append("file", new File([content], name, { type: "text/markdown" }));
	return form;
}

function collabRow(fileId: number) {
	return DB.instance()
		.select()
		.from(DB.Tables.fileCollab)
		.all()
		.find((row) => row.file_id === fileId);
}

beforeAll(async () => {
	core = await seedSession((await seedUser("core_team")).id);
	annaUser = await seedUser("volunteer", { display_name: "Anna" });
	benUser = await seedUser("volunteer", { display_name: "Ben" });
	const readerUser = await seedUser("volunteer");
	anna = await seedSession(annaUser.id);
	ben = await seedSession(benUser.id);
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
				{ principal: "user", id: benUser.id, permissions: EDIT },
				{ principal: "user", id: readerUser.id, permissions: VIEW },
			],
		},
	});
});

describe("Markdown documents", () => {
	test("new documents get .md and their title as heading", async () => {
		const doc = await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: anna.token, body: { name: "Sitzung März", parent_id: folderId } },
			201,
		);
		docId = doc.id;
		expect(doc.name).toBe("Sitzung März.md");
		expect(doc.permissions).toMatchObject({ read: true, edit: true });
		expect(await text(docId, anna.token)).toBe("# Sitzung März\n\n");

		await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: reader.token, body: { name: "Nope", parent_id: folderId } },
			403,
		);

		// A long name is shortened, not its extension.
		const long = await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: anna.token, body: { name: "x".repeat(200), parent_id: folderId } },
			201,
		);
		expect(long.name).toEndWith(".md");
		expect(long.name).toHaveLength(FileService.MAX_NAME_LENGTH);
	});
});

describe("Shared editing", () => {
	let tabA: Tab;
	let tabB: Tab;

	test("only people who may edit join; only Markdown documents", async () => {
		await new Tab(reader.token, docId).sync({}, 403);
		const form = new FormData();
		form.append("file", new File(["a,b"], "liste.csv", { type: "text/csv" }));
		form.append("parent_id", String(folderId));
		const csv = await makeAPIRequest(
			"/v1/org/documents",
			{ authToken: core.token, additionalOptions: { method: "POST", body: form } },
			201,
		);
		await new Tab(core.token, csv.id).sync({}, 400);
	});

	test("the first tab fills the fresh document; the others wait for it", async () => {
		tabA = new Tab(anna.token, docId);
		tabB = new Tab(ben.token, docId);

		const a = await tabA.sync();
		expect(a).toMatchObject({ initialize: true, ready: false, seq: 0, state: null });
		const b = await tabB.sync();
		expect(b).toMatchObject({ initialize: false, ready: false });

		// Nobody else may write into the empty document meanwhile.
		await tabB.sync({ updates: [b64(Y.encodeStateAsUpdate(new Y.Doc()))] }, 409);

		const filled = await tabA.type("# Sitzung März\n\n", { init: true });
		expect(filled).toMatchObject({ seq: 1, ready: true, initialize: false });
	});

	test("changes reach the others, never echoed back", async () => {
		const pulled = await tabB.sync();
		expect(pulled.updates).toHaveLength(1);
		expect(tabB.value).toBe("# Sitzung März\n\n");

		await tabB.type("TOP 1");
		const a = await tabA.sync();
		expect(a.updates.map((update: any) => update.seq)).toEqual([2]);
		expect(tabA.value).toBe("# Sitzung März\n\nTOP 1");

		await tabA.type(", TOP 2");
		const b = await tabB.sync();
		expect(b.updates.map((update: any) => update.seq)).toEqual([3]);
		expect(tabB.value).toBe(tabA.value);
	});

	test("cursors carry the real name, and only the sender's own", async () => {
		const awareness = new Awareness(tabA.doc);
		awareness.setLocalState({
			user: { name: "Jemand anderes", color: "#000000" },
			cursor: { anchor: 1 },
		});
		// Someone else's state smuggled into the same update.
		const other = new Awareness(new Y.Doc());
		other.setLocalState({ user: { name: "Gefälscht" } });
		const update = encodeAwarenessUpdate(awareness, [tabA.doc.clientID]);
		await tabA.sync({ awareness: b64(update) });
		await tabA.sync({ awareness: b64(encodeAwarenessUpdate(other, [other.clientID])) });

		const b = await tabB.sync();
		expect(b.awareness).toHaveLength(0);
		await tabA.sync({ awareness: b64(update) });
		const again = await tabB.sync();
		expect(again.awareness).toHaveLength(1);
		const remote = new Awareness(new Y.Doc());
		const { applyAwarenessUpdate } = await import("y-protocols/awareness");
		applyAwarenessUpdate(remote, Buffer.from(again.awareness[0].data, "base64"), "remote");
		const state = remote.getStates().get(tabA.doc.clientID) as any;
		expect(state.user).toEqual({ name: "Anna", color: Collab.colorFor(annaUser.id) });
		expect(state.cursor).toEqual({ anchor: 1 });
		expect(again.participants.map((entry: any) => entry.user.display_name).sort()).toEqual([
			"Anna",
			"Ben",
		]);
	});

	test("the file is locked while the session runs and shows who edits", async () => {
		await makeAPIRequest(
			`/v1/files/${docId}/content`,
			{ authToken: core.token, additionalOptions: { method: "PUT", body: uploadForm("x") } },
			409,
		);
		await makeAPIRequest(`/v1/files/${docId}`, { method: "DELETE", authToken: core.token }, 409);

		const details = await makeAPIRequest(`/v1/files/${docId}`, { authToken: reader.token });
		expect(details.editing.kind).toBe("editor");
		expect(details.editing.users.map((user: any) => user.display_name).sort()).toEqual([
			"Anna",
			"Ben",
		]);
	});

	test("tabs write the Markdown back; older texts never overwrite newer ones", async () => {
		const saved = await tabA.save();
		expect(saved).toEqual({ saved_seq: 3, saved: true });
		expect(await text(docId, reader.token)).toBe("# Sitzung März\n\nTOP 1, TOP 2");

		const stale = await makeAPIRequest(`/v1/files/${docId}/collab/content`, {
			method: "PUT",
			authToken: ben.token,
			body: { client_id: tabB.doc.clientID, seq: 2, content: "alt" },
		});
		expect(stale).toEqual({ saved_seq: 3, saved: false });
		await makeAPIRequest(
			`/v1/files/${docId}/collab/content`,
			{
				method: "PUT",
				authToken: ben.token,
				body: { client_id: tabB.doc.clientID, seq: 99, content: "x" },
			},
			409,
		);
		expect(await text(docId, reader.token)).toBe("# Sitzung März\n\nTOP 1, TOP 2");
	});

	test("when the last one leaves fully saved, the file is free and the state is gone", async () => {
		await tabA.leave();
		expect(collabRow(docId)).toBeDefined();
		await tabB.leave();
		expect(collabRow(docId)).toBeUndefined();
		const details = await makeAPIRequest(`/v1/files/${docId}`, { authToken: reader.token });
		expect(details.editing).toBeNull();
	});

	test("unsaved changes survive the session; changes from outside throw them away", async () => {
		const tab = new Tab(anna.token, docId);
		expect((await tab.sync()).initialize).toBe(true);
		await tab.type("Entwurf", { init: true });
		await tab.leave();
		expect(collabRow(docId)?.seq).toBe(1);

		const back = new Tab(ben.token, docId);
		const joined = await back.sync();
		expect(joined).toMatchObject({ initialize: false, ready: true });
		expect(back.value).toBe("Entwurf");
		await back.leave();

		// A new version from outside: the old shared state is worthless now.
		await makeAPIRequest(`/v1/files/${docId}/content`, {
			authToken: core.token,
			additionalOptions: { method: "PUT", body: uploadForm("# Neu") },
		});
		expect(collabRow(docId)).toBeUndefined();
		const fresh = new Tab(anna.token, docId);
		expect((await fresh.sync()).initialize).toBe(true);
		await fresh.leave();
	});

	test("long sessions are compacted; tabs that fell behind get the whole state", async () => {
		CollabSessions.clear();
		const writer = new Tab(anna.token, docId);
		await writer.sync();
		await writer.type("x", { init: true });
		const lagging = new Tab(ben.token, docId);
		await lagging.sync();
		const behind = lagging.seq;

		for (let i = 0; i < Collab.COMPACT_AFTER + 5; i++) await writer.type(String(i % 10));
		const row = collabRow(docId);
		expect(row?.base_seq).toBeGreaterThan(behind ?? 0);

		const caughtUp = await lagging.sync();
		expect(caughtUp.state).not.toBeNull();
		expect(lagging.value).toBe(writer.value);
		await writer.save();
		await writer.leave();
		await lagging.leave();
	}, 60_000);

	test("only a tab's own person makes it leave; leaving hands on filling the document", async () => {
		const doc = await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: anna.token, body: { name: "Übergabe", parent_id: folderId } },
			201,
		);
		const first = new Tab(anna.token, doc.id);
		const second = new Tab(ben.token, doc.id);
		expect((await first.sync()).initialize).toBe(true);
		expect((await second.sync()).initialize).toBe(false);

		// Ben can't make Anna's tab leave.
		await makeAPIRequest(`/v1/files/${doc.id}/collab`, {
			method: "POST",
			authToken: ben.token,
			body: { client_id: first.doc.clientID, after: null, leave: true },
		});
		const stillThere = await second.sync();
		expect(stillThere.participants.map((entry: any) => entry.client_id)).toContain(
			first.doc.clientID,
		);

		// Anna leaves before filling it: Ben's tab is told to.
		await first.leave();
		const handedOn = await second.sync();
		expect(handedOn.initialize).toBe(true);
		await second.type("# Übergabe\n\n", { init: true });
		await second.save();
		await second.leave();
	}, 30_000);

	test("a tab that was away while its session ended starts over", async () => {
		const doc = await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: anna.token, body: { name: "Unterwegs", parent_id: folderId } },
			201,
		);
		const away = new Tab(anna.token, doc.id);
		const joined = await away.sync();
		await away.type("Text", { init: true });
		await away.save();
		const epoch = joined.epoch;

		// The server dropped the quiet tab; someone else came and left fully saved, which ended the
		// session; then a new one started.
		CollabSessions.clear();
		const other = new Tab(ben.token, doc.id);
		await other.sync();
		await other.leave();
		expect(collabRow(doc.id)).toBeUndefined();
		const fresh = new Tab(ben.token, doc.id);
		const started = await fresh.sync();
		expect(started.epoch).not.toBe(epoch);
		await fresh.type(" und mehr", { init: true });

		// Same `seq` as before, but another document: nothing of it is taken.
		expect(away.seq).toBe(collabRow(doc.id)?.seq ?? -1);
		const before = Y.encodeStateVector(away.doc);
		away.doc.getText("body").insert(0, "weg ");
		const reset = await away.sync({
			epoch,
			updates: [b64(Y.encodeStateAsUpdate(away.doc, before))],
		});
		expect(reset).toMatchObject({ reset: true, state: null, updates: [] });
		expect(collabRow(doc.id)?.seq).toBe(1);
		await makeAPIRequest(
			`/v1/files/${doc.id}/collab/content`,
			{
				method: "PUT",
				authToken: anna.token,
				body: { client_id: away.doc.clientID, seq: 1, epoch, content: "weg" },
			},
			409,
		);
		// Without an epoch: a `seq` beyond the document's tells too.
		expect((await new Tab(anna.token, doc.id).sync({ after: 50 })).reset).toBe(true);

		await fresh.save();
		await fresh.leave();
	}, 30_000);

	test("a folder can't be deleted while a document in it is being edited", async () => {
		const running = await makeAPIRequest(
			"/v1/org/documents/folders",
			{ method: "POST", authToken: core.token, body: { name: "Laufend", parent_id: folderId } },
			201,
		);
		const doc = await makeAPIRequest(
			"/v1/org/documents/markdown",
			{ method: "POST", authToken: anna.token, body: { name: "Offen", parent_id: running.id } },
			201,
		);
		const tab = new Tab(anna.token, doc.id);
		await tab.sync();
		await tab.type("x", { init: true });
		await makeAPIRequest(`/v1/files/${running.id}`, { method: "DELETE", authToken: core.token }, 409);
		await makeAPIRequest(`/v1/files/${folderId}`, { method: "DELETE", authToken: core.token }, 409);

		await tab.save();
		await tab.leave();
		await makeAPIRequest(`/v1/files/${running.id}`, { method: "DELETE", authToken: core.token });
	}, 30_000);
});

describe("Versions", () => {
	test("autosaves keep one version per person every few minutes; others' contents are always kept", async () => {
		const before = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });

		const tab = new Tab(anna.token, docId);
		await tab.sync();
		await tab.type("A", { init: true });
		await tab.save();
		await tab.type("B");
		await tab.save();
		await tab.leave();
		const afterAnna = await makeAPIRequest(`/v1/files/${docId}/versions`, {
			authToken: reader.token,
		});
		// Core's upload became a version once (another author); Anna's second save didn't add one.
		expect(afterAnna.length - before.length).toBeLessThanOrEqual(1);

		await makeAPIRequest(`/v1/files/${docId}/content`, {
			authToken: core.token,
			additionalOptions: { method: "PUT", body: uploadForm("# Vom Kernteam") },
		});
		const versions = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		expect(versions.length).toBe(afterAnna.length + 1);
		expect(versions[0].modified_by.display_name).toBe("Anna");
		expect(await text(docId, reader.token, versions[0].content_url.replace("/api", ""))).toBe(
			tab.value,
		);
	});

	test("in a session, people saving in turns don't add a version each", async () => {
		const before = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		const one = new Tab(anna.token, docId);
		const two = new Tab(ben.token, docId);
		await one.sync();
		await one.type("Start", { init: true });
		await two.sync();
		for (let i = 0; i < 3; i++) {
			await one.type(" a");
			await one.save();
			await two.sync();
			await two.type(" b");
			await two.save();
			await one.sync();
		}
		const after = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		expect(after.length - before.length).toBeLessThanOrEqual(1);
		expect(await text(docId, reader.token)).toBe(two.value);
		await one.leave();
		await two.leave();
	}, 30_000);

	test("restoring makes an old version current and keeps the current one", async () => {
		const versions = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
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
		expect(await text(docId, reader.token)).toBe("# Sitzung März\n\n");
		const after = await makeAPIRequest(`/v1/files/${docId}/versions`, { authToken: reader.token });
		expect(after.map((version: any) => version.id)).not.toContain(oldest.id);
		expect(after).toHaveLength(versions.length);
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
		const tab = new Tab(anna.token, docId);
		await tab.sync();
		await makeAPIRequest(
			`/v1/shares/${token}/files/${docId}/content`,
			{ additionalOptions: { method: "PUT", body: uploadForm("von außen") } },
			409,
		);
		await tab.leave();
	});
});

describe("Housekeeping", () => {
	test("thins out old versions and keeps the blobs of the rest", async () => {
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");
		const old = Date.now() - (FileVersions.KEEP_DAYS + 5) * 86_400_000;
		const blob = (await DB.instance().select().from(DB.Tables.fileVersions).all()).find(
			(row) => row.file_id === docId,
		)!;
		DB.instance()
			.insert(DB.Tables.fileVersions)
			.values(
				Array.from({ length: 60 }, () => ({
					org_id: OrgContext.id(),
					file_id: docId,
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
