/**
 * The Papierkorb of documents: deleting moves items there, they vanish everywhere else (listings,
 * file routes, share links, program attachments, event copies), who sees and restores what,
 * restoring into a folder that is gone, deleting for good, emptying, and housekeeping.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { FileTrash } from "../server/lib/api/utils/fileTrash";
import { DB } from "../server/lib/db";
import { inOrg, OrgContext } from "../server/lib/orgs/context";
import { FileStorage } from "../server/lib/utils/fileStorage";
import { makeAPIRequest } from "./helpers/api";
import { addEventMember, type SeededSession, seedSession, seedUser } from "./helpers/seed";

let leader: SeededSession;
let anna: SeededSession; // staff
let ben: SeededSession; // staff
let eventId: number;
let base: string;

function form(name: string, parentId?: number) {
	const data = new FormData();
	data.append("file", new File(["inhalt"], name, { type: "text/plain" }));
	if (parentId) data.append("parent_id", String(parentId));
	return data;
}

async function upload(token: string, name: string, parentId?: number) {
	return await makeAPIRequest(
		base,
		{ authToken: token, additionalOptions: { method: "POST", body: form(name, parentId) } },
		201,
	);
}

async function folder(token: string, name: string, parentId?: number) {
	return await makeAPIRequest(
		`${base}/folders`,
		{ method: "POST", authToken: token, body: { name, parent_id: parentId ?? null } },
		201,
	);
}

const remove = (token: string, fileId: number, code = 200) =>
	makeAPIRequest(`/v1/files/${fileId}`, { method: "DELETE", authToken: token }, code);

const names = (items: any[]) => items.map((item) => item.name).sort();

function row(fileId: number) {
	return DB.instance()
		.select()
		.from(DB.Tables.files)
		.all()
		.find((entry) => entry.id === fileId);
}

beforeAll(async () => {
	eventId = DB.instance()
		.insert(DB.Tables.events)
		.values({
			org_id: OrgContext.id(),
			name: "Herbstlager",
			start_date: "2027-10-01",
			end_date: "2027-10-05",
		})
		.returning()
		.get().id;
	base = `/v1/events/${eventId}/files`;
	const leaderUser = await seedUser("volunteer");
	const annaUser = await seedUser("volunteer", { display_name: "Anna" });
	const benUser = await seedUser("volunteer", { display_name: "Ben" });
	await addEventMember(eventId, leaderUser.id, "leader");
	await addEventMember(eventId, annaUser.id, "staff");
	await addEventMember(eventId, benUser.id, "staff");
	leader = await seedSession(leaderUser.id);
	anna = await seedSession(annaUser.id);
	ben = await seedSession(benUser.id);
});

describe("Papierkorb", () => {
	let plans: any;
	let note: any;
	let inside: any;

	test("deleted items vanish from listings and file routes", async () => {
		plans = await folder(anna.token, "Pläne");
		inside = await upload(anna.token, "ablauf.txt", plans.id);
		note = await upload(anna.token, "notiz.txt");

		await remove(anna.token, note.id);
		await remove(anna.token, plans.id);

		const root = await makeAPIRequest(base, { authToken: ben.token });
		expect(names(root.items)).not.toContain("notiz.txt");
		expect(names(root.items)).not.toContain("Pläne");
		await makeAPIRequest(`${base}?parent_id=${plans.id}`, { authToken: leader.token }, 404);
		// Also what was inside the deleted folder, even for the Leitung.
		await makeAPIRequest(`/v1/files/${inside.id}`, { authToken: leader.token }, 404);
		await makeAPIRequest(
			`/v1/files/${inside.id}/content/ablauf.txt`,
			{ authToken: leader.token },
			404,
		);
		// Nothing can be moved into a deleted folder.
		const other = await upload(anna.token, "andere.txt");
		await makeAPIRequest(
			`/v1/files/${other.id}`,
			{ method: "PUT", authToken: anna.token, body: { parent_id: plans.id } },
			400,
		);
	});

	test("everyone sees what they deleted; the Leitung sees everything", async () => {
		const own = await makeAPIRequest(`${base}/trash`, { authToken: anna.token });
		expect(names(own)).toEqual(["Pläne", "notiz.txt"]);
		expect(own[0].deleted_by.display_name).toBe("Anna");
		expect(own.find((item: any) => item.name === "Pläne").can_purge).toBe(false);

		expect(await makeAPIRequest(`${base}/trash`, { authToken: ben.token })).toEqual([]);
		const all = await makeAPIRequest(`${base}/trash`, { authToken: leader.token });
		expect(names(all)).toEqual(["Pläne", "notiz.txt"]);
		expect(all[0].can_purge).toBe(true);
		expect(all[0].purge_at - all[0].deleted_at).toBe(FileTrash.RETENTION_DAYS * 86_400_000);
	});

	test("the folder names show only to those who may still open the folder", async () => {
		const secret = await folder(anna.token, "Geheim");
		const memo = await upload(anna.token, "memo.txt", secret.id);
		await remove(anna.token, memo.id);
		const own = async () =>
			(await makeAPIRequest(`${base}/trash`, { authToken: anna.token })).find(
				(item: any) => item.id === memo.id,
			);
		expect((await own()).location).toEqual(["Geheim"]);
		// Contents in the Papierkorb aren't served: no link to them.
		expect((await own()).content_url).toBeNull();

		await makeAPIRequest(`/v1/files/${secret.id}/access`, {
			method: "PUT",
			authToken: leader.token,
			body: { custom: true, entries: [] },
		});
		expect((await own()).location).toEqual([]);
		const all = await makeAPIRequest(`${base}/trash`, { authToken: leader.token });
		expect(all.find((item: any) => item.id === memo.id).location).toEqual(["Geheim"]);
	});

	test("restoring puts items back — to the top level when their folder is gone", async () => {
		await makeAPIRequest(
			`${base}/trash/${plans.id}/restore`,
			{ method: "POST", authToken: ben.token },
			404,
		);

		// The folder comes back with what was in it.
		const restoredFolder = await makeAPIRequest(`${base}/trash/${plans.id}/restore`, {
			method: "POST",
			authToken: anna.token,
		});
		expect(restoredFolder.parent_id).toBeNull();
		const listing = await makeAPIRequest(`${base}?parent_id=${plans.id}`, { authToken: ben.token });
		expect(names(listing.items)).toEqual(["ablauf.txt"]);

		await remove(anna.token, plans.id);
		await remove(leader.token, inside.id, 404); // in the Papierkorb with its folder already
		// A file deleted on its own, then its folder.
		const sub = await folder(anna.token, "Unterordner");
		const deep = await upload(anna.token, "tief.txt", sub.id);
		await remove(anna.token, deep.id);
		await remove(anna.token, sub.id);

		// Its folder is in the Papierkorb too: only the Leitung restores it, and only for itself
		// (at the top level it would get the whole team's access, not the folder's).
		const annasTrash = await makeAPIRequest(`${base}/trash`, { authToken: anna.token });
		const entry = annasTrash.find((item: any) => item.id === deep.id);
		expect(entry).toMatchObject({ folder_in_trash: true, can_restore: false });
		await makeAPIRequest(
			`${base}/trash/${deep.id}/restore`,
			{ method: "POST", authToken: anna.token },
			409,
		);
		const back = await makeAPIRequest(`${base}/trash/${deep.id}/restore`, {
			method: "POST",
			authToken: leader.token,
		});
		expect(back.parent_id).toBeNull();
		expect(back.custom_access).toBe(true);
		await makeAPIRequest(`/v1/files/${deep.id}`, { authToken: anna.token }, 403);
		await makeAPIRequest(`/v1/files/${deep.id}`, { authToken: leader.token });
	});

	test("only the Leitung deletes for good or empties it — the files on disk go too", async () => {
		const stored = async (key: string) => await FileStorage.open(key).exists();
		// An earlier version of the note, to see that its file goes as well.
		const old = await FileStorage.save(new Blob(["ältere Fassung"]));
		DB.instance()
			.insert(DB.Tables.fileVersions)
			.values({
				org_id: OrgContext.id(),
				file_id: note.id,
				storage_key: old.storageKey,
				size: old.size,
				modified_at: Date.now(),
			})
			.run();
		const noteKey = row(note.id)?.storage_key as string;
		const insideKey = row(inside.id)?.storage_key as string;
		expect(await stored(noteKey)).toBe(true);

		await makeAPIRequest(
			`${base}/trash/${note.id}`,
			{ method: "DELETE", authToken: anna.token },
			403,
		);
		await makeAPIRequest(`${base}/trash/${note.id}`, { method: "DELETE", authToken: leader.token });
		expect(row(note.id)).toBeUndefined();
		expect(await stored(noteKey)).toBe(false);
		expect(await stored(old.storageKey)).toBe(false);

		await makeAPIRequest(`${base}/trash`, { method: "DELETE", authToken: anna.token }, 403);
		await makeAPIRequest(`${base}/trash`, { method: "DELETE", authToken: leader.token });
		expect(await makeAPIRequest(`${base}/trash`, { authToken: leader.token })).toEqual([]);
		expect(row(plans.id)).toBeUndefined();
		expect(row(inside.id)).toBeUndefined();
		expect(await stored(insideKey)).toBe(false);
	});

	test("share links stop at the Papierkorb; what a link deletes lands there", async () => {
		const shared = await folder(leader.token, "Eltern");
		const flyer = await upload(leader.token, "flyer.txt", shared.id);
		const link = await makeAPIRequest(
			`/v1/files/${shared.id}/shares`,
			{
				method: "POST",
				authToken: leader.token,
				body: { permissions: { read: true, upload: true, edit: true, delete: true } },
			},
			201,
		);
		const token = link.url.split("/s/doc/")[1];

		await makeAPIRequest(`/v1/public/docs/${token}/files/${flyer.id}`, { method: "DELETE" });
		const trash = await makeAPIRequest(`${base}/trash`, { authToken: leader.token });
		const entry = trash.find((item: any) => item.id === flyer.id);
		expect(entry.deleted_by).toBeNull();
		await makeAPIRequest(`/v1/public/docs/${token}/files/${flyer.id}/content/flyer.txt`, {}, 404);

		await makeAPIRequest(`${base}/trash/${flyer.id}/restore`, {
			method: "POST",
			authToken: leader.token,
		});
		await remove(leader.token, shared.id);
		await makeAPIRequest(`/v1/public/docs/${token}`, {}, 404);
		await makeAPIRequest(`${base}/trash/${shared.id}/restore`, {
			method: "POST",
			authToken: leader.token,
		});
		await makeAPIRequest(`/v1/public/docs/${token}`, {});
	});

	test("program items and event copies leave the Papierkorb out", async () => {
		const handout = await upload(leader.token, "handout.txt");
		const BASE = Date.UTC(2027, 9, 2, 9);
		await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: leader.token,
				body: { title: "Workshop", start_at: BASE, end_at: BASE + 3_600_000, file_ids: [handout.id] },
			},
			201,
		);
		await remove(leader.token, handout.id);
		const program = await makeAPIRequest(`/v1/events/${eventId}/program`, {
			authToken: leader.token,
		});
		expect(program[0].files).toEqual([]);

		const core = await seedSession((await seedUser("core_team")).id);
		// What is inside a deleted folder is neither counted nor copied.
		const before = await makeAPIRequest(`/v1/events/${eventId}/copy`, { authToken: core.token });
		const old = await folder(leader.token, "Altes Lager");
		await upload(leader.token, "drin.txt", old.id);
		await remove(leader.token, old.id);
		const summary = await makeAPIRequest(`/v1/events/${eventId}/copy`, { authToken: core.token });
		expect(before.documents).toBeGreaterThan(0);
		expect(summary.documents).toBe(before.documents);
		expect(summary.documents_size).toBe(before.documents_size);

		const copy = await makeAPIRequest(
			`/v1/events/${eventId}/copy`,
			{
				method: "POST",
				authToken: core.token,
				body: {
					name: "Herbstlager 2028",
					start_date: "2028-10-01",
					include: {
						team: false,
						groups: false,
						rooms: false,
						small_groups: false,
						responsibilities: false,
						program: false,
						tasks: false,
						notes: false,
						announcements: false,
						budget: false,
						documents: true,
						resources: false,
						participants: false,
					},
				},
			},
			201,
		);
		const copied = await makeAPIRequest(`/v1/events/${copy.event.id}/files`, {
			authToken: core.token,
		});
		expect(names(copied.items)).not.toContain("handout.txt");
		expect(names(copied.items)).toContain("Eltern");
	});

	test("housekeeping deletes what has been there longer than the retention", async () => {
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");
		const old = await upload(leader.token, "alt.txt");
		const recent = await upload(leader.token, "neu.txt");
		await remove(leader.token, old.id);
		await remove(leader.token, recent.id);
		DB.instance()
			.update(DB.Tables.files)
			.set({ deleted_at: Date.now() - (FileTrash.RETENTION_DAYS + 1) * 86_400_000 })
			.where(eqId(old.id))
			.run();

		const result = await Housekeeping.run(Date.now());
		expect(result.trash).toBeGreaterThanOrEqual(1);
		expect(row(old.id)).toBeUndefined();
		expect(row(recent.id)?.deleted_at).not.toBeNull();
	});
});

function eqId(id: number) {
	return and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, id));
}
