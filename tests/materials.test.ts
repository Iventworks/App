import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { EventMaterialsModel } from "../server/lib/api/versions/v1/routes/events/materials/model";
import { OrgResourcesModel } from "../server/lib/api/versions/v1/routes/org/resources/model";
import { DB } from "../server/lib/db";
import { makeAPIRequest } from "./helpers/api";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let core: SeededUser;
let leader: SeededUser;
let anna: SeededUser; // staff
let ben: SeededUser; // staff
let outsider: SeededUser;
let coreSession: SeededSession;
let leaderSession: SeededSession;
let annaSession: SeededSession;
let benSession: SeededSession;
let outsiderSession: SeededSession;

let campId: number;
let otherCampId: number;
let annaMemberId: number;
let tentsId: number;
let paperId: number;

type Material = EventMaterialsModel.Material;

const base = () => `/v1/events/${campId}/materials`;

function notificationsOf(userId: number, type: string) {
	return DB.instance()
		.select()
		.from(DB.Tables.notifications)
		.where(and(eq(DB.Tables.notifications.user_id, userId), eq(DB.Tables.notifications.type, type)))
		.all();
}

async function list(token = leaderSession.token, eventId = campId) {
	return await makeAPIRequest(`/v1/events/${eventId}/materials`, {
		authToken: token,
		expectedBodySchema: EventMaterialsModel.GetAll.Response,
	});
}

async function catalog(eventId = campId, token = leaderSession.token) {
	return await makeAPIRequest(`/v1/events/${eventId}/materials/catalog`, {
		authToken: token,
		expectedBodySchema: EventMaterialsModel.Catalog.Response,
	});
}

async function add(
	body: Record<string, unknown>,
	token = leaderSession.token,
	expected = 201,
	eventId = campId,
) {
	return await makeAPIRequest<Material>(
		`/v1/events/${eventId}/materials`,
		{ method: "POST", authToken: token, body },
		expected,
	);
}

async function update(
	id: number,
	body: Record<string, unknown>,
	token = leaderSession.token,
	expected = 200,
) {
	return await makeAPIRequest<Material>(
		`${base()}/${id}`,
		{ method: "PUT", authToken: token, body },
		expected,
	);
}

function stockOf(resourceId: number) {
	return DB.instance()
		.select()
		.from(DB.Tables.orgResources)
		.where(eq(DB.Tables.orgResources.id, resourceId))
		.get()!.quantity;
}

beforeAll(async () => {
	core = await seedUser("core_team");
	leader = await seedUser("volunteer", { display_name: "Lea Leitung" });
	anna = await seedUser("volunteer", { display_name: "Anna Team" });
	ben = await seedUser("volunteer", { display_name: "Ben Team" });
	outsider = await seedUser("volunteer");
	coreSession = await seedSession(core.id);
	leaderSession = await seedSession(leader.id);
	annaSession = await seedSession(anna.id);
	benSession = await seedSession(ben.id);
	outsiderSession = await seedSession(outsider.id);

	const camp = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: {
			name: "Zeltlager Material",
			start_date: "2028-07-10",
			end_date: "2028-07-15",
			leader_ids: [leader.id],
		},
	});
	campId = camp.id;
	annaMemberId = (await addEventMember(campId, anna.id, "staff")).id;
	await addEventMember(campId, ben.id, "staff");

	// Another camp that ends the day before this one starts.
	const other = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: { name: "Geheimes Vorlager", start_date: "2028-07-03", end_date: "2028-07-09" },
	});
	otherCampId = other.id;

	tentsId = (
		await makeAPIRequest("/v1/org/resources", {
			method: "POST",
			authToken: coreSession.token,
			body: {
				name: "Gruppenzelt",
				category: "Zelte",
				quantity: 4,
				brand: "Tatonka",
				size: "4 × 6 m",
				condition: "good",
			},
		})
	).id;
	paperId = (
		await makeAPIRequest("/v1/org/resources", {
			method: "POST",
			authToken: coreSession.token,
			body: { name: "Bastelpapier", category: "Basteln", quantity: 100, consumable: true },
		})
	).id;
});

describe("Who sees what", () => {
	test("the team sees the event's list, only the Leitung sees the inventory", async () => {
		expect((await list(annaSession.token)).items).toEqual([]);
		await makeAPIRequest(`${base()}/catalog`, { authToken: annaSession.token }, 403);
		await makeAPIRequest(base(), { authToken: outsiderSession.token }, 403);
		await makeAPIRequest("/v1/org/resources", { authToken: leaderSession.token }, 403);

		const items = await catalog();
		const tents = items.find((item) => item.id === tentsId)!;
		expect(tents).toMatchObject({
			brand: "Tatonka",
			size: "4 × 6 m",
			condition: "good",
			quantity: 4,
			free: 4,
		});
	});

	test("the team can't book from the inventory or plan purchases", async () => {
		await add({ kind: "inventory", resource_id: tentsId }, annaSession.token, 403);
		await add({ kind: "purchase", name: "Wasserbomben" }, annaSession.token, 403);
	});
});

describe("Booking from the inventory", () => {
	let bookingId: number;

	test("the Leitung books what is free; other events count but stay anonymous", async () => {
		await makeAPIRequest(`/v1/org/resources/${tentsId}/bookings`, {
			method: "POST",
			authToken: coreSession.token,
			body: { event_id: otherCampId, quantity: 1 },
		});
		// The other camp ends the day before: no overlap yet.
		expect((await catalog()).find((item) => item.id === tentsId)!.free).toBe(4);

		const booking = await add({
			kind: "inventory",
			resource_id: tentsId,
			quantity: 3,
			location: "Wiese",
		});
		bookingId = booking.id;
		expect(booking).toMatchObject({
			kind: "inventory",
			name: "Gruppenzelt",
			quantity: 3,
			overbooked: false,
		});
		expect(booking.resource?.brand).toBe("Tatonka");

		await add({ kind: "inventory", resource_id: tentsId, quantity: 2 }, leaderSession.token, 409);
		await update(bookingId, { quantity: 4 }, leaderSession.token);
		await update(bookingId, { quantity: 5 }, leaderSession.token, 409);
		await update(bookingId, { quantity: 3 }, leaderSession.token);

		const response = JSON.stringify(await catalog());
		expect(response).not.toContain("Geheimes Vorlager");
	});

	test("material days widen the period, and only where it is free", async () => {
		// One day before overlaps the other camp's last day: 1 + 3 of 4 still fit.
		const period = await makeAPIRequest(`${base()}/period`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { days_before: 1, days_after: 2 },
			expectedBodySchema: EventMaterialsModel.SetPeriod.Response,
		});
		expect(period).toEqual({
			days_before: 1,
			days_after: 2,
			from: "2028-07-09",
			until: "2028-07-17",
		});
		expect((await catalog()).find((item) => item.id === tentsId)).toMatchObject({
			taken: 1,
			booked_here: 3,
			free: 0,
		});

		await update(bookingId, { quantity: 4 }, leaderSession.token, 409);
		await makeAPIRequest(
			`${base()}/period`,
			{ method: "PUT", authToken: annaSession.token, body: { days_before: 0, days_after: 0 } },
			403,
		);

		// Without the extra day the other camp can take a second tent; then the day doesn't fit.
		const setPeriod = (days_before: number, expected = 200) =>
			makeAPIRequest(
				`${base()}/period`,
				{ method: "PUT", authToken: leaderSession.token, body: { days_before, days_after: 2 } },
				expected,
			);
		await setPeriod(0);
		const extra = await makeAPIRequest(`/v1/org/resources/${tentsId}/bookings`, {
			method: "POST",
			authToken: coreSession.token,
			body: { event_id: otherCampId, quantity: 1 },
		});
		await setPeriod(1, 409);
		await makeAPIRequest(`/v1/org/resources/bookings/${extra.id}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		await setPeriod(1);
	});

	test("the team notes where things are and ticks the packing list, nothing else", async () => {
		const placed = await update(
			bookingId,
			{ location: "Materialzelt", packed: true },
			annaSession.token,
		);
		expect(placed.location).toBe("Materialzelt");
		expect(placed.packed_at).toBeNumber();
		await update(bookingId, { quantity: 1 }, annaSession.token, 403);
		await makeAPIRequest(
			`${base()}/${bookingId}`,
			{ method: "DELETE", authToken: annaSession.token },
			403,
		);

		// One status: what is back was packed, what isn't packed isn't back either.
		const back = await update(bookingId, { returned: true }, annaSession.token);
		expect(back.packed_at).toBe(placed.packed_at);
		expect(back.returned_at).toBeNumber();
		const unpacked = await update(bookingId, { packed: false }, annaSession.token);
		expect(unpacked.packed_at).toBeNull();
		expect(unpacked.returned_at).toBeNull();
		const fresh = await update(bookingId, { returned: true }, annaSession.token);
		expect(fresh.packed_at).toBeNumber();
		await update(bookingId, { packed: false, returned: false }, annaSession.token);
	});

	test("the Kernteam sees the booking with the widened days", async () => {
		const [resource] = (
			await makeAPIRequest("/v1/org/resources", {
				authToken: coreSession.token,
				expectedBodySchema: OrgResourcesModel.GetAll.Response,
			})
		).filter((entry) => entry.id === tentsId);
		const booking = resource!.bookings.find((entry) => entry.event.id === campId)!;
		expect(booking.event).toMatchObject({ from: "2028-07-09", until: "2028-07-17" });
	});
});

describe("Consumables", () => {
	test("what was used comes off the stock, corrections go back", async () => {
		const paper = await add({ kind: "inventory", resource_id: paperId, quantity: 40 });
		await update(paper.id, { used_quantity: 30 });
		expect(stockOf(paperId)).toBe(70);
		await update(paper.id, { used_quantity: 25 });
		expect(stockOf(paperId)).toBe(75);
		await update(paper.id, { used_quantity: 41 }, leaderSession.token, 400);
		await update(paper.id, { used_quantity: 1 }, annaSession.token, 403);

		const tents = (await list()).items.find((item) => item.resource?.id === tentsId)!;
		await update(tents.id, { used_quantity: 1 }, leaderSession.token, 400);
	});
});

describe("Own things", () => {
	let beamerId: number;

	test("anyone on the team brings something; only they and the Leitung change it", async () => {
		const beamer = await add(
			{ kind: "own", name: "Beamer", notes: "mit HDMI-Kabel" },
			annaSession.token,
		);
		beamerId = beamer.id;
		expect(beamer.owner?.id).toBe(anna.id);
		expect(beamer.can_edit).toBe(true);

		await update(beamerId, { name: "Beamer (Epson)" }, benSession.token, 403);
		await makeAPIRequest(
			`${base()}/${beamerId}`,
			{ method: "DELETE", authToken: benSession.token },
			403,
		);
		expect((await update(beamerId, { quantity: 2 }, annaSession.token)).quantity).toBe(2);
		expect((await update(beamerId, { location: "Saal" }, benSession.token)).location).toBe("Saal");

		// Staff can't name someone else; the Leitung can, and that person hears about it.
		const forced = await add({ kind: "own", name: "Gitarre", owner_id: ben.id }, annaSession.token);
		expect(forced.owner?.id).toBe(anna.id);
		const guitar = await add({ kind: "own", name: "Gitarre", owner_id: ben.id });
		expect(guitar.owner?.id).toBe(ben.id);
		expect(notificationsOf(ben.id, "material_assigned")).toHaveLength(1);
		await add({ kind: "own", name: "Zelt", owner_id: outsider.id }, leaderSession.token, 400);
	});
});

describe("Requests", () => {
	let requestId: number;

	test("someone asks; the Leitung hears about it", async () => {
		const request = await makeAPIRequest(`${base()}/requests`, {
			method: "POST",
			authToken: annaSession.token,
			body: { name: "Schwungtuch", quantity: 3, notes: "für das Geländespiel" },
			expectedBodySchema: EventMaterialsModel.CreateRequest.Response,
		});
		requestId = request.id;
		expect(request).toMatchObject({ status: "open", covered: 0, can_edit: true });
		expect(notificationsOf(leader.id, "material_requested")).toHaveLength(1);

		// Others see it but can't change or decide it.
		const seen = (await list(benSession.token)).requests.find((entry) => entry.id === requestId)!;
		expect(seen.can_edit).toBe(false);
		await makeAPIRequest(
			`${base()}/requests/${requestId}`,
			{ method: "PUT", authToken: benSession.token, body: { quantity: 1 } },
			403,
		);
		await makeAPIRequest(
			`${base()}/requests/${requestId}`,
			{ method: "PUT", authToken: annaSession.token, body: { status: "done" } },
			403,
		);
	});

	test("answers in parts settle it; who asked hears each answer", async () => {
		const resource = await makeAPIRequest("/v1/org/resources", {
			method: "POST",
			authToken: coreSession.token,
			body: { name: "Schwungtuch 6 m", quantity: 2 },
		});
		await add({ kind: "inventory", resource_id: resource.id, quantity: 2, request_id: requestId });
		let request = (await list()).requests.find((entry) => entry.id === requestId)!;
		expect(request).toMatchObject({ status: "open", covered: 2 });

		// Ben brings the third one himself.
		await add({ kind: "own", name: "Schwungtuch", request_id: requestId }, benSession.token);
		request = (await list()).requests.find((entry) => entry.id === requestId)!;
		expect(request).toMatchObject({ status: "done", covered: 3 });
		expect(notificationsOf(anna.id, "material_answered")).toHaveLength(2);

		// A settled request takes no more answers.
		await add(
			{ kind: "purchase", name: "Schwungtuch", request_id: requestId },
			leaderSession.token,
			400,
		);
	});

	test("the Leitung rejects with a reason", async () => {
		const request = await makeAPIRequest(`${base()}/requests`, {
			method: "POST",
			authToken: benSession.token,
			body: { name: "Hüpfburg" },
		});
		const rejected = await makeAPIRequest(`${base()}/requests/${request.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { status: "rejected", answer: "Zu teuer" },
			expectedBodySchema: EventMaterialsModel.UpdateRequest.Response,
		});
		expect(rejected).toMatchObject({
			status: "rejected",
			answer: "Zu teuer",
			decided_by: { id: leader.id },
		});
		const [note] = notificationsOf(ben.id, "material_answered");
		expect(note!.title).toBe("Deine Anfrage „Hüpfburg“: abgelehnt – Zu teuer");
	});

	test("leaving the team takes your things along and opens what they answered", async () => {
		const request = await makeAPIRequest(`${base()}/requests`, {
			method: "POST",
			authToken: benSession.token,
			body: { name: "Lautsprecher" },
		});
		await add({ kind: "own", name: "Lautsprecher", request_id: request.id }, annaSession.token);
		expect((await list()).requests.find((entry) => entry.id === request.id)!.status).toBe("done");

		await makeAPIRequest(`/v1/events/${campId}/members/${annaMemberId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		const after = await list();
		expect(after.items.filter((item) => item.owner?.id === anna.id)).toEqual([]);
		expect(after.requests.find((entry) => entry.id === request.id)).toMatchObject({
			status: "open",
			covered: 0,
		});
		annaMemberId = (await addEventMember(campId, anna.id, "staff")).id;
	});
});

describe("Buying", () => {
	test("the buyer marks it bought and files the Auslage; the Leitung moves it into the inventory", async () => {
		const balloons = await add({
			kind: "purchase",
			name: "Wasserbomben",
			quantity: 200,
			estimated_cents: 1500,
			buyer_id: ben.id,
		});
		expect(balloons).toMatchObject({ bought_at: null, can_mark_bought: true, buyer: { id: ben.id } });
		expect(
			notificationsOf(ben.id, "material_assigned").some((note) => note.title.includes("Wasserbomben")),
		).toBe(true);
		await add({ kind: "purchase", name: "Kreide", buyer_id: outsider.id }, leaderSession.token, 400);

		await makeAPIRequest(
			`${base()}/${balloons.id}/bought`,
			{ method: "POST", authToken: annaSession.token, body: {} },
			403,
		);
		await makeAPIRequest(
			`${base()}/${balloons.id}/bought`,
			{ method: "POST", authToken: benSession.token, body: { to_inventory: true } },
			403,
		);
		const bought = await makeAPIRequest<Material>(`${base()}/${balloons.id}/bought`, {
			method: "POST",
			authToken: benSession.token,
			body: {},
		});
		expect(bought.bought_at).toBeNumber();
		await makeAPIRequest(
			`${base()}/${balloons.id}/bought`,
			{ method: "POST", authToken: benSession.token, body: {} },
			409,
		);

		const expense = {
			title: "Wasserbomben",
			amount_cents: 1480,
			spent_on: "2028-07-01",
			material_id: balloons.id,
		};
		await makeAPIRequest(
			`/v1/events/${campId}/expenses`,
			{ method: "POST", authToken: annaSession.token, body: expense },
			400,
		);
		await makeAPIRequest(`/v1/events/${campId}/expenses`, {
			method: "POST",
			authToken: benSession.token,
			body: expense,
		});
		expect((await list()).items.find((item) => item.id === balloons.id)!.has_expense).toBe(true);
		await makeAPIRequest(
			`/v1/events/${campId}/expenses`,
			{ method: "POST", authToken: benSession.token, body: expense },
			400,
		);
	});

	test("bought into the inventory: a new item, booked for the event", async () => {
		const tarp = await add({ kind: "purchase", name: "Tarp 5 × 5 m", quantity: 2 });
		const moved = await makeAPIRequest<Material>(`${base()}/${tarp.id}/bought`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { to_inventory: true, category: "Zelte" },
		});
		expect(moved).toMatchObject({ kind: "inventory", name: "Tarp 5 × 5 m", quantity: 2 });
		expect(moved.bought_at).toBeNumber();
		expect(stockOf(moved.resource!.id)).toBe(2);
		expect(moved.resource!.category).toBe("Zelte");

		// More of an existing item.
		const extra = await add({ kind: "purchase", name: "Gruppenzelt", quantity: 1 });
		const added = await makeAPIRequest<Material>(`${base()}/${extra.id}/bought`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { to_inventory: true, resource_id: tentsId },
		});
		expect(added.resource!.id).toBe(tentsId);
		expect(stockOf(tentsId)).toBe(5);
	});

	test("the Kernteam's purchases count only once bought", async () => {
		const created = await makeAPIRequest("/v1/org/resources", {
			method: "POST",
			authToken: coreSession.token,
			body: { name: "Kanu", quantity: 0, purchase: { quantity: 3, estimated_cents: 90000 } },
			expectedBodySchema: OrgResourcesModel.Create.Response,
		});
		expect(created).toMatchObject({ quantity: 0, on_order: 3 });
		expect((await catalog()).find((item) => item.id === created.id)).toMatchObject({
			free: 0,
			on_order: 3,
		});
		await add({ kind: "inventory", resource_id: created.id }, leaderSession.token, 409);

		await makeAPIRequest(
			`/v1/org/resources/purchases/${created.purchases[0]!.id}`,
			{ method: "PUT", authToken: coreSession.token, body: { buyer_id: leader.id } },
			400,
		);
		const bought = await makeAPIRequest(
			`/v1/org/resources/purchases/${created.purchases[0]!.id}/bought`,
			{
				method: "POST",
				authToken: coreSession.token,
				expectedBodySchema: OrgResourcesModel.Update.Response,
			},
		);
		expect(bought).toMatchObject({ quantity: 3, on_order: 0, purchases: [] });
		await add({ kind: "inventory", resource_id: created.id, quantity: 3 });
	});
});

describe("Program links", () => {
	test("anyone on the team plans material for a program item; duplicates keep it", async () => {
		const item = await makeAPIRequest(`/v1/events/${campId}/program`, {
			method: "POST",
			authToken: leaderSession.token,
			body: {
				title: "Geländespiel",
				start_at: Date.parse("2028-07-11T14:00:00Z"),
				end_at: Date.parse("2028-07-11T16:00:00Z"),
			},
		});
		const tents = (await list()).items.find((entry) => entry.resource?.id === tentsId)!;

		const linked = await makeAPIRequest<Material>(`${base()}/${tents.id}/links`, {
			method: "POST",
			authToken: annaSession.token,
			body: { program_item_id: item.id, quantity: 2 },
			expectedBodySchema: EventMaterialsModel.AddLink.Response,
		});
		expect(linked.links).toMatchObject([
			{ program_item_id: item.id, quantity: 2, title: "Geländespiel" },
		]);
		// Linking again changes the quantity.
		const relinked = await makeAPIRequest<Material>(`${base()}/${tents.id}/links`, {
			method: "POST",
			authToken: annaSession.token,
			body: { program_item_id: item.id, quantity: 1 },
		});
		expect(relinked.links).toHaveLength(1);
		expect(relinked.links[0]!.quantity).toBe(1);
		await makeAPIRequest(
			`${base()}/${tents.id}/links`,
			{ method: "POST", authToken: annaSession.token, body: { program_item_id: 999_999 } },
			400,
		);

		await makeAPIRequest(`/v1/events/${campId}/program/${item.id}/duplicate`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { start_at: Date.parse("2028-07-12T14:00:00Z") },
		});
		expect((await list()).items.find((entry) => entry.id === tents.id)!.links).toHaveLength(2);

		await makeAPIRequest<Material>(`${base()}/${tents.id}/links/${relinked.links[0]!.id}`, {
			method: "DELETE",
			authToken: annaSession.token,
		});
		expect((await list()).items.find((entry) => entry.id === tents.id)!.links).toHaveLength(1);
	});

	test("a request for a program item links its answers", async () => {
		const item = await makeAPIRequest(`/v1/events/${campId}/program`, {
			method: "POST",
			authToken: leaderSession.token,
			body: {
				title: "Bastelnachmittag",
				start_at: Date.parse("2028-07-13T14:00:00Z"),
				end_at: Date.parse("2028-07-13T17:00:00Z"),
			},
		});
		const request = await makeAPIRequest(`${base()}/requests`, {
			method: "POST",
			authToken: annaSession.token,
			body: { name: "Scheren", quantity: 10, program_item_id: item.id },
		});
		const scissors = await add({
			kind: "purchase",
			name: "Scheren",
			quantity: 10,
			request_id: request.id,
		});
		expect(scissors.links).toMatchObject([{ program_item_id: item.id, quantity: 10 }]);
	});
});

describe("Overbooking after the fact", () => {
	test("a moved event shows its bookings as overbooked", async () => {
		// The other camp grows into this camp's days and books the remaining tents directly.
		await makeAPIRequest(`/v1/events/${otherCampId}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { end_date: "2028-07-12" },
		});
		const items = (await list()).items.filter((item) => item.resource?.id === tentsId);
		// 1 (other) + 4 (this camp) of 5: still fine.
		expect(items.every((item) => !item.overbooked)).toBe(true);
		await makeAPIRequest(`/v1/org/resources/${tentsId}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { quantity: 3 },
		});
		expect(
			(await list()).items
				.filter((item) => item.resource?.id === tentsId)
				.every((item) => item.overbooked),
		).toBe(true);
	});
});

describe("Edge cases", () => {
	let fallId: number;
	const fall = () => `/v1/events/${fallId}/materials`;
	const addTo = (body: Record<string, unknown>, token = leaderSession.token, expected = 201) =>
		add(body, token, expected, fallId);
	const updateIn = (
		id: number,
		body: Record<string, unknown>,
		token = leaderSession.token,
		expected = 200,
	) =>
		makeAPIRequest<Material>(`${fall()}/${id}`, { method: "PUT", authToken: token, body }, expected);
	const fallList = () => list(leaderSession.token, fallId);
	const requestOf = async (id: number) =>
		(await fallList()).requests.find((entry) => entry.id === id)!;
	const resource = async (body: Record<string, unknown>) =>
		await makeAPIRequest("/v1/org/resources", {
			method: "POST",
			authToken: coreSession.token,
			body: { category: "Herbst", ...body },
		});
	const ask = async (body: Record<string, unknown>) =>
		await makeAPIRequest(`${fall()}/requests`, {
			method: "POST",
			authToken: annaSession.token,
			body,
		});

	beforeAll(async () => {
		const camp = await makeAPIRequest("/v1/events", {
			method: "POST",
			authToken: coreSession.token,
			body: {
				name: "Herbstlager",
				start_date: "2029-10-01",
				end_date: "2029-10-05",
				leader_ids: [leader.id],
			},
		});
		fallId = camp.id;
		await addEventMember(fallId, anna.id, "staff");
		await addEventMember(fallId, ben.id, "staff");
	});

	test("used up units no longer count as booked; more than the stock is refused", async () => {
		const glue = await resource({ name: "Kleber", quantity: 40, consumable: true });
		const entry = await addTo({ kind: "inventory", resource_id: glue.id, quantity: 40 });
		await updateIn(entry.id, { used_quantity: 30 });
		expect(stockOf(glue.id)).toBe(10);
		expect((await fallList()).items.find((item) => item.id === entry.id)!.overbooked).toBe(false);
		expect((await catalog(fallId)).find((item) => item.id === glue.id)).toMatchObject({
			booked_here: 10,
			free: 0,
		});

		// The stock says 5 are left: 10 more used up can't be right.
		await makeAPIRequest(`/v1/org/resources/${glue.id}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { quantity: 5 },
		});
		await updateIn(entry.id, { used_quantity: 40 }, leaderSession.token, 409);
		expect(stockOf(glue.id)).toBe(5);
		await updateIn(entry.id, { used_quantity: 35 });
		expect(stockOf(glue.id)).toBe(0);
	});

	test("a request the Leitung opens again stays open", async () => {
		const request = await ask({ name: "Taschenlampe", quantity: 1 });
		await addTo({ kind: "own", name: "Taschenlampe", owner_id: ben.id, request_id: request.id });
		expect((await requestOf(request.id)).status).toBe("done");
		const told = notificationsOf(anna.id, "material_answered").length;

		const reopened = await makeAPIRequest(`${fall()}/requests/${request.id}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { status: "open", answer: null },
		});
		expect(reopened.status).toBe("open");
		expect((await requestOf(request.id)).status).toBe("open");
		expect(notificationsOf(anna.id, "material_answered")).toHaveLength(told);
	});

	test("answers removed outside the material page open their requests again", async () => {
		const benches = await resource({ name: "Bierbank", quantity: 4 });
		const request = await ask({ name: "Bierbänke", quantity: 2 });
		const booked = await addTo({
			kind: "inventory",
			resource_id: benches.id,
			quantity: 2,
			request_id: request.id,
		});
		expect((await requestOf(request.id)).status).toBe("done");

		// The Kernteam releases the booking …
		await makeAPIRequest(`/v1/org/resources/bookings/${booked.id}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		expect((await requestOf(request.id)).status).toBe("open");

		// … or removes the item …
		await addTo({ kind: "inventory", resource_id: benches.id, quantity: 2, request_id: request.id });
		expect((await requestOf(request.id)).status).toBe("done");
		await makeAPIRequest(`/v1/org/resources/${benches.id}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		expect((await requestOf(request.id)).status).toBe("open");

		// … or the person who brings it is deleted.
		const carl = await seedUser("volunteer", { display_name: "Carl Team" });
		await addEventMember(fallId, carl.id, "staff");
		await addTo({
			kind: "own",
			name: "Bierbank",
			quantity: 2,
			owner_id: carl.id,
			request_id: request.id,
		});
		expect((await requestOf(request.id)).status).toBe("done");
		const admin = await seedUser("admin");
		const adminSession = await seedSession(admin.id);
		await makeAPIRequest(`/v1/admin/users/${carl.id}`, {
			method: "DELETE",
			authToken: adminSession.token,
		});
		expect((await requestOf(request.id)).status).toBe("open");
	});

	test("taken into the inventory, the buyer still files the Auslage; again after a rejection", async () => {
		const gas = await addTo({
			kind: "purchase",
			name: "Gaskartuschen",
			quantity: 4,
			buyer_id: ben.id,
		});
		const moved = await makeAPIRequest<Material>(`${fall()}/${gas.id}/bought`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { to_inventory: true, category: "Küche" },
		});
		expect(moved.kind).toBe("inventory");

		const expense = {
			title: "Gaskartuschen",
			amount_cents: 1996,
			spent_on: "2029-09-28",
			material_id: gas.id,
		};
		const filed = await makeAPIRequest(`/v1/events/${fallId}/expenses`, {
			method: "POST",
			authToken: benSession.token,
			body: expense,
		});
		expect((await fallList()).items.find((item) => item.id === gas.id)!.has_expense).toBe(true);

		await makeAPIRequest(`/v1/events/${fallId}/expenses/${filed.id}/review`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { status: "rejected", note: "Beleg fehlt" },
		});
		expect((await fallList()).items.find((item) => item.id === gas.id)!.has_expense).toBe(false);
		await makeAPIRequest(`/v1/events/${fallId}/expenses`, {
			method: "POST",
			authToken: benSession.token,
			body: expense,
		});
		expect((await fallList()).items.find((item) => item.id === gas.id)!.has_expense).toBe(true);
	});

	test("more material days aren't blocked by a shortage that is already there", async () => {
		const tents = await resource({ name: "Pavillon", quantity: 2 });
		await addTo({ kind: "inventory", resource_id: tents.id, quantity: 2 });
		// One broke after the booking.
		await makeAPIRequest(`/v1/org/resources/${tents.id}`, {
			method: "PUT",
			authToken: coreSession.token,
			body: { quantity: 1 },
		});
		await makeAPIRequest(`${fall()}/period`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { days_before: 1, days_after: 0 },
		});

		// A day that another event holds it on does make it worse.
		const prep = await makeAPIRequest("/v1/events", {
			method: "POST",
			authToken: coreSession.token,
			body: { name: "Herbstvorbereitung", start_date: "2029-09-27", end_date: "2029-09-28" },
		});
		await makeAPIRequest(`/v1/org/resources/${tents.id}/bookings`, {
			method: "POST",
			authToken: coreSession.token,
			body: { event_id: prep.id, quantity: 1 },
		});
		await makeAPIRequest(
			`${fall()}/period`,
			{ method: "PUT", authToken: leaderSession.token, body: { days_before: 3, days_after: 0 } },
			409,
		);
	});
});
