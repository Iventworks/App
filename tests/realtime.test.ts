/**
 * The realtime WebSocket: tickets, who may connect, what reaches whom (chat changes, typing,
 * presence, notifications), limits, and that a revoked session loses its socket. Most tests drive
 * the gateway's hooks with fake sockets; the last one goes through a real Bun WebSocket with the
 * crossws adapter the server entry uses.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import wsAdapter from "crossws/adapters/bun";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import type { OrgInfo } from "../server/lib/orgs/registry";
import { OrgService } from "../server/lib/orgs/service";
import { RealtimeGateway, type RealtimePeer } from "../server/lib/realtime/gateway";
import { RealtimeHub } from "../server/lib/realtime/hub";
import { RealtimeLimits } from "../server/lib/realtime/limits";
import { RealtimeProtocol } from "../server/lib/realtime/protocol";
import { RealtimeTickets } from "../server/lib/realtime/tickets";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders, SYSTEM_HOST, TEST_HOST } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

type Event = RealtimeProtocol.ServerEvent;

interface FakeSocket {
	peer: RealtimePeer;
	received: Event[];
	closed: { code?: number; reason?: string } | null;
	/** Events of one type received so far. */
	of<T extends Event["type"]>(type: T): Extract<Event, { type: T }>[];
	clear(): void;
}

let mira: SeededUser;
let jonas: SeededUser;
let outsider: SeededUser;
let core: SeededUser;
let pending: SeededUser;

let miraSession: SeededSession;
let jonasSession: SeededSession;
let outsiderSession: SeededSession;
let coreSession: SeededSession;
let pendingSession: SeededSession;

let chatId: number;

let otherOrg: OrgInfo;
let otherHost: string;
let stranger: SeededUser;
let strangerSession: SeededSession;

function upgradeRequest(
	ticket: string,
	host = TEST_HOST,
	extraHeaders: Record<string, string> = {},
) {
	return {
		url: `http://${host}${RealtimeLimits.PATH}?ticket=${encodeURIComponent(ticket)}`,
		headers: new Headers({ ...hostHeaders(host), ...extraHeaders }),
		context: {} as Record<string, unknown>,
	};
}

async function ticketFor(token: string, host = TEST_HOST, expectedCode = 200) {
	const result = await makeAPIRequest(
		"/v1/realtime/ticket",
		{ method: "POST", authToken: token, additionalOptions: { headers: hostHeaders(host) } },
		expectedCode,
	);
	return result?.ticket as string;
}

function fakeSocket(context: Record<string, unknown>): FakeSocket {
	const socket: FakeSocket = {
		received: [],
		closed: null,
		peer: {
			id: randomUUID(),
			context,
			send: (data: string) => {
				socket.received.push(JSON.parse(data));
			},
			close: (code?: number, reason?: string) => {
				if (socket.closed) return;
				socket.closed = { code, reason };
				RealtimeGateway.close(socket.peer);
			},
		},
		of: (type) => socket.received.filter((event) => event.type === type) as never,
		clear: () => {
			socket.received = [];
		},
	};
	return socket;
}

/** Open a fake socket like a browser would: ticket, upgrade, open. */
async function connect(token: string, host = TEST_HOST) {
	const request = upgradeRequest(await ticketFor(token, host), host);
	const rejection = await RealtimeGateway.upgrade(request);
	expect(rejection).toBeUndefined();
	const socket = fakeSocket(request.context);
	RealtimeGateway.open(socket.peer);
	return socket;
}

function disconnect(socket: FakeSocket) {
	socket.peer.close(1000, "bye");
}

async function send(socket: FakeSocket, event: unknown) {
	await RealtimeGateway.message(socket.peer, JSON.stringify(event));
}

beforeAll(async () => {
	RealtimeHub.clear();
	RealtimeTickets.clear();

	mira = await seedUser("volunteer", { display_name: "Mira Mitte" });
	jonas = await seedUser("volunteer", { display_name: "Jonas Jetzt" });
	outsider = await seedUser("volunteer", { display_name: "Otto Außen" });
	core = await seedUser("core_team", { display_name: "Karla Kern" });
	pending = await seedUser("unverified", { display_name: "Paul Pending" });

	miraSession = await seedSession(mira.id);
	jonasSession = await seedSession(jonas.id);
	outsiderSession = await seedSession(outsider.id);
	coreSession = await seedSession(core.id);
	pendingSession = await seedSession(pending.id);

	const chat = await makeAPIRequest(
		"/v1/conversations",
		{
			method: "POST",
			authToken: miraSession.token,
			body: { type: "group", name: "Live", user_ids: [jonas.id] },
		},
		201,
	);
	chatId = chat.id;

	otherOrg = await OrgService.create({
		slug: `rt-${randomUUID().slice(0, 8)}`,
		display_name: "Andere Org (Realtime)",
	});
	otherHost = `${otherOrg.slug}.localhost`;
	stranger = await OrgContext.run(otherOrg, () =>
		seedUser("volunteer", { display_name: "Sina Fremd" }),
	);
	strangerSession = await OrgContext.run(otherOrg, () => seedSession(stranger.id));
});

afterAll(() => {
	for (const connection of RealtimeHub.all()) connection.close(1000, "done");
	RealtimeHub.clear();
	RealtimeGateway.stopRevalidation();
});

describe("Tickets", () => {
	test("only signed-in, activated people of an org get one", async () => {
		await makeAPIRequest("/v1/realtime/ticket", { method: "POST" }, 401);
		await ticketFor(pendingSession.token, TEST_HOST, 403);
		// The system host has no chats.
		await ticketFor(coreSession.token, SYSTEM_HOST, 404);

		const result = await makeAPIRequest("/v1/realtime/ticket", {
			method: "POST",
			authToken: miraSession.token,
		});
		expect(result.path).toBe("/ws/realtime");
		expect(result.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(result.expires_at).toBeGreaterThan(Date.now());
	});

	test("a ticket works once, briefly, and only on its org's host", async () => {
		const ticket = await ticketFor(miraSession.token);
		// Another org's host: refused (and the ticket is spent).
		expect((await RealtimeGateway.upgrade(upgradeRequest(ticket, otherHost)))?.status).toBe(401);
		expect((await RealtimeGateway.upgrade(upgradeRequest(ticket)))?.status).toBe(401);

		const once = await ticketFor(miraSession.token);
		expect(await RealtimeGateway.upgrade(upgradeRequest(once))).toBeUndefined();
		expect((await RealtimeGateway.upgrade(upgradeRequest(once)))?.status).toBe(401);

		const auth = DB.instance()
			.select()
			.from(DB.Tables.sessions)
			.where(eq(DB.Tables.sessions.user_id, mira.id))
			.get()!;
		const { ticket: old } = RealtimeTickets.issue(
			OrgContext.id(),
			{ ...auth, type: "session" },
			Date.now() - RealtimeLimits.TICKET_TTL_MS - 1,
		);
		expect((await RealtimeGateway.upgrade(upgradeRequest(old)))?.status).toBe(401);

		expect((await RealtimeGateway.upgrade(upgradeRequest("made-up")))?.status).toBe(401);
		expect((await RealtimeGateway.upgrade(upgradeRequest("")))?.status).toBe(401);
	});

	test("another site can't open a socket, unknown hosts get nothing", async () => {
		const ticket = await ticketFor(miraSession.token);
		const foreign = upgradeRequest(ticket, TEST_HOST, { Origin: "https://evil.example" });
		expect((await RealtimeGateway.upgrade(foreign))?.status).toBe(403);

		const sameSite = upgradeRequest(await ticketFor(miraSession.token), TEST_HOST, {
			Origin: `https://${TEST_HOST}`,
		});
		expect(await RealtimeGateway.upgrade(sameSite)).toBeUndefined();

		const unknown = upgradeRequest(await ticketFor(miraSession.token), "nowhere.example");
		expect((await RealtimeGateway.upgrade(unknown))?.status).toBe(404);
	});

	test("an open without an accepted upgrade is closed", () => {
		const socket = fakeSocket({});
		RealtimeGateway.open(socket.peer);
		expect(socket.closed?.code).toBe(RealtimeProtocol.CLOSE_UNAUTHORIZED);
	});
});

describe("Presence", () => {
	test("hello lists who is online; others hear when someone comes and goes", async () => {
		const miraSocket = await connect(miraSession.token);
		const [hello] = miraSocket.of("hello");
		expect(hello?.user_id).toBe(mira.id);
		expect(hello?.online_user_ids).toContain(mira.id);

		const jonasSocket = await connect(jonasSession.token);
		expect(jonasSocket.of("hello")[0]?.online_user_ids).toEqual(
			expect.arrayContaining([mira.id, jonas.id]),
		);
		expect(miraSocket.of("presence")).toEqual([
			{ type: "presence", user_id: jonas.id, online: true },
		]);

		// A second tab doesn't announce anything; closing one of two doesn't make Jonas offline.
		const jonasTab = await connect(jonasSession.token);
		expect(miraSocket.of("presence")).toHaveLength(1);
		disconnect(jonasTab);
		expect(miraSocket.of("presence")).toHaveLength(1);

		disconnect(jonasSocket);
		expect(miraSocket.of("presence").at(-1)).toEqual({
			type: "presence",
			user_id: jonas.id,
			online: false,
		});
		disconnect(miraSocket);
	});

	test("nothing crosses into another org", async () => {
		const miraSocket = await connect(miraSession.token);
		const strangerSocket = await connect(strangerSession.token, otherHost);
		expect(strangerSocket.of("hello")[0]?.online_user_ids).toEqual([stranger.id]);
		expect(miraSocket.of("presence").some((event) => event.user_id === stranger.id)).toBe(false);
		disconnect(strangerSocket);
		disconnect(miraSocket);
	});
});

describe("Chat events", () => {
	test("a new message reaches the people of the chat, nobody else", async () => {
		const miraSocket = await connect(miraSession.token);
		const jonasSocket = await connect(jonasSession.token);
		const outsiderSocket = await connect(outsiderSession.token);
		const strangerSocket = await connect(strangerSession.token, otherHost);

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{ method: "POST", authToken: miraSession.token, body: { content: "Hallo live" } },
			201,
		);

		const expected = { type: "conversation", conversation_id: chatId, reason: "message" };
		expect(jonasSocket.of("conversation")).toEqual([expected as never]);
		// The sender's other devices, too.
		expect(miraSocket.of("conversation")).toEqual([expected as never]);
		expect(outsiderSocket.of("conversation")).toEqual([]);
		expect(strangerSocket.of("conversation")).toEqual([]);

		for (const socket of [miraSocket, jonasSocket, outsiderSocket, strangerSocket])
			disconnect(socket);
	});

	test("edits, reactions, pins, deletions, reading and settings are announced", async () => {
		const jonasSocket = await connect(jonasSession.token);
		const miraSocket = await connect(miraSession.token);
		const message = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{ method: "POST", authToken: miraSession.token, body: { content: "Gleich ändere ich das" } },
			201,
		);
		jonasSocket.clear();
		miraSocket.clear();

		const base = `/v1/conversations/${chatId}/messages/${message.id}`;
		await makeAPIRequest(base, {
			method: "PUT",
			authToken: miraSession.token,
			body: { content: "Geändert" },
		});
		await makeAPIRequest(`${base}/reactions`, {
			method: "POST",
			authToken: jonasSession.token,
			body: { emoji: "👍" },
		});
		await makeAPIRequest(`${base}/pin`, { method: "PUT", authToken: jonasSession.token });
		await makeAPIRequest(`${base}/pin`, { method: "DELETE", authToken: jonasSession.token });
		await makeAPIRequest(base, { method: "DELETE", authToken: miraSession.token });
		expect(jonasSocket.of("conversation").map((event) => event.reason)).toEqual([
			"update",
			"update",
			"update",
			"update",
			"update",
		]);

		await makeAPIRequest(`/v1/conversations/${chatId}/read`, {
			method: "POST",
			authToken: jonasSession.token,
		});
		expect(miraSocket.of("conversation").at(-1)?.reason).toBe("read");

		// Own settings only go to the person's own devices.
		jonasSocket.clear();
		miraSocket.clear();
		await makeAPIRequest(`/v1/conversations/${chatId}/preferences`, {
			method: "PUT",
			authToken: miraSession.token,
			body: { muted: true },
		});
		expect(miraSocket.of("conversation")).toEqual([
			{ type: "conversation", conversation_id: chatId, reason: "settings" } as never,
		]);
		expect(jonasSocket.of("conversation")).toEqual([]);

		disconnect(jonasSocket);
		disconnect(miraSocket);
	});

	test("new chats, added and removed members", async () => {
		const outsiderSocket = await connect(outsiderSession.token);
		const group = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: miraSession.token,
				body: { type: "group", name: "Neu", user_ids: [outsider.id] },
			},
			201,
		);
		expect(outsiderSocket.of("conversation").at(-1)).toEqual({
			type: "conversation",
			conversation_id: group.id,
			reason: "members",
		} as never);

		// Removed people hear it once more, so their list drops the chat; then nothing.
		outsiderSocket.clear();
		await makeAPIRequest(`/v1/conversations/${group.id}`, {
			method: "PUT",
			authToken: miraSession.token,
			body: { remove_user_ids: [outsider.id] },
		});
		expect(outsiderSocket.of("conversation")).toHaveLength(1);
		await makeAPIRequest(
			`/v1/conversations/${group.id}/messages`,
			{ method: "POST", authToken: miraSession.token, body: { content: "Ohne Otto" } },
			201,
		);
		expect(outsiderSocket.of("conversation")).toHaveLength(1);
		disconnect(outsiderSocket);
	});

	test("event channels reach the event's team", async () => {
		const event = await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: coreSession.token,
				body: {
					name: "Live-Camp",
					start_date: "2027-08-01",
					end_date: "2027-08-05",
					leader_ids: [mira.id],
				},
			},
			201,
		);
		await addEventMember(event.id, jonas.id, "staff");
		const channels = await makeAPIRequest("/v1/conversations", { authToken: miraSession.token });
		const channel = channels.find(
			(entry: any) => entry.type === "event" && entry.event?.id === event.id,
		);

		const jonasSocket = await connect(jonasSession.token);
		const outsiderSocket = await connect(outsiderSession.token);
		await makeAPIRequest(
			`/v1/conversations/${channel.id}/messages`,
			{ method: "POST", authToken: miraSession.token, body: { content: "An alle" } },
			201,
		);
		expect(jonasSocket.of("conversation").at(-1)?.conversation_id).toBe(channel.id);
		expect(outsiderSocket.of("conversation")).toEqual([]);
		disconnect(jonasSocket);
		disconnect(outsiderSocket);
	});
});

describe("Typing", () => {
	test("goes to the others in the chat, only from people in it, throttled", async () => {
		const miraSocket = await connect(miraSession.token);
		const jonasSocket = await connect(jonasSession.token);
		const outsiderSocket = await connect(outsiderSession.token);

		await send(miraSocket, { type: "typing", conversation_id: chatId });
		expect(jonasSocket.of("typing")).toEqual([
			{ type: "typing", conversation_id: chatId, user: { id: mira.id, display_name: "Mira Mitte" } },
		] as never);
		// Not back to the typist, not to people outside the chat.
		expect(miraSocket.of("typing")).toEqual([]);
		expect(outsiderSocket.of("typing")).toEqual([]);

		// Within the throttle: dropped.
		await send(miraSocket, { type: "typing", conversation_id: chatId });
		expect(jonasSocket.of("typing")).toHaveLength(1);

		// Someone outside the chat can't use it to reach its members.
		await send(outsiderSocket, { type: "typing", conversation_id: chatId });
		expect(jonasSocket.of("typing")).toHaveLength(1);
		expect(miraSocket.of("typing")).toEqual([]);

		// A chat of another org is not found from here.
		await send(miraSocket, { type: "typing", conversation_id: 99_999_999 });

		for (const socket of [miraSocket, jonasSocket, outsiderSocket]) disconnect(socket);
	});

	test("garbage is ignored, pings are answered, floods are cut off", async () => {
		const socket = await connect(miraSession.token);
		await RealtimeGateway.message(socket.peer, "not json");
		await send(socket, { type: "subscribe", topic: "everything" });
		await send(socket, { type: "typing", conversation_id: "1; drop table" });
		expect(socket.closed).toBeNull();

		await send(socket, { type: "ping" });
		expect(socket.of("pong")).toHaveLength(1);

		for (let i = 0; i < RealtimeLimits.MAX_MESSAGES_PER_WINDOW + 1; i++) {
			await send(socket, { type: "ping" });
		}
		expect(socket.closed?.code).toBe(RealtimeProtocol.CLOSE_TOO_MANY_MESSAGES);
	});
});

describe("Notifications", () => {
	test("new notifications are announced to their recipient only", async () => {
		const jonasSocket = await connect(jonasSession.token);
		const miraSocket = await connect(miraSession.token);
		await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: coreSession.token,
				body: {
					name: "Benachrichtigt",
					start_date: "2027-09-01",
					end_date: "2027-09-02",
					leader_ids: [jonas.id],
				},
			},
			201,
		);
		expect(jonasSocket.of("notification")).toHaveLength(1);
		expect(miraSocket.of("notification")).toHaveLength(0);
		disconnect(jonasSocket);
		disconnect(miraSocket);
	});
});

describe("Sessions", () => {
	test("logging out, suspension or demotion ends the socket at the next check", async () => {
		const loggedOut = await seedUser("volunteer", { display_name: "Lukas Logout" });
		const loggedOutSession = await seedSession(loggedOut.id);
		const suspended = await seedUser("volunteer", { display_name: "Susi Sperre" });
		const suspendedSession = await seedSession(suspended.id);
		const demoted = await seedUser("volunteer", { display_name: "Dirk Degradiert" });
		const demotedSession = await seedSession(demoted.id);

		const sockets = {
			loggedOut: await connect(loggedOutSession.token),
			suspended: await connect(suspendedSession.token),
			demoted: await connect(demotedSession.token),
			mira: await connect(miraSession.token),
		};

		await makeAPIRequest("/v1/auth/logout", { method: "POST", authToken: loggedOutSession.token });
		await makeAPIRequest(`/v1/admin/users/${suspended.id}/suspend`, {
			method: "POST",
			authToken: (await seedSession((await seedUser("admin")).id)).token,
			body: { reason: "Test" },
		});
		DB.instance()
			.update(DB.Tables.users)
			.set({ role: "unverified" })
			.where(eq(DB.Tables.users.id, demoted.id))
			.run();

		await RealtimeGateway.revalidate();

		expect(sockets.loggedOut.closed?.code).toBe(RealtimeProtocol.CLOSE_UNAUTHORIZED);
		expect(sockets.suspended.closed?.code).toBe(RealtimeProtocol.CLOSE_UNAUTHORIZED);
		expect(sockets.demoted.closed?.code).toBe(RealtimeProtocol.CLOSE_UNAUTHORIZED);
		expect(sockets.mira.closed).toBeNull();
		disconnect(sockets.mira);
	});

	test("one person can't open unlimited sockets", async () => {
		const sockets: FakeSocket[] = [];
		for (let i = 0; i < RealtimeLimits.MAX_CONNECTIONS_PER_USER; i++) {
			sockets.push(await connect(jonasSession.token));
		}
		const request = upgradeRequest(await ticketFor(jonasSession.token));
		expect((await RealtimeGateway.upgrade(request))?.status).toBe(429);
		for (const socket of sockets) disconnect(socket);
	});
});

describe("Over a real WebSocket", () => {
	test("crossws + Bun: connect, hello, chat event, typing", async () => {
		const ws = wsAdapter({ hooks: RealtimeGateway.hooks as never });
		const server = Bun.serve({
			port: 0,
			websocket: { ...ws.websocket, maxPayloadLength: RealtimeLimits.MAX_FRAME_BYTES },
			fetch(request, bunServer) {
				if (new URL(request.url).pathname === RealtimeLimits.PATH) {
					return ws.handleUpgrade(request, bunServer);
				}
				return new Response("not found", { status: 404 });
			},
		});

		const open = async (token: string) => {
			const ticket = await ticketFor(token);
			const socket = new WebSocket(
				`ws://127.0.0.1:${server.port}${RealtimeLimits.PATH}?ticket=${ticket}`,
				{
					headers: hostHeaders(TEST_HOST),
				} as never,
			);
			const events: Event[] = [];
			socket.addEventListener("message", (message) => events.push(JSON.parse(String(message.data))));
			await new Promise<void>((resolve, reject) => {
				socket.addEventListener("open", () => resolve());
				socket.addEventListener("error", () => reject(new Error("socket error")));
			});
			return { socket, events };
		};
		const waitFor = async (check: () => boolean) => {
			for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(20);
			expect(check()).toBe(true);
		};

		try {
			const miraClient = await open(miraSession.token);
			const jonasClient = await open(jonasSession.token);
			await waitFor(() => miraClient.events.some((event) => event.type === "hello"));

			await makeAPIRequest(
				`/v1/conversations/${chatId}/messages`,
				{ method: "POST", authToken: miraSession.token, body: { content: "Über das Netz" } },
				201,
			);
			await waitFor(() =>
				jonasClient.events.some((event) => event.type === "conversation" && event.reason === "message"),
			);

			miraClient.socket.send(JSON.stringify({ type: "typing", conversation_id: chatId }));
			await waitFor(() => jonasClient.events.some((event) => event.type === "typing"));

			// A refused upgrade never opens.
			const refused = new WebSocket(
				`ws://127.0.0.1:${server.port}${RealtimeLimits.PATH}?ticket=nope`,
				{
					headers: hostHeaders(TEST_HOST),
				} as never,
			);
			const outcome = await new Promise<string>((resolve) => {
				refused.addEventListener("open", () => resolve("open"));
				refused.addEventListener("error", () => resolve("error"));
				refused.addEventListener("close", () => resolve("closed"));
			});
			expect(outcome).not.toBe("open");

			miraClient.socket.close();
			jonasClient.socket.close();
			await waitFor(() => RealtimeHub.countForUser(OrgContext.id(), jonas.id) === 0);
		} finally {
			server.stop(true);
		}
	});
});
