import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { CalendarModel } from "../server/lib/api/versions/v1/routes/calendar/model";
import { MessagesModel } from "../server/lib/api/versions/v1/routes/conversations/messages/model";
import { ConversationsModel } from "../server/lib/api/versions/v1/routes/conversations/model";
import { DashboardModel } from "../server/lib/api/versions/v1/routes/dashboard/model";
import { PersonalNotesModel } from "../server/lib/api/versions/v1/routes/notes/model";
import { NotificationsModel } from "../server/lib/api/versions/v1/routes/notifications/model";
import { PersonalTasksModel } from "../server/lib/api/versions/v1/routes/tasks/model";
import { UsersModel } from "../server/lib/api/versions/v1/routes/users/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import type { OrgInfo } from "../server/lib/orgs/registry";
import { OrgService } from "../server/lib/orgs/service";
import { TimeUtils } from "../server/lib/utils/time";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

const DAY_MS = 24 * 60 * 60 * 1000;

let core: SeededUser;
let alice: SeededUser;
let bob: SeededUser;
let carol: SeededUser;
let unverified: SeededUser;

let coreSession: SeededSession;
let aliceSession: SeededSession;
let bobSession: SeededSession;
let carolSession: SeededSession;
let unverifiedSession: SeededSession;

let runningEventId: number;
let upcomingEventId: number;
let groupId: number;
let programItemId: number;
let eventTaskId: number;
let groupTaskId: number;
let overdueTaskId: number;

const today = TimeUtils.today();
const { start: dayStart } = TimeUtils.dayBounds(today);

async function createEvent(name: string, start: string, end: string, leaderIds: number[]) {
	const event = await makeAPIRequest("/v1/events", {
		method: "POST",
		authToken: coreSession.token,
		body: { name, start_date: start, end_date: end, leader_ids: leaderIds },
	});
	return event.id as number;
}

beforeAll(async () => {
	core = await seedUser("core_team", { display_name: "Kerstin Kern" });
	alice = await seedUser("volunteer", { display_name: "Alice Anders" });
	bob = await seedUser("volunteer", { display_name: "Bob Berger" });
	carol = await seedUser("volunteer", { display_name: "Carol Clausen" });
	unverified = await seedUser("unverified", { display_name: "Uwe Unbekannt" });

	coreSession = await seedSession(core.id);
	aliceSession = await seedSession(alice.id);
	bobSession = await seedSession(bob.id);
	carolSession = await seedSession(carol.id);
	unverifiedSession = await seedSession(unverified.id);

	runningEventId = await createEvent(
		"Laufende Freizeit",
		TimeUtils.addDays(today, -1),
		TimeUtils.addDays(today, 3),
		[alice.id],
	);
	await addEventMember(runningEventId, bob.id, "staff");

	upcomingEventId = await createEvent(
		"Kommende Freizeit",
		TimeUtils.addDays(today, 10),
		TimeUtils.addDays(today, 12),
		[],
	);
	await addEventMember(upcomingEventId, alice.id, "staff");

	const db = DB.instance();
	const group = db
		.insert(DB.Tables.eventGroups)
		.values({
			org_id: OrgContext.id(),
			event_id: runningEventId,
			name: "Küchenteam",
			color: "#22c55e",
		})
		.returning()
		.get();
	groupId = group.id;
	db
		.insert(DB.Tables.eventGroupMembers)
		.values([
			{ org_id: OrgContext.id(), group_id: groupId, user_id: alice.id },
			{ org_id: OrgContext.id(), group_id: groupId, user_id: bob.id },
		])
		.run();

	const item = db
		.insert(DB.Tables.programItems)
		.values({
			org_id: OrgContext.id(),
			event_id: runningEventId,
			title: "Morgenandacht",
			start_at: dayStart + 9 * 60 * 60 * 1000,
			end_at: dayStart + 10 * 60 * 60 * 1000,
		})
		.returning()
		.get();
	programItemId = item.id;
	db
		.insert(DB.Tables.programItemResponsibles)
		.values({ org_id: OrgContext.id(), program_item_id: programItemId, user_id: alice.id })
		.run();

	eventTaskId = db
		.insert(DB.Tables.tasks)
		.values({
			org_id: OrgContext.id(),
			event_id: runningEventId,
			title: "Zelte aufbauen",
			assignee_id: alice.id,
			due_at: Date.now() + 2 * DAY_MS,
			created_by: core.id,
		})
		.returning()
		.get().id;

	groupTaskId = db
		.insert(DB.Tables.tasks)
		.values({
			org_id: OrgContext.id(),
			event_id: runningEventId,
			title: "Einkaufen",
			group_id: groupId,
			created_by: core.id,
		})
		.returning()
		.get().id;

	overdueTaskId = db
		.insert(DB.Tables.tasks)
		.values({
			org_id: OrgContext.id(),
			title: "Formular abgeben",
			user_id: alice.id,
			created_by: alice.id,
			due_at: Date.now() - DAY_MS,
			priority: "high",
		})
		.returning()
		.get().id;

	db
		.insert(DB.Tables.announcements)
		.values({
			org_id: OrgContext.id(),
			title: "Neue Datenschutzregeln",
			content: "Bitte lesen.",
			created_by: core.id,
		})
		.run();
	db
		.insert(DB.Tables.announcements)
		.values({
			org_id: OrgContext.id(),
			event_id: runningEventId,
			title: "Essen um 12",
			created_by: alice.id,
		})
		.run();
});

describe("Access", () => {
	test("unverified accounts get 403 on personal routes", async () => {
		for (const path of [
			"/v1/dashboard",
			"/v1/tasks",
			"/v1/notes",
			"/v1/conversations",
			"/v1/users",
		]) {
			await makeAPIRequest(path, { authToken: unverifiedSession.token }, 403);
		}
	});

	test("requests without a token get 401", async () => {
		await makeAPIRequest("/v1/dashboard", {}, 401);
	});
});

describe("Dashboard", () => {
	test("GET /v1/dashboard aggregates running events, tasks and news", async () => {
		const dashboard = await makeAPIRequest("/v1/dashboard", {
			authToken: aliceSession.token,
			expectedBodySchema: DashboardModel.Response,
		});

		expect(dashboard.today).toBe(today);

		const running = dashboard.current_events.find((event) => event.id === runningEventId);
		expect(running).toBeDefined();
		expect(running!.day_number).toBe(2);
		expect(running!.total_days).toBe(5);
		expect(running!.my_role).toBe("leader");
		expect(running!.today_program.map((item) => item.id)).toEqual([programItemId]);
		expect(running!.today_program[0]!.is_mine).toBe(true);
		expect(running!.latest_announcements[0]?.title).toBe("Essen um 12");

		expect(dashboard.upcoming_events.map((event) => event.id)).toEqual([upcomingEventId]);
		expect(dashboard.upcoming_events[0]!.days_until).toBe(10);

		expect(dashboard.tasks.overdue.map((task) => task.id)).toEqual([overdueTaskId]);
		expect(dashboard.tasks.due_soon.map((task) => task.id)).toContain(eventTaskId);
		expect(dashboard.tasks.open_count).toBe(3);

		expect(dashboard.org_announcements[0]?.title).toBe("Neue Datenschutzregeln");
		expect(dashboard.org_announcements[0]?.created_by?.id).toBe(core.id);
	});

	test("outsiders see no events", async () => {
		const dashboard = await makeAPIRequest("/v1/dashboard", {
			authToken: carolSession.token,
			expectedBodySchema: DashboardModel.Response,
		});
		expect(dashboard.current_events).toEqual([]);
		expect(dashboard.upcoming_events).toEqual([]);
		expect(dashboard.tasks.open_count).toBe(0);
	});
});

describe("Personal tasks", () => {
	let personalTaskId: number;

	test("GET /v1/tasks combines personal, assigned and group tasks", async () => {
		const tasks = await makeAPIRequest("/v1/tasks", {
			authToken: aliceSession.token,
			expectedBodySchema: PersonalTasksModel.GetAll.Response,
		});
		expect(tasks.map((task) => task.id)).toEqual([overdueTaskId, eventTaskId, groupTaskId]);
		expect(tasks[0]!.is_overdue).toBe(true);
		expect(tasks[0]!.source).toBe("personal");
		expect(tasks[1]!.event?.id).toBe(runningEventId);
		expect(tasks[2]!.group?.name).toBe("Küchenteam");

		const personal = await makeAPIRequest("/v1/tasks?scope=personal", {
			authToken: aliceSession.token,
		});
		expect(personal.map((task: any) => task.id)).toEqual([overdueTaskId]);

		const bobs = await makeAPIRequest("/v1/tasks", { authToken: bobSession.token });
		expect(bobs.map((task: any) => task.id)).toEqual([groupTaskId]);
	});

	test("personal task CRUD", async () => {
		const task = await makeAPIRequest("/v1/tasks", {
			method: "POST",
			authToken: aliceSession.token,
			body: { title: "Packliste" },
			expectedBodySchema: PersonalTasksModel.Create.Response,
		});
		personalTaskId = task.id;
		expect(task.source).toBe("personal");

		const done = await makeAPIRequest(`/v1/tasks/${personalTaskId}`, {
			method: "PUT",
			authToken: aliceSession.token,
			body: { status: "done" },
			expectedBodySchema: PersonalTasksModel.Update.Response,
		});
		expect(done.completed_at).not.toBeNull();

		const withoutDone = await makeAPIRequest("/v1/tasks?scope=personal", {
			authToken: aliceSession.token,
		});
		expect(withoutDone.map((entry: any) => entry.id)).not.toContain(personalTaskId);

		const withDone = await makeAPIRequest("/v1/tasks?scope=personal&include_done=true", {
			authToken: aliceSession.token,
		});
		expect(withDone.map((entry: any) => entry.id)).toContain(personalTaskId);
	});

	test("event tasks and other users' tasks are not editable here", async () => {
		await makeAPIRequest(
			`/v1/tasks/${eventTaskId}`,
			{ method: "PUT", authToken: aliceSession.token, body: { status: "done" } },
			404,
		);
		await makeAPIRequest(
			`/v1/tasks/${personalTaskId}`,
			{ method: "DELETE", authToken: bobSession.token },
			404,
		);
		await makeAPIRequest(`/v1/tasks/${personalTaskId}`, {
			method: "DELETE",
			authToken: aliceSession.token,
		});
	});
});

describe("Personal notes", () => {
	test("CRUD, search and isolation", async () => {
		const note = await makeAPIRequest("/v1/notes", {
			method: "POST",
			authToken: aliceSession.token,
			body: { title: "Ideen", content: "Geländespiel mit Fackeln" },
			expectedBodySchema: PersonalNotesModel.Create.Response,
		});
		expect(note.scope).toBe("personal");

		await makeAPIRequest("/v1/notes", {
			method: "POST",
			authToken: aliceSession.token,
			body: { title: "Angepinnt", pinned: true },
		});

		const list = await makeAPIRequest("/v1/notes", {
			authToken: aliceSession.token,
			expectedBodySchema: PersonalNotesModel.GetAll.Response,
		});
		expect(list[0]!.title).toBe("Angepinnt");

		const found = await makeAPIRequest("/v1/notes?search=Fackeln", {
			authToken: aliceSession.token,
		});
		expect(found.map((entry: any) => entry.id)).toEqual([note.id]);

		expect(await makeAPIRequest("/v1/notes", { authToken: bobSession.token })).toEqual([]);
		await makeAPIRequest(`/v1/notes/${note.id}`, { authToken: bobSession.token }, 404);

		const updated = await makeAPIRequest(`/v1/notes/${note.id}`, {
			method: "PUT",
			authToken: aliceSession.token,
			body: { content: "Geändert" },
			expectedBodySchema: PersonalNotesModel.Update.Response,
		});
		expect(updated.content).toBe("Geändert");

		await makeAPIRequest(`/v1/notes/${note.id}`, { method: "DELETE", authToken: aliceSession.token });
		await makeAPIRequest(`/v1/notes/${note.id}`, { authToken: aliceSession.token }, 404);
	});
});

describe("Calendar", () => {
	let entryId: number;

	test("calendar entries validate the time range", async () => {
		await makeAPIRequest(
			"/v1/calendar/entries",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { title: "Kaputt", start_at: dayStart + 1000, end_at: dayStart },
			},
			400,
		);

		const entry = await makeAPIRequest("/v1/calendar/entries", {
			method: "POST",
			authToken: aliceSession.token,
			body: {
				title: "Zahnarzt",
				start_at: dayStart + 14 * 60 * 60 * 1000,
				end_at: dayStart + 15 * 60 * 60 * 1000,
			},
			expectedBodySchema: CalendarModel.CreateEntry.Response,
		});
		entryId = entry.id;

		await makeAPIRequest(
			`/v1/calendar/entries/${entryId}`,
			{ method: "PUT", authToken: aliceSession.token, body: { end_at: dayStart } },
			400,
		);
		await makeAPIRequest(
			`/v1/calendar/entries/${entryId}`,
			{ method: "PUT", authToken: bobSession.token, body: { title: "Fremd" } },
			404,
		);
	});

	test("GET /v1/calendar/feed combines all sources", async () => {
		const from = dayStart - 2 * DAY_MS;
		const to = dayStart + 14 * DAY_MS;

		await makeAPIRequest(
			`/v1/calendar/feed?from=${from}&to=${from + 121 * DAY_MS}`,
			{ authToken: aliceSession.token },
			400,
		);
		await makeAPIRequest(
			`/v1/calendar/feed?from=${to}&to=${from}`,
			{ authToken: aliceSession.token },
			400,
		);

		const feed = await makeAPIRequest(`/v1/calendar/feed?from=${from}&to=${to}`, {
			authToken: aliceSession.token,
			expectedBodySchema: CalendarModel.Feed.Response,
		});
		const ids = feed.map((item) => item.id);
		expect(ids).toContain(`entry-${entryId}`);
		expect(ids).toContain(`program-${programItemId}`);
		expect(ids).toContain(`event-${runningEventId}`);
		expect(ids).toContain(`event-${upcomingEventId}`);
		expect(ids).toContain(`task-${eventTaskId}`);
		expect(feed.find((item) => item.id === `program-${programItemId}`)?.is_mine).toBe(true);

		const bobsFeed = await makeAPIRequest(`/v1/calendar/feed?from=${from}&to=${to}`, {
			authToken: bobSession.token,
		});
		const bobIds = bobsFeed.map((item: any) => item.id);
		expect(bobIds).not.toContain(`entry-${entryId}`);
		expect(bobIds).not.toContain(`event-${upcomingEventId}`);
		expect(bobsFeed.find((item: any) => item.id === `program-${programItemId}`)?.is_mine).toBe(false);
	});
});

describe("Notifications", () => {
	test("own-only listing, read markers and deletion", async () => {
		const db = DB.instance();
		const aliceNote = db
			.insert(DB.Tables.notifications)
			.values({ org_id: OrgContext.id(), user_id: alice.id, type: "system", title: "Hallo Alice" })
			.returning()
			.get();
		db
			.insert(DB.Tables.notifications)
			.values([
				{ org_id: OrgContext.id(), user_id: alice.id, type: "system", title: "Zweite" },
				{ org_id: OrgContext.id(), user_id: bob.id, type: "system", title: "Hallo Bob" },
			])
			.run();

		const list = await makeAPIRequest("/v1/notifications", {
			authToken: aliceSession.token,
			expectedBodySchema: NotificationsModel.GetAll.Response,
		});
		expect(list.items.every((item) => item.user_id === alice.id)).toBe(true);
		const initialUnread = list.unread_count;
		expect(initialUnread).toBeGreaterThanOrEqual(2);

		await makeAPIRequest(
			`/v1/notifications/${aliceNote.id}/read`,
			{ method: "PUT", authToken: bobSession.token },
			404,
		);
		const read = await makeAPIRequest(`/v1/notifications/${aliceNote.id}/read`, {
			method: "PUT",
			authToken: aliceSession.token,
			expectedBodySchema: NotificationsModel.Notification,
		});
		expect(read.read_at).not.toBeNull();

		const unreadOnly = await makeAPIRequest("/v1/notifications?unread_only=true", {
			authToken: aliceSession.token,
		});
		expect(unreadOnly.unread_count).toBe(initialUnread - 1);
		expect(unreadOnly.items.map((item: any) => item.id)).not.toContain(aliceNote.id);

		await makeAPIRequest("/v1/notifications/read-all", {
			method: "POST",
			authToken: aliceSession.token,
		});
		const after = await makeAPIRequest("/v1/notifications", { authToken: aliceSession.token });
		expect(after.unread_count).toBe(0);

		const bobs = await makeAPIRequest("/v1/notifications", { authToken: bobSession.token });
		expect(bobs.unread_count).toBe(1);

		await makeAPIRequest(
			`/v1/notifications/${aliceNote.id}`,
			{ method: "DELETE", authToken: bobSession.token },
			404,
		);
		await makeAPIRequest(`/v1/notifications/${aliceNote.id}`, {
			method: "DELETE",
			authToken: aliceSession.token,
		});
	});
});

describe("Conversations", () => {
	let directId: number;
	let groupChatId: number;
	let eventChannelId: number;
	let groupChannelId: number;
	const messageIds: number[] = [];

	test("direct chats are deduplicated", async () => {
		const created = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "direct", user_ids: [bob.id] },
				expectedBodySchema: ConversationsModel.Create.Response,
			},
			201,
		);
		directId = created.id;
		expect(created.title).toBe("Bob Berger");
		expect(created.members.map((member) => member.id).sort()).toEqual([alice.id, bob.id].sort());

		const again = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: bobSession.token,
				body: { type: "direct", user_ids: [alice.id] },
				expectedBodySchema: ConversationsModel.Create.Response,
			},
			200,
		);
		expect(again.id).toBe(directId);
		expect(again.title).toBe("Alice Anders");
	});

	test("invalid conversation requests", async () => {
		await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "direct", user_ids: [alice.id] },
			},
			400,
		);
		await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "direct", user_ids: [unverified.id] },
			},
			400,
		);
		await makeAPIRequest(
			"/v1/conversations",
			{ method: "POST", authToken: aliceSession.token, body: { type: "group", user_ids: [bob.id] } },
			400,
		);
	});

	test("derived event, group and core team channels", async () => {
		const list = await makeAPIRequest("/v1/conversations", {
			authToken: aliceSession.token,
			expectedBodySchema: ConversationsModel.GetAll.Response,
		});

		const eventChannel = list.find(
			(item) => item.type === "event" && item.event?.id === runningEventId,
		);
		const groupChannel = list.find(
			(item) => item.type === "event_group" && item.group?.id === groupId,
		);
		expect(eventChannel?.title).toBe("Laufende Freizeit");
		expect(groupChannel?.title).toBe("Küchenteam");
		expect(list.some((item) => item.type === "event" && item.event?.id === upcomingEventId)).toBe(
			true,
		);
		expect(list.some((item) => item.type === "core_team")).toBe(false);
		eventChannelId = eventChannel!.id;
		groupChannelId = groupChannel!.id;

		// Listing twice must not create duplicates.
		const again = await makeAPIRequest("/v1/conversations", { authToken: aliceSession.token });
		expect(again.length).toBe(list.length);

		const coreList = await makeAPIRequest("/v1/conversations", { authToken: coreSession.token });
		const coreChannel = coreList.find((item: any) => item.type === "core_team");
		expect(coreChannel?.title).toBe("Kernteam");

		await makeAPIRequest(
			`/v1/conversations/${coreChannel.id}`,
			{ authToken: aliceSession.token },
			403,
		);
		await makeAPIRequest(
			`/v1/conversations/${eventChannelId}`,
			{ authToken: carolSession.token },
			403,
		);
		await makeAPIRequest(
			`/v1/conversations/${groupChannelId}`,
			{ authToken: carolSession.token },
			403,
		);
		await makeAPIRequest(`/v1/conversations/${directId}`, { authToken: carolSession.token }, 403);
		await makeAPIRequest("/v1/conversations/999999", { authToken: aliceSession.token }, 404);

		// Bob is staff of the running event and in the group.
		await makeAPIRequest(`/v1/conversations/${eventChannelId}`, { authToken: bobSession.token });
		await makeAPIRequest(`/v1/conversations/${groupChannelId}`, { authToken: bobSession.token });
	});

	test("messages, unread counts and pagination", async () => {
		for (const content of ["Hallo Bob", "Wie geht's?", "Bis morgen"]) {
			const message = await makeAPIRequest(
				`/v1/conversations/${directId}/messages`,
				{
					method: "POST",
					authToken: aliceSession.token,
					body: { content },
					expectedBodySchema: MessagesModel.Create.Response,
				},
				201,
			);
			expect(message.is_own).toBe(true);
			messageIds.push(message.id);
		}

		const unread = await makeAPIRequest("/v1/conversations/unread", {
			authToken: bobSession.token,
			expectedBodySchema: ConversationsModel.Unread.Response,
		});
		expect(unread.total).toBe(3);
		const aliceUnread = await makeAPIRequest("/v1/conversations/unread", {
			authToken: aliceSession.token,
		});
		expect(aliceUnread.total).toBe(0);

		const latest = await makeAPIRequest(`/v1/conversations/${directId}/messages?limit=2`, {
			authToken: bobSession.token,
			expectedBodySchema: MessagesModel.GetAll.Response,
		});
		expect(latest.map((message) => message.id)).toEqual(messageIds.slice(1));
		expect(latest[0]!.is_own).toBe(false);
		expect(latest[0]!.sender?.id).toBe(alice.id);

		const newer = await makeAPIRequest(
			`/v1/conversations/${directId}/messages?after=${messageIds[0]}`,
			{ authToken: bobSession.token },
		);
		expect(newer.map((message: any) => message.id)).toEqual(messageIds.slice(1));

		const older = await makeAPIRequest(
			`/v1/conversations/${directId}/messages?before=${messageIds[2]}`,
			{ authToken: bobSession.token },
		);
		expect(older.map((message: any) => message.id)).toEqual(messageIds.slice(0, 2));

		const listItem = (
			await makeAPIRequest("/v1/conversations", { authToken: bobSession.token })
		).find((item: any) => item.id === directId);
		expect(listItem.unread_count).toBe(3);
		expect(listItem.last_message.content).toBe("Bis morgen");
		expect(listItem.last_message.sender_name).toBe("Alice Anders");

		await makeAPIRequest(`/v1/conversations/${directId}/read`, {
			method: "POST",
			authToken: bobSession.token,
		});
		const afterRead = await makeAPIRequest("/v1/conversations/unread", {
			authToken: bobSession.token,
		});
		expect(afterRead.total).toBe(0);

		// Derived channel read state works without an explicit membership row.
		await makeAPIRequest(`/v1/conversations/${eventChannelId}/messages`, {
			method: "POST",
			authToken: aliceSession.token,
			body: { content: "Treffen um 8 am Lagerfeuer" },
		});
		const bobEventUnread = await makeAPIRequest("/v1/conversations/unread", {
			authToken: bobSession.token,
		});
		expect(bobEventUnread.total).toBe(1);
		await makeAPIRequest(`/v1/conversations/${eventChannelId}/read`, {
			method: "POST",
			authToken: bobSession.token,
		});
		expect(
			(await makeAPIRequest("/v1/conversations/unread", { authToken: bobSession.token })).total,
		).toBe(0);

		const dashboard = await makeAPIRequest("/v1/dashboard", { authToken: aliceSession.token });
		expect(dashboard.unread_messages).toBe(0);
		expect(dashboard.recent_conversations.length).toBeGreaterThan(0);
	});

	test("only the author edits or deletes a message", async () => {
		const target = messageIds[0]!;
		await makeAPIRequest(
			`/v1/conversations/${directId}/messages/${target}`,
			{ method: "PUT", authToken: bobSession.token, body: { content: "Gehackt" } },
			403,
		);
		await makeAPIRequest(
			`/v1/conversations/${directId}/messages/${target}`,
			{ method: "DELETE", authToken: bobSession.token },
			403,
		);

		const edited = await makeAPIRequest(`/v1/conversations/${directId}/messages/${target}`, {
			method: "PUT",
			authToken: aliceSession.token,
			body: { content: "Hallo Bob!" },
			expectedBodySchema: MessagesModel.Update.Response,
		});
		expect(edited.edited_at).not.toBeNull();

		await makeAPIRequest(`/v1/conversations/${directId}/messages/${target}`, {
			method: "DELETE",
			authToken: aliceSession.token,
		});
		await makeAPIRequest(
			`/v1/conversations/${directId}/messages/${target}`,
			{ method: "PUT", authToken: aliceSession.token, body: { content: "x" } },
			404,
		);
	});

	test("sync reports new messages, other people's edits and deletions", async () => {
		const history = await makeAPIRequest(`/v1/conversations/${directId}/messages`, {
			authToken: bobSession.token,
			expectedBodySchema: MessagesModel.GetAll.Response,
		});
		// The message deleted in the previous test is gone from the history.
		expect(history.some((message) => message.id === messageIds[0])).toBe(false);

		const lastId = history.at(-1)!.id;
		const first = await makeAPIRequest(
			`/v1/conversations/${directId}/messages/sync?after=${lastId}&since=0`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Sync.Response },
		);
		expect(first.messages).toEqual([]);
		// The earlier delete is reported as a tombstone, not as content.
		expect(first.deleted_ids).toContain(messageIds[0]!);

		const since = first.server_time;
		const edited = messageIds[1]!;
		const deleted = messageIds[2]!;
		await makeAPIRequest(`/v1/conversations/${directId}/messages/${edited}`, {
			method: "PUT",
			authToken: aliceSession.token,
			body: { content: "Wie geht's dir?" },
		});
		await makeAPIRequest(`/v1/conversations/${directId}/messages/${deleted}`, {
			method: "DELETE",
			authToken: aliceSession.token,
		});
		const fresh = await makeAPIRequest(
			`/v1/conversations/${directId}/messages`,
			{ method: "POST", authToken: aliceSession.token, body: { content: "Neu" } },
			201,
		);

		const sync = await makeAPIRequest(
			`/v1/conversations/${directId}/messages/sync?after=${lastId}&since=${since}`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Sync.Response },
		);
		expect(sync.messages.map((message) => message.id)).toEqual([fresh.id]);
		expect(sync.updated.map((message) => [message.id, message.content])).toEqual([
			[edited, "Wie geht's dir?"],
		]);
		expect(sync.deleted_ids).toContain(deleted);
		expect(sync.server_time).toBeGreaterThanOrEqual(since);

		// Deleted messages keep no text and do not count as unread.
		const row = DB.instance()
			.select()
			.from(DB.Tables.messages)
			.where(eq(DB.Tables.messages.id, deleted))
			.get();
		expect(row?.content).toBe("");
		expect(row?.deleted_at).not.toBeNull();

		await makeAPIRequest(
			`/v1/conversations/${directId}/messages/sync?after=abc&since=0`,
			{ authToken: bobSession.token },
			400,
		);
		await makeAPIRequest(
			`/v1/conversations/${directId}/messages/sync?after=0&since=0`,
			{ authToken: carolSession.token },
			403,
		);
	});

	test("group chats: rename, add members, leave", async () => {
		const group = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "group", name: "Planungsrunde", user_ids: [bob.id] },
				expectedBodySchema: ConversationsModel.Create.Response,
			},
			201,
		);
		groupChatId = group.id;
		expect(group.title).toBe("Planungsrunde");

		await makeAPIRequest(`/v1/conversations/${groupChatId}`, { authToken: carolSession.token }, 403);

		const updated = await makeAPIRequest(`/v1/conversations/${groupChatId}`, {
			method: "PUT",
			authToken: bobSession.token,
			body: { name: "Planung 2027", add_user_ids: [carol.id] },
			expectedBodySchema: ConversationsModel.Update.Response,
		});
		expect(updated.name).toBe("Planung 2027");
		expect(updated.members.map((member) => member.id)).toContain(carol.id);
		await makeAPIRequest(`/v1/conversations/${groupChatId}`, { authToken: carolSession.token });

		await makeAPIRequest(
			`/v1/conversations/${directId}`,
			{ method: "PUT", authToken: aliceSession.token, body: { name: "Nope" } },
			403,
		);
		await makeAPIRequest(
			`/v1/conversations/${eventChannelId}/membership`,
			{ method: "DELETE", authToken: aliceSession.token },
			403,
		);

		await makeAPIRequest(`/v1/conversations/${groupChatId}/membership`, {
			method: "DELETE",
			authToken: carolSession.token,
		});
		await makeAPIRequest(`/v1/conversations/${groupChatId}`, { authToken: carolSession.token }, 403);
	});
});

describe("Users directory", () => {
	test("lists active members only", async () => {
		const users = await makeAPIRequest("/v1/users", {
			authToken: aliceSession.token,
			expectedBodySchema: UsersModel.GetAll.Response,
		});
		const ids = users.map((user) => user.id);
		expect(ids).toContain(bob.id);
		expect(ids).not.toContain(unverified.id);

		const searched = await makeAPIRequest("/v1/users?search=Berger", {
			authToken: aliceSession.token,
		});
		expect(searched.map((user: any) => user.id)).toEqual([bob.id]);

		const coreOnly = await makeAPIRequest("/v1/users?role=core_team", {
			authToken: aliceSession.token,
		});
		expect(coreOnly.every((user: any) => user.role === "core_team")).toBe(true);

		await makeAPIRequest(`/v1/users/${unverified.id}`, { authToken: aliceSession.token }, 404);
	});

	test("profile shows only shared events (core team: all)", async () => {
		const forBob = await makeAPIRequest(`/v1/users/${alice.id}`, {
			authToken: bobSession.token,
			expectedBodySchema: UsersModel.GetById.Response,
		});
		expect(forBob.events.map((event) => event.id)).toEqual([runningEventId]);

		const forCarol = await makeAPIRequest(`/v1/users/${alice.id}`, {
			authToken: carolSession.token,
		});
		expect(forCarol.events).toEqual([]);

		const forCore = await makeAPIRequest(`/v1/users/${alice.id}`, {
			authToken: coreSession.token,
		});
		expect(forCore.events.map((event: any) => event.id).sort()).toEqual(
			[runningEventId, upcomingEventId].sort(),
		);
	});
});

describe("Cross-org isolation", () => {
	let otherOrg: OrgInfo;
	let otherHost: string;
	let outsider: SeededUser;
	let outsiderSession: SeededSession;

	beforeAll(async () => {
		otherOrg = await OrgService.create({
			slug: `other-${randomUUID().slice(0, 8)}`,
			display_name: "Andere Org",
		});
		otherHost = `${otherOrg.slug}.localhost`;
		// Seeded through the guarded path: inside the other org's context.
		outsider = await OrgContext.run(otherOrg, () =>
			seedUser("volunteer", { display_name: "Olga Outsider" }),
		);
		outsiderSession = await OrgContext.run(otherOrg, () => seedSession(outsider.id));
	});

	test("a chat can't be started with or extended by a user of another org", async () => {
		await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "direct", user_ids: [outsider.id] },
			},
			400,
		);
		await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "group", name: "Gemischt", user_ids: [bob.id, outsider.id] },
			},
			400,
		);

		const group = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "group", name: "Nur intern", user_ids: [bob.id] },
				expectedBodySchema: ConversationsModel.Create.Response,
			},
			201,
		);
		await makeAPIRequest(
			`/v1/conversations/${group.id}`,
			{ method: "PUT", authToken: aliceSession.token, body: { add_user_ids: [outsider.id] } },
			400,
		);

		// The other org's member sees neither the chat nor works with their token on this host.
		await makeAPIRequest("/v1/conversations", { authToken: outsiderSession.token }, 401);
		const theirs = await makeAPIRequest("/v1/conversations", {
			authToken: outsiderSession.token,
			additionalOptions: { headers: hostHeaders(otherHost) },
			expectedBodySchema: ConversationsModel.GetAll.Response,
		});
		expect(theirs.some((conversation) => conversation.id === group.id)).toBe(false);
		await makeAPIRequest(
			`/v1/conversations/${group.id}`,
			{ authToken: outsiderSession.token, additionalOptions: { headers: hostHeaders(otherHost) } },
			404,
		);
	});

	test("a download token only works on the host of the file's org", async () => {
		const form = new FormData();
		form.append("file", new File(["Nur für uns"], "intern.txt", { type: "text/plain" }));
		const file = await makeAPIRequest(
			"/v1/org/documents",
			{ authToken: coreSession.token, additionalOptions: { method: "POST", body: form } },
			201,
		);
		expect(file.download_token).toBeString();

		await makeAPIRequest(`/v1/files/download/${file.download_token}`, {}, 200);
		await makeAPIRequest(
			`/v1/files/download/${file.download_token}`,
			{ additionalOptions: { headers: hostHeaders(otherHost) } },
			404,
		);
		// Metadata by id is not reachable from the other org either.
		await makeAPIRequest(
			`/v1/files/${file.id}`,
			{ authToken: outsiderSession.token, additionalOptions: { headers: hostHeaders(otherHost) } },
			404,
		);
	});
});
