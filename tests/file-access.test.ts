/**
 * Access lists on org and event documents (`FileAccess`, `file_access`): defaults, inheritance,
 * the "open every folder above" rule, upload-only folders, own uploads, items with their own list,
 * org and event groups, the member view, validation, program attachments and event copies.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { FileService } from "../server/lib/api/utils/fileService";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { makeAPIRequest } from "./helpers/api";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

const VIEW = { read: true, upload: false, edit: false, delete: false };
const UPLOAD = { read: true, upload: true, edit: false, delete: false };
const FULL = { read: true, upload: true, edit: true, delete: true };
const DROPBOX = { read: false, upload: true, edit: false, delete: false };

let admin: SeededSession;
let core: SeededSession;
let alice: SeededSession; // volunteer, in the org group "Technik"
let bob: SeededSession; // volunteer
let aliceUser: SeededUser;
let bobUser: SeededUser;

function form(name: string, parentId?: number) {
	const data = new FormData();
	data.append("file", new File(["inhalt"], name, { type: "text/plain" }));
	if (parentId) data.append("parent_id", String(parentId));
	return data;
}

async function upload(path: string, token: string, name: string, parentId?: number, code = 201) {
	const result = await makeAPIRequest(
		path,
		{ authToken: token, additionalOptions: { method: "POST", body: form(name, parentId) } },
		code,
	);
	if (code === 201) created.add(result.id);
	return result;
}

async function folder(path: string, token: string, name: string, parentId?: number, code = 201) {
	const result = await makeAPIRequest(
		`${path}/folders`,
		{ method: "POST", authToken: token, body: { name, parent_id: parentId ?? null } },
		code,
	);
	if (code === 201) created.add(result.id);
	return result;
}

async function setAccess(
	fileId: number,
	token: string,
	entries: Array<{ principal: string; id?: number; permissions: typeof VIEW }>,
	code = 200,
) {
	return await makeAPIRequest(
		`/v1/files/${fileId}/access`,
		{ method: "PUT", authToken: token, body: { custom: true, entries } },
		code,
	);
}

async function list(path: string, token: string, parentId?: number, code = 200) {
	return await makeAPIRequest(
		`${path}${parentId ? `?parent_id=${parentId}` : ""}`,
		{ authToken: token },
		code,
	);
}

/** Ids of everything this file created: other test files leave documents in the shared test org. */
const created = new Set<number>();
const names = (listing: any) =>
	listing.items
		.filter((item: any) => created.has(item.id))
		.map((item: any) => item.name)
		.sort();

beforeAll(async () => {
	admin = await seedSession((await seedUser("admin")).id);
	core = await seedSession((await seedUser("core_team")).id);
	aliceUser = await seedUser("volunteer", { display_name: "Alice" });
	bobUser = await seedUser("volunteer", { display_name: "Bob" });
	alice = await seedSession(aliceUser.id);
	bob = await seedSession(bobUser.id);
});

describe("Org documents", () => {
	const ORG = "/v1/org/documents";
	let groupId: number;
	let internId: number;
	let guidesId: number;
	let techId: number;
	let dropId: number;

	test("admins manage org groups; nobody else does", async () => {
		await makeAPIRequest("/v1/admin/groups", { authToken: core.token }, 403);
		const group = await makeAPIRequest(
			"/v1/admin/groups",
			{
				method: "POST",
				authToken: admin.token,
				body: { name: "Technik", member_ids: [aliceUser.id] },
			},
			201,
		);
		groupId = group.id;
		expect(group.member_count).toBe(1);

		const all = await makeAPIRequest("/v1/admin/groups", { authToken: admin.token });
		expect(all.map((entry: any) => entry.name)).toContain("Technik");
	});

	test("new items are Kernteam-only; the Kernteam sees who has access", async () => {
		internId = (await folder(ORG, core.token, "Intern")).id;
		guidesId = (await folder(ORG, core.token, "Leitfäden")).id;
		techId = (await folder(ORG, core.token, "Technik")).id;
		dropId = (await folder(ORG, core.token, "Abgabe")).id;
		await upload(ORG, core.token, "intern.txt", internId);

		expect(names(await list(ORG, alice.token))).toEqual([]);
		await makeAPIRequest(`/v1/files/${internId}`, { authToken: alice.token }, 403);
		await upload(ORG, alice.token, "nope.txt", undefined, 403);

		const root = await list(ORG, core.token);
		expect(root.permissions.manage).toBe(true);
		expect(root.access).toEqual({
			custom: false,
			inherited_from: null,
			entries: [],
			inherits: { from: null, entries: [] },
		});
	});

	test("members, groups and single people get exactly what their entry allows", async () => {
		await setAccess(guidesId, core.token, [{ principal: "members", permissions: VIEW }]);
		await setAccess(techId, core.token, [{ principal: "org_group", id: groupId, permissions: FULL }]);
		await setAccess(dropId, core.token, [{ principal: "members", permissions: DROPBOX }]);
		await upload(ORG, core.token, "leitfaden.txt", guidesId);

		expect(names(await list(ORG, alice.token))).toEqual(["Abgabe", "Leitfäden", "Technik"]);
		expect(names(await list(ORG, bob.token))).toEqual(["Abgabe", "Leitfäden"]);

		const guides = await list(ORG, bob.token, guidesId);
		expect(guides.permissions).toMatchObject({ read: true, upload: false, manage: false });
		expect(guides.access).toBeNull();
		expect(names(guides)).toEqual(["leitfaden.txt"]);
		await upload(ORG, bob.token, "x.txt", guidesId, 403);
		const file = guides.items[0];
		expect(file.permissions).toMatchObject({ read: true, edit: false, rename: false, delete: false });
		await makeAPIRequest(`/v1/files/${file.id}`, { method: "DELETE", authToken: bob.token }, 403);

		// The group may work in its folder, but not rename or delete the folder itself.
		await upload(ORG, alice.token, "plan.txt", techId);
		await list(ORG, bob.token, techId, 404);
		await makeAPIRequest(
			`/v1/files/${techId}`,
			{ method: "PUT", authToken: alice.token, body: { name: "Umbenannt" } },
			403,
		);
		await makeAPIRequest(`/v1/files/${techId}`, { method: "DELETE", authToken: alice.token }, 403);
		const coreFile = await upload(ORG, core.token, "von-kernteam.txt", techId);
		await makeAPIRequest(`/v1/files/${coreFile.id}`, { method: "DELETE", authToken: alice.token });
	});

	test("upload-only folders take files without showing them", async () => {
		const root = await list(ORG, bob.token);
		const drop = root.items.find((item: any) => item.id === dropId);
		expect(drop.permissions).toMatchObject({ read: false, upload: true });

		const uploaded = await upload(ORG, bob.token, "abgabe.txt", dropId);
		expect(uploaded.permissions.read).toBe(false);
		expect(names(await list(ORG, bob.token, dropId))).toEqual([]);
		await makeAPIRequest(
			`/v1/files/${uploaded.id}/content/abgabe.txt`,
			{ authToken: bob.token },
			403,
		);
		expect(names(await list(ORG, core.token, dropId))).toEqual(["abgabe.txt"]);
	});

	test("an item is hidden when a folder above it can't be opened", async () => {
		const open = await folder(ORG, core.token, "Offen", internId);
		await setAccess(open.id, core.token, [{ principal: "members", permissions: VIEW }]);
		await makeAPIRequest(`/v1/files/${open.id}`, { authToken: bob.token }, 403);
		await list(ORG, bob.token, open.id, 404);
	});

	test("lists are inherited until an item has its own", async () => {
		const sub = await folder(ORG, core.token, "Unterordner", guidesId);
		const bobOnly = await folder(ORG, core.token, "Nur Bob", guidesId);
		await setAccess(bobOnly.id, core.token, [
			{ principal: "user", id: bobUser.id, permissions: UPLOAD },
		]);
		// Bob hears about it — once, not again when the list is saved unchanged.
		const shared = () =>
			DB.instance()
				.select()
				.from(DB.Tables.notifications)
				.all()
				.filter((row) => row.user_id === bobUser.id && row.type === "document_shared");
		expect(shared()).toHaveLength(1);
		expect(shared()[0]?.title).toContain("„Nur Bob“");
		expect(shared()[0]?.link).toBe(`/documents?folder=${bobOnly.id}`);
		await setAccess(bobOnly.id, core.token, [
			{ principal: "user", id: bobUser.id, permissions: UPLOAD },
		]);
		expect(shared()).toHaveLength(1);

		expect(names(await list(ORG, alice.token, guidesId))).toEqual(["Unterordner", "leitfaden.txt"]);
		expect(names(await list(ORG, bob.token, guidesId))).toEqual([
			"Nur Bob",
			"Unterordner",
			"leitfaden.txt",
		]);
		await upload(ORG, bob.token, "bob.txt", bobOnly.id);

		const inherited = await makeAPIRequest(`/v1/files/${sub.id}/access`, { authToken: core.token });
		expect(inherited.custom).toBe(false);
		expect(inherited.inherited_from).toEqual({ id: guidesId, name: "Leitfäden" });
		expect(inherited.entries.map((entry: any) => entry.label)).toEqual(["Alle Mitglieder"]);
		expect(inherited.inherits).toEqual({
			from: inherited.inherited_from,
			entries: inherited.entries,
		});

		// With an own list: what it would inherit again ("Übernehmen" in the dialog).
		const own = await makeAPIRequest(`/v1/files/${bobOnly.id}/access`, { authToken: core.token });
		expect(own.custom).toBe(true);
		expect(own.entries.map((entry: any) => entry.label)).toEqual(["Bob"]);
		expect(own.inherits.from).toEqual({ id: guidesId, name: "Leitfäden" });
		expect(own.inherits.entries.map((entry: any) => entry.label)).toEqual(["Alle Mitglieder"]);
		// At the top level: the library's default (org documents: only the Kernteam).
		const top = await makeAPIRequest(`/v1/files/${guidesId}/access`, { authToken: core.token });
		expect(top.custom).toBe(true);
		expect(top.inherits).toEqual({ from: null, entries: [] });

		const listing = await list(ORG, core.token, guidesId);
		const bobFolder = listing.items.find((item: any) => item.id === bobOnly.id);
		expect(bobFolder.access).toEqual([
			{ principal: "user", id: bobUser.id, label: "Bob", color: null, permissions: UPLOAD },
		]);
		expect(listing.items.find((item: any) => item.id === sub.id).access).toBeNull();
	});

	test("a file's details name the folders above it", async () => {
		const sub = await folder(ORG, core.token, "Vorlagen", guidesId);
		const file = await upload(ORG, core.token, "vorlage.txt", sub.id);
		const details = await makeAPIRequest(`/v1/files/${file.id}`, { authToken: bob.token });
		expect(details.path).toEqual([
			{ id: guidesId, name: "Leitfäden" },
			{ id: sub.id, name: "Vorlagen" },
		]);
		expect(details.event).toBeNull();
		expect(details.permissions).toMatchObject({ read: true, edit: false, manage: false });
	});

	test("the Kernteam's member view shows the library like a member sees it", async () => {
		const view = await list(`${ORG}?view=member`, core.token);
		expect(names(view)).toEqual(["Abgabe", "Leitfäden"]);
		expect(view.access).toBeNull();
		expect(view.permissions.manage).toBe(false);
	});

	test("only managers change access; lists are checked", async () => {
		await setAccess(guidesId, alice.token, [], 403);
		await makeAPIRequest(`/v1/files/${guidesId}/access/candidates`, { authToken: alice.token }, 403);
		await setAccess(guidesId, core.token, [{ principal: "team", permissions: VIEW }], 400);
		await setAccess(
			guidesId,
			core.token,
			[{ principal: "org_group", id: 999_999, permissions: VIEW }],
			400,
		);
		await setAccess(guidesId, core.token, [{ principal: "members", id: 1, permissions: VIEW }], 400);
		await setAccess(
			guidesId,
			core.token,
			[
				{ principal: "members", permissions: VIEW },
				{ principal: "members", permissions: FULL },
			],
			400,
		);

		const candidates = await makeAPIRequest(`/v1/files/${guidesId}/access/candidates`, {
			authToken: core.token,
		});
		const labels = candidates.map((candidate: any) => `${candidate.principal}:${candidate.label}`);
		expect(labels).toContain("members:Alle Mitglieder");
		expect(labels).toContain("org_group:Technik");
		expect(labels).toContain("user:Alice");
		expect(candidates.some((candidate: any) => candidate.id === admin.user_id)).toBe(false);
	});

	test("files only take view or edit; inheriting again removes the list", async () => {
		const file = await upload(ORG, core.token, "datei.txt", guidesId);
		const view = await setAccess(file.id, core.token, [{ principal: "members", permissions: FULL }]);
		expect(view.entries[0].permissions).toEqual({
			read: true,
			upload: false,
			edit: true,
			delete: false,
		});

		const reset = await makeAPIRequest(`/v1/files/${file.id}/access`, {
			method: "PUT",
			authToken: core.token,
			body: { custom: false, entries: [] },
		});
		expect(reset.custom).toBe(false);
		expect(reset.inherited_from?.id).toBe(guidesId);
		const rows = DB.instance()
			.select()
			.from(DB.Tables.fileAccess)
			.all()
			.filter((row) => row.file_id === file.id);
		expect(rows).toHaveLength(0);
	});

	test("deleting a group ends its access", async () => {
		await makeAPIRequest(`/v1/admin/groups/${groupId}`, { method: "DELETE", authToken: admin.token });
		expect(names(await list(ORG, alice.token))).toEqual(["Abgabe", "Leitfäden"]);
	});
});

describe("Event documents", () => {
	let eventId: number;
	let leader: SeededSession;
	let staffA: SeededSession;
	let staffB: SeededSession;
	let staffAUser: SeededUser;
	let staffBUser: SeededUser;
	let kitchenId: number;
	let leadId: number;
	let secretFileId: number;
	let path: string;

	beforeAll(async () => {
		eventId = DB.instance()
			.insert(DB.Tables.events)
			.values({
				org_id: OrgContext.id(),
				name: "Sommerlager",
				start_date: "2027-07-01",
				end_date: "2027-07-08",
			})
			.returning()
			.get().id;
		path = `/v1/events/${eventId}/files`;
		const leaderUser = await seedUser("volunteer");
		staffAUser = await seedUser("volunteer", { display_name: "Anna" });
		staffBUser = await seedUser("volunteer", { display_name: "Ben" });
		await addEventMember(eventId, leaderUser.id, "leader");
		await addEventMember(eventId, staffAUser.id, "staff");
		await addEventMember(eventId, staffBUser.id, "staff");
		leader = await seedSession(leaderUser.id);
		staffA = await seedSession(staffAUser.id);
		staffB = await seedSession(staffBUser.id);

		const group = await makeAPIRequest(
			`/v1/events/${eventId}/groups`,
			{
				method: "POST",
				authToken: leader.token,
				body: { name: "Küche", member_ids: [staffAUser.id] },
			},
			201,
		);
		kitchenId = group.id;
	});

	test("by default the whole team views and uploads; own uploads stay theirs", async () => {
		const root = await list(path, staffA.token);
		expect(root.permissions).toMatchObject({ read: true, upload: true, manage: false });

		const mine = await upload(path, staffA.token, "mein-plan.txt");
		expect(mine.permissions).toMatchObject({ rename: true, delete: true, edit: true });
		const theirs = await upload(path, staffB.token, "bens-plan.txt");
		await makeAPIRequest(
			`/v1/files/${theirs.id}`,
			{ method: "DELETE", authToken: staffA.token },
			403,
		);
		await makeAPIRequest(`/v1/files/${mine.id}`, {
			method: "PUT",
			authToken: staffA.token,
			body: { name: "plan.txt" },
		});

		const leaderView = await list(path, leader.token);
		expect(leaderView.access.entries.map((entry: any) => entry.label)).toEqual(["Alle im Team"]);
	});

	test("Nur Leitung: hidden from the team, open to the Leitung and the Kernteam", async () => {
		leadId = (await folder(path, leader.token, "Leitung")).id;
		await setAccess(leadId, leader.token, []);
		secretFileId = (await upload(path, leader.token, "geheim.txt", leadId)).id;

		expect(names(await list(path, staffA.token))).not.toContain("Leitung");
		await makeAPIRequest(
			`/v1/files/${secretFileId}/content/geheim.txt`,
			{ authToken: staffA.token },
			403,
		);
		// The Kernteam acts as Leitung in every event, also without being on its team.
		expect(names(await list(path, core.token, leadId))).toEqual(["geheim.txt"]);

		const details = await makeAPIRequest(`/v1/files/${secretFileId}`, { authToken: core.token });
		expect(details.event).toEqual({ id: eventId, name: "Sommerlager" });
		expect(details.path).toEqual([{ id: leadId, name: "Leitung" }]);
	});

	test("event groups and team members; people from outside the team are refused", async () => {
		const kitchen = await folder(path, leader.token, "Küche");
		await setAccess(kitchen.id, leader.token, [
			{ principal: "event_group", id: kitchenId, permissions: UPLOAD },
			{ principal: "user", id: staffBUser.id, permissions: VIEW },
		]);
		await upload(path, staffA.token, "rezepte.txt", kitchen.id);
		await upload(path, staffB.token, "x.txt", kitchen.id, 403);
		expect(names(await list(path, staffB.token, kitchen.id))).toEqual(["rezepte.txt"]);

		await setAccess(
			kitchen.id,
			leader.token,
			[{ principal: "user", id: bobUser.id, permissions: VIEW }],
			400,
		);
		await setAccess(kitchen.id, leader.token, [{ principal: "members", permissions: VIEW }], 400);
	});

	test("leaving the team takes a person off the access lists", async () => {
		const carlaUser = await seedUser("volunteer", { display_name: "Carla" });
		const membership = await addEventMember(eventId, carlaUser.id, "staff");
		const carla = await seedSession(carlaUser.id);
		const plans = await folder(path, leader.token, "Pläne");
		await setAccess(plans.id, leader.token, [
			{ principal: "event_group", id: kitchenId, permissions: VIEW },
			{ principal: "user", id: carlaUser.id, permissions: VIEW },
		]);
		expect(names(await list(path, carla.token))).toContain("Pläne");

		await makeAPIRequest(`/v1/events/${eventId}/members/${membership.id}`, {
			method: "DELETE",
			authToken: leader.token,
		});
		const access = await makeAPIRequest(`/v1/files/${plans.id}/access`, {
			authToken: leader.token,
		});
		expect(access.entries.map((entry: any) => entry.label)).toEqual(["Küche"]);
		// The list saves as it is shown, and coming back doesn't bring the access back.
		await setAccess(
			plans.id,
			leader.token,
			access.entries.map((entry: any) => ({
				principal: entry.principal,
				id: entry.id,
				permissions: entry.permissions,
			})),
		);
		await addEventMember(eventId, carlaUser.id, "staff");
		expect(names(await list(path, carla.token))).not.toContain("Pläne");
	});

	test("moving needs upload rights where it goes, and only managers move items with own access", async () => {
		const move = (id: number, parentId: number, code = 200) =>
			makeAPIRequest(
				`/v1/files/${id}`,
				{ method: "PUT", authToken: staffA.token, body: { parent_id: parentId } },
				code,
			);
		const mine = await upload(path, staffA.token, "umzug.txt");
		const hidden = await folder(path, leader.token, "Nur für die Leitung");
		await setAccess(hidden.id, leader.token, []);
		const readOnly = await folder(path, leader.token, "Nur lesen");
		await setAccess(readOnly.id, leader.token, [{ principal: "team", permissions: VIEW }]);
		const open = await folder(path, leader.token, "Ablage");
		await setAccess(open.id, leader.token, [{ principal: "team", permissions: UPLOAD }]);

		// A folder the caller can't see doesn't exist for them; one they may only view refuses.
		await move(mine.id, hidden.id, 400);
		await move(mine.id, readOnly.id, 403);
		await move(mine.id, open.id);
		expect(names(await list(path, staffA.token, open.id))).toContain("umzug.txt");

		// Once the Leitung gives the file its own access, only the Leitung moves it.
		await setAccess(mine.id, leader.token, [{ principal: "team", permissions: VIEW }]);
		await move(mine.id, readOnly.id, 403);
		await makeAPIRequest(`/v1/files/${mine.id}`, {
			method: "PUT",
			authToken: leader.token,
			body: { parent_id: readOnly.id },
		});
	});

	test("staff can't manage access or share links", async () => {
		await setAccess(leadId, staffA.token, [], 403);
		const mine = await upload(path, staffA.token, "teilen.txt");
		await makeAPIRequest(
			`/v1/files/${mine.id}/shares`,
			{ method: "POST", authToken: staffA.token, body: { permissions: VIEW } },
			403,
		);
	});

	test("a folder that holds items with their own access is deleted or moved by the Leitung only", async () => {
		const project = await folder(path, staffA.token, "Projekt");
		const target = await folder(path, staffA.token, "Ablage");
		const restricted = await folder(path, leader.token, "Vertraulich", project.id);
		await setAccess(restricted.id, leader.token, []);

		await makeAPIRequest(
			`/v1/files/${project.id}`,
			{ method: "PUT", authToken: staffA.token, body: { parent_id: target.id } },
			403,
		);
		await makeAPIRequest(
			`/v1/files/${project.id}`,
			{ method: "DELETE", authToken: staffA.token },
			403,
		);

		// What is in the Papierkorb doesn't count: then it's their own folder again.
		await makeAPIRequest(`/v1/files/${restricted.id}`, { method: "DELETE", authToken: leader.token });
		await makeAPIRequest(`/v1/files/${project.id}`, { method: "DELETE", authToken: staffA.token });
	});

	test("folders nest at most MAX_DEPTH deep", async () => {
		let parentId: number | null = null;
		for (let depth = 1; depth < FileService.MAX_DEPTH; depth++) {
			parentId = DB.instance()
				.insert(DB.Tables.files)
				.values({
					org_id: OrgContext.id(),
					scope: "event",
					event_id: eventId,
					parent_id: parentId,
					kind: "folder",
					name: `Ebene ${depth}`,
				})
				.returning()
				.get().id;
		}
		const last = await folder(path, leader.token, "Unterste", parentId as number);
		await folder(path, leader.token, "Zu tief", last.id, 400);
		await upload(path, leader.token, "geht.txt", last.id);
		// Moving a folder with a folder inside to where it would be too deep.
		const outer = await folder(path, leader.token, "Außen");
		await folder(path, leader.token, "Innen", outer.id);
		await makeAPIRequest(
			`/v1/files/${outer.id}`,
			{ method: "PUT", authToken: leader.token, body: { parent_id: parentId } },
			400,
		);
	});

	test("program attachments in restricted folders are only shown to those who can open them", async () => {
		const BASE = Date.UTC(2027, 6, 2, 9);
		await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: leader.token,
				body: {
					title: "Geländespiel",
					start_at: BASE,
					end_at: BASE + 3_600_000,
					file_ids: [secretFileId],
				},
			},
			201,
		);
		const forStaff = await makeAPIRequest(`/v1/events/${eventId}/program`, {
			authToken: staffA.token,
		});
		const forLeader = await makeAPIRequest(`/v1/events/${eventId}/program`, {
			authToken: leader.token,
		});
		expect(forStaff[0].files).toEqual([]);
		expect(forLeader[0].files.map((file: any) => file.id)).toEqual([secretFileId]);

		// …and staff can't link it themselves (they don't manage the program anyway, but the check
		// also covers org documents a leader can't open).
		const orgSecret = await folder("/v1/org/documents", core.token, "Kernteam intern");
		await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: leader.token,
				body: {
					title: "Mit Kernteam-Datei",
					start_at: BASE,
					end_at: BASE + 1,
					file_ids: [orgSecret.id],
				},
			},
			400,
		);
	});

	test("editing a program item keeps the attachments the editor can't see", async () => {
		const BASE = Date.UTC(2027, 6, 3, 9);
		const orgSecret = await upload("/v1/org/documents", core.token, "kernteam.txt");
		const item = await makeAPIRequest(
			`/v1/events/${eventId}/program`,
			{
				method: "POST",
				authToken: core.token,
				body: {
					title: "Elternabend",
					start_at: BASE,
					end_at: BASE + 3_600_000,
					file_ids: [orgSecret.id],
				},
			},
			201,
		);
		// The Leitung can't open the Kernteam-only file, so its edit doesn't send it.
		await makeAPIRequest(`/v1/events/${eventId}/program/${item.id}`, {
			method: "PUT",
			authToken: leader.token,
			body: { title: "Elternabend (neu)", file_ids: [] },
		});
		const forCore = await makeAPIRequest(`/v1/events/${eventId}/program`, { authToken: core.token });
		const updated = forCore.find((entry: any) => entry.id === item.id);
		expect(updated.title).toBe("Elternabend (neu)");
		expect(updated.files.map((file: any) => file.id)).toEqual([orgSecret.id]);
	});

	test("copies keep access lists; groups and people come along with them", async () => {
		const copy = await makeAPIRequest(
			`/v1/events/${eventId}/copy`,
			{
				method: "POST",
				authToken: core.token,
				body: {
					name: "Sommerlager 2028",
					start_date: "2028-07-01",
					include: {
						team: true,
						groups: true,
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
		const copyPath = `/v1/events/${copy.event.id}/files`;
		const root = await list(copyPath, staffA.token);
		expect(root.items.map((item: any) => item.name)).not.toContain("Leitung");
		const kitchen = (await list(copyPath, core.token)).items.find(
			(item: any) => item.name === "Küche",
		);
		expect(kitchen.custom_access).toBe(true);
		expect(kitchen.access.map((entry: any) => `${entry.principal}:${entry.label}`)).toEqual([
			"event_group:Küche",
			"user:Ben",
		]);
		expect(kitchen.access[0].id).not.toBe(kitchenId);
	});

	test("copies without team or groups drop those entries; the list stays restrictive", async () => {
		const copy = await makeAPIRequest(
			`/v1/events/${eventId}/copy`,
			{
				method: "POST",
				authToken: core.token,
				body: {
					name: "Sommerlager ohne Team",
					start_date: "2029-07-01",
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
		const kitchen = (await list(`/v1/events/${copy.event.id}/files`, core.token)).items.find(
			(item: any) => item.name === "Küche",
		);
		// Nobody to name any more: the folder stays closed (Nur Leitung) instead of opening up.
		expect(kitchen.custom_access).toBe(true);
		expect(kitchen.access).toEqual([]);
	});
});
