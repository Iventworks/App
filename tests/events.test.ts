import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { EventsModel } from "../server/lib/api/versions/v1/routes/events/model";
import { EventTasksModel } from "../server/lib/api/versions/v1/routes/events/tasks/model";
import { DB } from "../server/lib/db";
import { inOrg, OrgContext } from "../server/lib/orgs/context";
import type { OrgInfo } from "../server/lib/orgs/registry";
import { OrgService } from "../server/lib/orgs/service";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let coreTeam: SeededUser;
let leader: SeededUser;
let staff: SeededUser;
let outsider: SeededUser;
let unverified: SeededUser;

let coreSession: SeededSession;
let leaderSession: SeededSession;
let staffSession: SeededSession;
let outsiderSession: SeededSession;
let unverifiedSession: SeededSession;

let eventId: number;

beforeAll(async () => {
	coreTeam = await seedUser("core_team");
	leader = await seedUser("volunteer");
	staff = await seedUser("volunteer");
	outsider = await seedUser("volunteer");
	unverified = await seedUser("unverified");

	coreSession = await seedSession(coreTeam.id);
	leaderSession = await seedSession(leader.id);
	staffSession = await seedSession(staff.id);
	outsiderSession = await seedSession(outsider.id);
	unverifiedSession = await seedSession(unverified.id);
});

describe("Events", () => {
	test("POST /v1/events is restricted to the core team", async () => {
		await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { name: "Sommerfreizeit", start_date: "2027-07-01", end_date: "2027-07-10" },
			},
			403,
		);
	});

	test("unverified accounts cannot use the portal", async () => {
		await makeAPIRequest("/v1/events", { authToken: unverifiedSession.token }, 403);
	});

	test("core team creates an event with a leader", async () => {
		const event = await makeAPIRequest("/v1/events", {
			method: "POST",
			authToken: coreSession.token,
			body: {
				name: "Sommerfreizeit 2027",
				type: "camp",
				start_date: "2027-07-01",
				end_date: "2027-07-10",
				leader_ids: [leader.id],
			},
			expectedBodySchema: EventsModel.Create.Response,
		});

		expect(event.name).toBe("Sommerfreizeit 2027");
		expect(event.leaders.map((user) => user.id)).toEqual([leader.id]);
		expect(event.my_role).toBe("leader");
		expect(event.is_member).toBe(false);
		eventId = event.id;

		await addEventMember(eventId, staff.id, "staff");
	});

	test("rejects an end date before the start date", async () => {
		await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: coreSession.token,
				body: { name: "Kaputt", start_date: "2027-07-10", end_date: "2027-07-01" },
			},
			400,
		);
	});

	test("GET /v1/events lists only the caller's events", async () => {
		const mine = await makeAPIRequest("/v1/events", {
			authToken: staffSession.token,
			expectedBodySchema: EventsModel.GetAll.Response,
		});
		expect(mine.map((event) => event.id)).toEqual([eventId]);
		expect(mine[0]!.my_role).toBe("staff");
		expect(mine[0]!.permissions).toContain("tasks:create");
		expect(mine[0]!.permissions).not.toContain("budget:manage");

		const none = await makeAPIRequest("/v1/events", { authToken: outsiderSession.token });
		expect(none).toEqual([]);

		await makeAPIRequest("/v1/events?scope=all", { authToken: staffSession.token }, 403);
		const all = await makeAPIRequest("/v1/events?scope=all", { authToken: coreSession.token });
		expect(all.length).toBeGreaterThanOrEqual(1);
	});

	test("non-members get 403, unknown events 404", async () => {
		await makeAPIRequest(`/v1/events/${eventId}`, { authToken: outsiderSession.token }, 403);
		await makeAPIRequest("/v1/events/999999", { authToken: coreSession.token }, 404);
	});

	test("only leaders edit the event", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}`,
			{ method: "PUT", authToken: staffSession.token, body: { location: "Zeltplatz" } },
			403,
		);
		const updated = await makeAPIRequest(`/v1/events/${eventId}`, {
			method: "PUT",
			authToken: leaderSession.token,
			body: { location: "Zeltplatz" },
			expectedBodySchema: EventsModel.Update.Response,
		});
		expect(updated.location).toBe("Zeltplatz");
	});

	test("GET /v1/events/:eventId/overview", async () => {
		const overview = await makeAPIRequest(`/v1/events/${eventId}/overview`, {
			authToken: staffSession.token,
			expectedBodySchema: EventsModel.Overview.Response,
		});
		expect(overview.event.id).toBe(eventId);
		expect(overview.counts.pending_expenses).toBeNull();
	});
});

describe("Event tasks", () => {
	let taskId: number;

	test("staff create a task assigned to a colleague; the assignee is notified", async () => {
		const task = await makeAPIRequest(`/v1/events/${eventId}/tasks`, {
			method: "POST",
			authToken: leaderSession.token,
			body: { title: "Einkaufsliste schreiben", assignee_id: staff.id, priority: "high" },
			expectedBodySchema: EventTasksModel.Create.Response,
		});
		expect(task.assignee?.id).toBe(staff.id);
		taskId = task.id;

		const notifications = DB.instance().select().from(DB.Tables.notifications).all();
		expect(notifications.some((n) => n.user_id === staff.id && n.type === "task_assigned")).toBe(
			true,
		);
	});

	test("cannot assign tasks to non-members", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}/tasks`,
			{
				method: "POST",
				authToken: leaderSession.token,
				body: { title: "Falsch", assignee_id: outsider.id },
			},
			400,
		);
	});

	test("the assignee may only change the status", async () => {
		const done = await makeAPIRequest(`/v1/events/${eventId}/tasks/${taskId}`, {
			method: "PUT",
			authToken: staffSession.token,
			body: { status: "done" },
			expectedBodySchema: EventTasksModel.Update.Response,
		});
		expect(done.status).toBe("done");
		expect(done.completed_at).not.toBeNull();

		await makeAPIRequest(
			`/v1/events/${eventId}/tasks/${taskId}`,
			{ method: "PUT", authToken: staffSession.token, body: { title: "Umbenannt" } },
			403,
		);
	});

	test("filter=mine and delete", async () => {
		const mine = await makeAPIRequest(`/v1/events/${eventId}/tasks?filter=mine`, {
			authToken: staffSession.token,
		});
		expect(mine.map((task: any) => task.id)).toContain(taskId);

		await makeAPIRequest(
			`/v1/events/${eventId}/tasks/${taskId}`,
			{ method: "DELETE", authToken: staffSession.token },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}/tasks/${taskId}`, {
			method: "DELETE",
			authToken: leaderSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/tasks/${taskId}`,
			{ method: "PUT", authToken: leaderSession.token, body: { status: "open" } },
			404,
		);
	});

	test("deleting the event cascades to its rows", async () => {
		await makeAPIRequest(
			`/v1/events/${eventId}`,
			{ method: "DELETE", authToken: leaderSession.token },
			403,
		);
		await makeAPIRequest(`/v1/events/${eventId}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});
		const members = DB.instance().select().from(DB.Tables.eventMembers).all();
		expect(members.filter((member) => member.event_id === eventId)).toEqual([]);
	});
});

describe("Cross-org isolation", () => {
	const OTHER_HOST = "other-events.localhost";
	let otherOrg: OrgInfo;
	let otherAdmin: SeededUser;
	let otherUser: SeededUser;
	let otherAdminSession: SeededSession;
	let otherEventId: number;

	let admin: SeededUser;
	let adminSession: SeededSession;
	let ownEventId: number;

	const asOtherOrg = { additionalOptions: { headers: hostHeaders(OTHER_HOST) } };

	beforeAll(async () => {
		otherOrg = await OrgService.create({ slug: "other-events", display_name: "Andere Org" });
		await OrgContext.run(otherOrg, async () => {
			otherAdmin = await seedUser("admin");
			otherUser = await seedUser("volunteer");
			otherAdminSession = await seedSession(otherAdmin.id);
			otherEventId = DB.instance()
				.insert(DB.Tables.events)
				.values({
					org_id: OrgContext.id(),
					name: "Geheime Freizeit",
					start_date: "2027-08-01",
					end_date: "2027-08-05",
				})
				.returning()
				.get().id;
			await addEventMember(otherEventId, otherUser.id, "staff");
		});

		admin = await seedUser("admin");
		adminSession = await seedSession(admin.id);
		const own = await makeAPIRequest("/v1/events", {
			method: "POST",
			authToken: adminSession.token,
			body: { name: "Eigene Freizeit", start_date: "2027-09-01", end_date: "2027-09-05" },
			expectedBodySchema: EventsModel.Create.Response,
		});
		ownEventId = own.id;
	});

	test("another org's event is 404 for this org's admin", async () => {
		const auth = { authToken: adminSession.token };
		await makeAPIRequest(`/v1/events/${otherEventId}`, auth, 404);
		await makeAPIRequest(`/v1/events/${otherEventId}/overview`, auth, 404);
		await makeAPIRequest(`/v1/events/${otherEventId}/members`, auth, 404);
		await makeAPIRequest(`/v1/events/${otherEventId}/participants`, auth, 404);
		await makeAPIRequest(
			`/v1/events/${otherEventId}`,
			{ ...auth, method: "PUT", body: { name: "Übernommen" } },
			404,
		);
		await makeAPIRequest(`/v1/events/${otherEventId}`, { ...auth, method: "DELETE" }, 404);

		const all = await makeAPIRequest("/v1/events?scope=all&include_archived=true", {
			...auth,
			expectedBodySchema: EventsModel.GetAll.Response,
		});
		expect(all.map((event) => event.id)).not.toContain(otherEventId);
		expect(all.map((event) => event.id)).toContain(ownEventId);

		const stillThere = await OrgContext.run(otherOrg, () =>
			DB.instance()
				.select()
				.from(DB.Tables.events)
				.where(and(inOrg(DB.Tables.events), eq(DB.Tables.events.id, otherEventId)))
				.get(),
		);
		expect(stillThere?.name).toBe("Geheime Freizeit");
	});

	test("users of another org can't be added as members, leaders or assignees", async () => {
		await makeAPIRequest(
			`/v1/events/${ownEventId}/members`,
			{
				method: "POST",
				authToken: adminSession.token,
				body: { user_id: otherUser.id, role: "staff" },
			},
			404,
		);

		const created = await makeAPIRequest("/v1/events", {
			method: "POST",
			authToken: adminSession.token,
			body: {
				name: "Mit fremder Leitung",
				start_date: "2027-10-01",
				end_date: "2027-10-02",
				leader_ids: [otherUser.id],
			},
			expectedBodySchema: EventsModel.Create.Response,
		});
		expect(created.leaders).toEqual([]);
		expect(created.staff_count).toBe(0);

		await makeAPIRequest(
			`/v1/events/${ownEventId}/tasks`,
			{
				method: "POST",
				authToken: adminSession.token,
				body: { title: "Fremd zuweisen", assignee_id: otherUser.id },
			},
			400,
		);
	});

	test("a token only works on its own org's host", async () => {
		await makeAPIRequest(`/v1/events/${ownEventId}`, { authToken: otherAdminSession.token }, 401);

		const mine = await makeAPIRequest(`/v1/events/${otherEventId}`, {
			authToken: otherAdminSession.token,
			...asOtherOrg,
			expectedBodySchema: EventsModel.EventWithAccess,
		});
		expect(mine.name).toBe("Geheime Freizeit");
		await makeAPIRequest(
			`/v1/events/${ownEventId}`,
			{ authToken: otherAdminSession.token, ...asOtherOrg },
			404,
		);
	});
});
