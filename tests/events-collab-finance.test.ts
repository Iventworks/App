import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { API } from "../server/lib/api";
import { FileService } from "../server/lib/api/utils/fileService";
import { EventAnnouncementsModel } from "../server/lib/api/versions/v1/routes/events/announcements/model";
import { EventBudgetModel } from "../server/lib/api/versions/v1/routes/events/budget/model";
import { EventExpensesModel } from "../server/lib/api/versions/v1/routes/events/expenses/model";
import { EventFilesModel } from "../server/lib/api/versions/v1/routes/events/files/model";
import { EventNotesModel } from "../server/lib/api/versions/v1/routes/events/notes/model";
import { FilesModel } from "../server/lib/api/versions/v1/routes/files/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { FileStorage } from "../server/lib/utils/fileStorage";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders, TEST_HOST } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let coreTeam: SeededUser;
let leader: SeededUser;
let cook: SeededUser; // staff, member of the kitchen group
let helper: SeededUser; // staff, not in the kitchen group
let outsider: SeededUser;

let coreSession: SeededSession;
let leaderSession: SeededSession;
let cookSession: SeededSession;
let helperSession: SeededSession;
let outsiderSession: SeededSession;

let eventId: number;
let kitchenGroupId: number;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function uploadForm(file: File, extra: Record<string, string> = {}) {
	const form = new FormData();
	form.append("file", file);
	for (const [key, value] of Object.entries(extra)) form.append(key, value);
	return form;
}

async function upload<T = any>(
	path: string,
	token: string,
	form: FormData,
	expectedCode?: number,
): Promise<T> {
	return await makeAPIRequest<T>(
		path,
		{ authToken: token, additionalOptions: { method: "POST", body: form } },
		expectedCode,
	);
}

function notificationsOf(userId: number, type: string) {
	return DB.instance()
		.select()
		.from(DB.Tables.notifications)
		.where(and(eq(DB.Tables.notifications.user_id, userId), eq(DB.Tables.notifications.type, type)))
		.all();
}

beforeAll(async () => {
	coreTeam = await seedUser("core_team");
	leader = await seedUser("volunteer");
	cook = await seedUser("volunteer");
	helper = await seedUser("volunteer");
	outsider = await seedUser("volunteer");

	coreSession = await seedSession(coreTeam.id);
	leaderSession = await seedSession(leader.id);
	cookSession = await seedSession(cook.id);
	helperSession = await seedSession(helper.id);
	outsiderSession = await seedSession(outsider.id);

	const event = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: {
			name: "Herbstfreizeit",
			start_date: "2027-10-01",
			end_date: "2027-10-05",
			leader_ids: [leader.id],
		},
	});
	eventId = event.id;

	await addEventMember(eventId, cook.id, "staff");
	await addEventMember(eventId, helper.id, "staff");

	const group = DB.instance()
		.insert(DB.Tables.eventGroups)
		.values({ org_id: OrgContext.id(), event_id: eventId, name: "Küchenteam" })
		.returning()
		.get();
	kitchenGroupId = group.id;
	DB.instance()
		.insert(DB.Tables.eventGroupMembers)
		.values({ org_id: OrgContext.id(), group_id: kitchenGroupId, user_id: cook.id })
		.run();
});

describe("Event notes", () => {
	let eventNoteId: number;
	let groupNoteId: number;

	test("group members create group notes; others cannot", async () => {
		const note = await makeAPIRequest(`/v1/events/${eventId}/notes`, {
			method: "POST",
			authToken: cookSession.token,
			body: { title: "Einkaufsliste", content: "- Nudeln", group_id: kitchenGroupId },
			expectedBodySchema: EventNotesModel.Create.Response,
		});
		expect(note.scope).toBe("group");
		expect(note.group?.name).toBe("Küchenteam");
		groupNoteId = note.id;

		await makeAPIRequest(
			`/v1/events/${eventId}/notes`,
			{
				method: "POST",
				authToken: helperSession.token,
				body: { title: "Nope", group_id: kitchenGroupId },
			},
			403,
		);
	});

	test("event-wide notes are visible to every staff member, group notes only to the group", async () => {
		const note = await makeAPIRequest(`/v1/events/${eventId}/notes`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { title: "Hausregeln", content: "Nachtruhe 22 Uhr", pinned: true },
			expectedBodySchema: EventNotesModel.Create.Response,
		});
		eventNoteId = note.id;

		const helperView = await makeAPIRequest(`/v1/events/${eventId}/notes`, {
			authToken: helperSession.token,
			expectedBodySchema: EventNotesModel.GetAll.Response,
		});
		expect(helperView.map((n) => n.id)).toEqual([eventNoteId]);

		const cookView = await makeAPIRequest(`/v1/events/${eventId}/notes`, {
			authToken: cookSession.token,
			expectedBodySchema: EventNotesModel.GetAll.Response,
		});
		expect(cookView.map((n) => n.id).sort()).toEqual([eventNoteId, groupNoteId].sort());
		expect(cookView[0]!.pinned).toBe(true);

		const leaderView = await makeAPIRequest(`/v1/events/${eventId}/notes`, {
			authToken: leaderSession.token,
		});
		expect(leaderView).toHaveLength(2);

		await makeAPIRequest(
			`/v1/events/${eventId}/notes?group_id=${kitchenGroupId}`,
			{ authToken: helperSession.token },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}/notes`, { authToken: outsiderSession.token }, 403);
	});

	test("event-wide notes are collaborative; deleting is limited", async () => {
		const updated = await makeAPIRequest(`/v1/events/${eventId}/notes/${eventNoteId}`, {
			method: "PUT",
			authToken: helperSession.token,
			body: { content: "Nachtruhe 22:30 Uhr" },
			expectedBodySchema: EventNotesModel.Update.Response,
		});
		expect(updated.updater?.id).toBe(helper.id);
		expect(updated.can_delete).toBe(false);

		await makeAPIRequest(
			`/v1/events/${eventId}/notes/${groupNoteId}`,
			{ method: "PUT", authToken: helperSession.token, body: { title: "x" } },
			404,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/notes/${eventNoteId}`,
			{ method: "DELETE", authToken: helperSession.token },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}/notes/${eventNoteId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
	});
});

describe("Event announcements", () => {
	test("only leaders publish; all other staff get notified", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/announcements`,
			{ method: "POST", authToken: cookSession.token, body: { title: "Hallo" } },
			403,
		);

		const announcement = await makeAPIRequest(`/v1/events/${eventId}/announcements`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { title: "Abfahrt 8 Uhr", content: "Treffpunkt Bahnhof", priority: "important" },
			expectedBodySchema: EventAnnouncementsModel.Create.Response,
		});
		expect(announcement.creator?.id).toBe(leader.id);

		expect(notificationsOf(cook.id, "announcement")).toHaveLength(1);
		expect(notificationsOf(helper.id, "announcement")).toHaveLength(1);
		expect(notificationsOf(leader.id, "announcement")).toHaveLength(0);
		expect(notificationsOf(cook.id, "announcement")[0]!.title).toContain("Wichtig");

		const list = await makeAPIRequest(`/v1/events/${eventId}/announcements`, {
			authToken: helperSession.token,
			expectedBodySchema: EventAnnouncementsModel.GetAll.Response,
		});
		expect(list).toHaveLength(1);

		await makeAPIRequest(`/v1/events/${eventId}/announcements/${announcement.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { pinned: true },
		});
		await makeAPIRequest(`/v1/events/${eventId}/announcements/${announcement.id}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
	});
});

describe("Event documents and /files", () => {
	let folderId: number;
	let fileId: number;
	let storageKey: string;

	test("upload, create folders and list with breadcrumbs", async () => {
		const folder = await makeAPIRequest(`/v1/events/${eventId}/files/folders`, {
			method: "POST",
			authToken: cookSession.token,
			body: { name: "Andachten" },
			expectedBodySchema: EventFilesModel.CreateFolder.Response,
		});
		folderId = folder.id;

		const file = await upload(
			`/v1/events/${eventId}/files`,
			cookSession.token,
			uploadForm(new File([PNG_BYTES], "Plan Tag 1.png", { type: "image/png" })),
			201,
		);
		const parsed = EventFilesModel.Upload.Response.parse(file);
		expect(parsed.size).toBe(PNG_BYTES.length);
		expect(parsed.download_token).not.toBeNull();
		fileId = parsed.id;
		storageKey = DB.instance()
			.select()
			.from(DB.Tables.files)
			.where(eq(DB.Tables.files.id, fileId))
			.get()!.storage_key!;

		const nested = await upload(
			`/v1/events/${eventId}/files`,
			cookSession.token,
			uploadForm(new File(["Andacht"], "andacht.txt", { type: "text/plain" }), {
				parent_id: String(folderId),
			}),
			201,
		);
		expect(nested.parent_id).toBe(folderId);

		const root = await makeAPIRequest(`/v1/events/${eventId}/files`, {
			authToken: helperSession.token,
			expectedBodySchema: EventFilesModel.GetAll.Response,
		});
		expect(root.folder).toBeNull();
		// Folders are listed before files.
		expect(root.items.map((item) => item.kind)).toEqual(["folder", "file"]);

		const inFolder = await makeAPIRequest(`/v1/events/${eventId}/files?parent_id=${folderId}`, {
			authToken: helperSession.token,
			expectedBodySchema: EventFilesModel.GetAll.Response,
		});
		expect(inFolder.path.map((entry) => entry.id)).toEqual([folderId]);
		expect(inFolder.items.map((item) => item.name)).toEqual(["andacht.txt"]);

		await makeAPIRequest(`/v1/events/${eventId}/files`, { authToken: outsiderSession.token }, 403);
		await makeAPIRequest(
			`/v1/events/${eventId}/files?parent_id=${fileId}`,
			{ authToken: cookSession.token },
			404,
		);
	});

	test("downloads via signed token; forged or expired tokens are rejected", async () => {
		const token = FileService.createDownloadToken(fileId);

		const res = await API.getApp().request(`/v1/files/download/${token}`, {
			headers: hostHeaders(TEST_HOST),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("content-disposition")).toStartWith("inline;");
		expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''Plan%20Tag%201.png");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);

		const forced = await API.getApp().request(`/v1/files/download/${token}?download=1`, {
			headers: hostHeaders(TEST_HOST),
		});
		expect(forced.headers.get("content-disposition")).toStartWith("attachment;");

		const forged = `${fileId + 1}.${token.split(".").slice(1).join(".")}`;
		expect(
			(await API.getApp().request(`/v1/files/download/${forged}`, { headers: hostHeaders(TEST_HOST) }))
				.status,
		).toBe(404);

		const expired = FileService.createDownloadToken(fileId, -1000);
		expect(
			(
				await API.getApp().request(`/v1/files/download/${expired}`, { headers: hostHeaders(TEST_HOST) })
			).status,
		).toBe(404);
	});

	test("only safe types render inline; SVG and HTML are always downloaded as opaque bytes", async () => {
		const png = await API.getApp().request(
			`/v1/files/download/${FileService.createDownloadToken(fileId)}`,
			{ headers: hostHeaders(TEST_HOST) },
		);
		expect(png.headers.get("content-security-policy")).toContain("sandbox");
		expect(png.headers.get("x-content-type-options")).toBe("nosniff");

		for (const [name, type, body] of [
			[
				"bild.svg",
				"image/svg+xml",
				'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			],
			["seite.html", "text/html", "<script>alert(1)</script>"],
		] as const) {
			const uploaded = EventFilesModel.Upload.Response.parse(
				await upload(
					`/v1/events/${eventId}/files`,
					helperSession.token,
					uploadForm(new File([body], name, { type })),
					201,
				),
			);
			const res = await API.getApp().request(`/v1/files/download/${uploaded.download_token}`, {
				headers: hostHeaders(TEST_HOST),
			});
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("application/octet-stream");
			expect(res.headers.get("content-disposition")).toStartWith("attachment;");
		}
	});

	test("outsiders cannot access files; only uploader or leaders change them", async () => {
		await makeAPIRequest(`/v1/files/${fileId}`, { authToken: outsiderSession.token }, 403);
		await makeAPIRequest(`/v1/files/${fileId}`, {
			authToken: helperSession.token,
			expectedBodySchema: FilesModel.Item,
		});

		await makeAPIRequest(
			`/v1/files/${fileId}`,
			{ method: "PUT", authToken: helperSession.token, body: { name: "x.png" } },
			403,
		);

		const renamed = await makeAPIRequest(`/v1/files/${fileId}`, {
			method: "PUT",
			authToken: cookSession.token,
			body: { name: "Tagesplan.png", parent_id: folderId },
			expectedBodySchema: FilesModel.Update.Response,
		});
		expect(renamed.name).toBe("Tagesplan.png");
		expect(renamed.parent_id).toBe(folderId);

		await makeAPIRequest(
			`/v1/files/${folderId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { parent_id: folderId } },
			400,
		);
	});

	test("deleting a folder removes its contents and blobs", async () => {
		expect(await FileStorage.open(storageKey).exists()).toBe(true);

		await makeAPIRequest(`/v1/files/${folderId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});

		expect(await FileStorage.open(storageKey).exists()).toBe(false);
		await makeAPIRequest(`/v1/files/${fileId}`, { authToken: cookSession.token }, 404);
	});
});

describe("Expenses", () => {
	let expenseId: number;
	let receiptFileId: number;

	test("staff submit expenses and leaders get notified", async () => {
		const expense = await makeAPIRequest(`/v1/events/${eventId}/expenses`, {
			method: "POST",
			authToken: cookSession.token,
			body: {
				title: "Großeinkauf",
				category: "Verpflegung",
				amount_cents: 12345,
				spent_on: "2027-10-02",
			},
			expectedBodySchema: EventExpensesModel.Create.Response,
		});
		expect(expense.status).toBe("submitted");
		expect(expense.can_edit).toBe(true);
		expenseId = expense.id;

		expect(notificationsOf(leader.id, "expense_submitted")).toHaveLength(1);
		expect(notificationsOf(cook.id, "expense_submitted")).toHaveLength(0);
	});

	test("receipts must be images or PDFs", async () => {
		await upload(
			`/v1/events/${eventId}/expenses/${expenseId}/receipt`,
			cookSession.token,
			uploadForm(new File(["hi"], "beleg.txt", { type: "text/plain" })),
			400,
		);
		await upload(
			`/v1/events/${eventId}/expenses/${expenseId}/receipt`,
			cookSession.token,
			uploadForm(new File(["<svg/>"], "beleg.svg", { type: "image/svg+xml" })),
			400,
		);

		const withReceipt = EventExpensesModel.UploadReceipt.Response.parse(
			await upload(
				`/v1/events/${eventId}/expenses/${expenseId}/receipt`,
				cookSession.token,
				uploadForm(new File([PNG_BYTES], "beleg.png", { type: "image/png" })),
			),
		);
		expect(withReceipt.receipt?.scope).toBe("receipt");
		expect(withReceipt.receipt?.download_token).not.toBeNull();
		receiptFileId = withReceipt.receipt!.id;

		// Receipts never show up in the documents listing.
		const docs = await makeAPIRequest(`/v1/events/${eventId}/files`, {
			authToken: leaderSession.token,
		});
		expect(docs.items.map((item: any) => item.id)).not.toContain(receiptFileId);
	});

	test("staff only see their own expenses and receipts", async () => {
		const helperList = await makeAPIRequest(`/v1/events/${eventId}/expenses`, {
			authToken: helperSession.token,
			expectedBodySchema: EventExpensesModel.GetAll.Response,
		});
		expect(helperList).toEqual([]);

		await makeAPIRequest(
			`/v1/events/${eventId}/expenses/${expenseId}`,
			{ method: "PUT", authToken: helperSession.token, body: { amount_cents: 1 } },
			404,
		);

		await makeAPIRequest(`/v1/files/${receiptFileId}`, { authToken: cookSession.token });
		await makeAPIRequest(`/v1/files/${receiptFileId}`, { authToken: leaderSession.token });
		await makeAPIRequest(`/v1/files/${receiptFileId}`, { authToken: helperSession.token }, 403);

		const leaderList = await makeAPIRequest(`/v1/events/${eventId}/expenses`, {
			authToken: leaderSession.token,
		});
		expect(leaderList.map((expense: any) => expense.id)).toEqual([expenseId]);

		await makeAPIRequest(
			`/v1/events/${eventId}/expenses/summary`,
			{ authToken: cookSession.token },
			403,
		);
	});

	test("review notifies the submitter and locks the expense for them", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/expenses/${expenseId}/review`,
			{ method: "POST", authToken: cookSession.token, body: { status: "approved" } },
			403,
		);

		const reviewed = await makeAPIRequest(`/v1/events/${eventId}/expenses/${expenseId}/review`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { status: "approved", note: "Danke!" },
			expectedBodySchema: EventExpensesModel.Review.Response,
		});
		expect(reviewed.status).toBe("approved");
		expect(reviewed.reviewer?.id).toBe(leader.id);
		expect(reviewed.review_note).toBe("Danke!");

		const notes = notificationsOf(cook.id, "expense_reviewed");
		expect(notes).toHaveLength(1);
		expect(notes[0]!.title).toContain("genehmigt");

		await makeAPIRequest(
			`/v1/events/${eventId}/expenses/${expenseId}`,
			{ method: "PUT", authToken: cookSession.token, body: { amount_cents: 1 } },
			403,
		);
		await upload(
			`/v1/events/${eventId}/expenses/${expenseId}/receipt`,
			cookSession.token,
			uploadForm(new File([PNG_BYTES], "neu.png", { type: "image/png" })),
			403,
		);

		const own = await makeAPIRequest(`/v1/events/${eventId}/expenses`, {
			authToken: cookSession.token,
		});
		expect(own[0].can_edit).toBe(false);
	});

	test("summary aggregates by status, category and submitter", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/expenses`, {
			method: "POST",
			authToken: helperSession.token,
			body: { title: "Bastelmaterial", amount_cents: 2000, spent_on: "2027-10-03" },
		});

		const summary = await makeAPIRequest(`/v1/events/${eventId}/expenses/summary`, {
			authToken: leaderSession.token,
			expectedBodySchema: EventExpensesModel.Summary.Response,
		});
		expect(summary.totals_by_status.approved).toBe(12345);
		expect(summary.totals_by_status.submitted).toBe(2000);
		expect(summary.by_category.find((entry) => entry.category === "Sonstiges")?.amount_cents).toBe(
			2000,
		);
		const cookEntry = summary.by_submitter.find((entry) => entry.user?.id === cook.id);
		expect(cookEntry?.open_reimbursement_cents).toBe(12345);
	});
});

describe("Budget", () => {
	test("leaders only", async () => {
		await makeAPIRequest(`/v1/events/${eventId}/budget`, { authToken: cookSession.token }, 403);
		await makeAPIRequest(
			`/v1/events/${eventId}/budget`,
			{
				method: "POST",
				authToken: cookSession.token,
				body: { category: "Verpflegung", planned_cents: 1 },
			},
			403,
		);
	});

	test("planned vs. actual", async () => {
		await makeAPIRequest(`/v1/events/${eventId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { budget_cents: 80000 },
		});

		const item = await makeAPIRequest(`/v1/events/${eventId}/budget`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { kind: "expense", category: "Verpflegung", planned_cents: 50000 },
			expectedBodySchema: EventBudgetModel.Create.Response,
		});
		await makeAPIRequest(`/v1/events/${eventId}/budget`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { kind: "income", category: "Teilnehmerbeiträge", planned_cents: 100000 },
		});

		const budget = await makeAPIRequest(`/v1/events/${eventId}/budget`, {
			authToken: leaderSession.token,
			expectedBodySchema: EventBudgetModel.Get.Response,
		});
		expect(budget.budget_cents).toBe(80000);
		expect(budget.planned_expense_cents).toBe(50000);
		expect(budget.planned_income_cents).toBe(100000);
		expect(budget.actual_expense_cents).toBe(12345);
		expect(budget.pending_expense_cents).toBe(2000);
		expect(budget.remaining_cents).toBe(80000 - 12345);
		expect(budget.by_category.find((entry) => entry.category === "Verpflegung")).toEqual({
			category: "Verpflegung",
			planned_cents: 50000,
			actual_cents: 12345,
		});

		const updated = await makeAPIRequest(`/v1/events/${eventId}/budget/${item.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { planned_cents: 60000 },
			expectedBodySchema: EventBudgetModel.Update.Response,
		});
		expect(updated.planned_cents).toBe(60000);

		await makeAPIRequest(`/v1/events/${eventId}/budget/${item.id}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/budget/${item.id}`,
			{ method: "DELETE", authToken: leaderSession.token },
			404,
		);
	});
});

describe("Expense deletion", () => {
	test("deleting an expense also removes its receipt", async () => {
		const [expense] = DB.instance()
			.select()
			.from(DB.Tables.expenses)
			.where(eq(DB.Tables.expenses.submitted_by, cook.id))
			.all();
		const key = DB.instance()
			.select()
			.from(DB.Tables.files)
			.where(eq(DB.Tables.files.id, expense!.receipt_file_id!))
			.get()!.storage_key!;
		expect(await FileStorage.open(key).exists()).toBe(true);

		await makeAPIRequest(`/v1/events/${eventId}/expenses/${expense!.id}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});

		expect(await FileStorage.open(key).exists()).toBe(false);
		expect(await FileService.get(expense!.receipt_file_id!)).toBeNull();
	});
});
