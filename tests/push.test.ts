/**
 * Web Push: subscriptions (who may register what), encryption and VAPID signature of what goes
 * out, when a push is sent and when not (muted, settings, active in the app), cleanup of dead
 * subscriptions, and the presence settings that come with it (online status, last seen).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
// @ts-expect-error http_ece (a dependency of web-push) ships no types.
import ece from "http_ece";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import type { OrgInfo } from "../server/lib/orgs/registry";
import { OrgService } from "../server/lib/orgs/service";
import { WebPushKeys } from "../server/lib/push/keys";
import { PushService } from "../server/lib/push/service";
import { RealtimeGateway } from "../server/lib/realtime/gateway";
import { RealtimeHub } from "../server/lib/realtime/hub";
import { RealtimeLimits } from "../server/lib/realtime/limits";
import type { RealtimeProtocol } from "../server/lib/realtime/protocol";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

interface Device {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	ecdh: ReturnType<typeof createECDH>;
}

interface Delivered {
	endpoint: string;
	headers: Record<string, string>;
	payload: { title: string; body: string; url: string; tag?: string; kind: string };
}

let delivered: Delivered[] = [];
const devices = new Map<string, Device>();
/** Status the fake push service answers with, per endpoint (default 201). */
const answers = new Map<string, number>();

let anna: SeededUser;
let ben: SeededUser;
let core: SeededUser;
let annaSession: SeededSession;
let benSession: SeededSession;
let coreSession: SeededSession;
let chatId: number;

function newDevice(host = "push.example.test"): Device {
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	const device: Device = {
		endpoint: `https://${host}/send/${randomUUID()}`,
		keys: { p256dh: ecdh.getPublicKey("base64url"), auth: randomBytes(16).toString("base64url") },
		ecdh,
	};
	devices.set(device.endpoint, device);
	return device;
}

async function register(token: string, device: Device, expectedCode = 200) {
	return await makeAPIRequest(
		"/v1/push/subscriptions",
		{
			method: "POST",
			authToken: token,
			body: { endpoint: device.endpoint, keys: device.keys },
			additionalOptions: {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
				},
			},
		},
		expectedCode,
	);
}

async function sendMessage(token: string, conversationId: number, content: string) {
	await makeAPIRequest(
		`/v1/conversations/${conversationId}/messages`,
		{ method: "POST", authToken: token, body: { content } },
		201,
	);
	await PushService.flush();
}

function deliveredTo(device: Device) {
	return delivered.filter((entry) => entry.endpoint === device.endpoint);
}

function fakeConnection(userId: number, active: boolean): RealtimeHub.Connection {
	return {
		id: randomUUID(),
		orgId: OrgContext.id(),
		userId,
		role: "volunteer",
		displayName: "",
		sharePresence: true,
		active,
		auth: {} as never,
		send: () => {},
		close: () => {},
		recentMessages: [],
		lastTyping: new Map(),
	};
}

beforeAll(async () => {
	WebPushKeys.reset();
	PushService.setTransport(async (request) => {
		const device = devices.get(request.endpoint);
		const status = answers.get(request.endpoint) ?? 201;
		if (device) {
			const plain = ece.decrypt(request.body, {
				version: "aes128gcm",
				privateKey: device.ecdh,
				authSecret: device.keys.auth,
			}) as Buffer;
			delivered.push({
				endpoint: request.endpoint,
				headers: request.headers,
				payload: JSON.parse(plain.toString("utf8")),
			});
		}
		return { status };
	});

	anna = await seedUser("volunteer", { display_name: "Anna Push" });
	ben = await seedUser("volunteer", { display_name: "Ben Benachrichtigt" });
	core = await seedUser("core_team", { display_name: "Kai Kern" });
	annaSession = await seedSession(anna.id);
	benSession = await seedSession(ben.id);
	coreSession = await seedSession(core.id);

	chatId = (
		await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: annaSession.token,
				body: { type: "group", name: "Push-Gruppe", user_ids: [ben.id] },
			},
			201,
		)
	).id;
});

afterEach(async () => {
	await PushService.flush();
	delivered = [];
	answers.clear();
});

afterAll(() => {
	PushService.setTransport(null);
	for (const connection of RealtimeHub.all()) connection.close();
	RealtimeHub.clear();
});

describe("Subscriptions", () => {
	test("the public key is generated once and kept", async () => {
		const first = await makeAPIRequest("/v1/push/config", { authToken: annaSession.token });
		expect(Buffer.from(first.public_key, "base64url")).toHaveLength(65);
		WebPushKeys.reset();
		const again = await makeAPIRequest("/v1/push/config", { authToken: benSession.token });
		expect(again.public_key).toBe(first.public_key);
		await makeAPIRequest("/v1/push/config", {}, 401);
	});

	test("only known push services over https, with valid keys", async () => {
		const valid = newDevice();
		const bad = (endpoint: string) => ({ ...valid, endpoint });
		for (const endpoint of [
			"http://push.example.test/send/1",
			"https://evil.example/send/1",
			"https://localhost/send/1",
			"https://127.0.0.1/send/1",
			"https://push.example.test:8443/send/1",
			"https://user:pass@push.example.test/send/1",
			"https://fcm.googleapis.com.evil.example/x",
			"not a url",
		]) {
			await register(annaSession.token, bad(endpoint), 400);
		}
		await register(annaSession.token, { ...valid, keys: { ...valid.keys, auth: "short" } }, 400);
		await register(annaSession.token, { ...valid, keys: { ...valid.keys, p256dh: "AAAA" } }, 400);

		expect(PushService.isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
		expect(PushService.isAllowedEndpoint("https://web.push.apple.com/x")).toBe(true);
		expect(PushService.isAllowedEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(
			true,
		);
		expect(
			PushService.isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"),
		).toBe(true);
	});

	test("register, list, re-register, remove", async () => {
		const phone = newDevice();
		const created = await register(annaSession.token, phone);
		expect(created.label).toBe("Chrome · Android");

		const list = await makeAPIRequest("/v1/push/subscriptions", { authToken: annaSession.token });
		expect(list.map((entry: any) => entry.endpoint)).toContain(phone.endpoint);
		// Others don't see it.
		const forBen = await makeAPIRequest("/v1/push/subscriptions", { authToken: benSession.token });
		expect(forBen.map((entry: any) => entry.endpoint)).not.toContain(phone.endpoint);

		// The same browser, now signed in as Ben: the subscription moves to him.
		await register(benSession.token, phone);
		const annaAfter = await makeAPIRequest("/v1/push/subscriptions", {
			authToken: annaSession.token,
		});
		expect(annaAfter.map((entry: any) => entry.endpoint)).not.toContain(phone.endpoint);

		// Ben can't remove Anna's devices, only his own.
		const tablet = newDevice();
		const annaTablet = await register(annaSession.token, tablet);
		await makeAPIRequest(
			`/v1/push/subscriptions/${annaTablet.id}`,
			{ method: "DELETE", authToken: benSession.token },
			404,
		);
		await makeAPIRequest(`/v1/push/subscriptions/${annaTablet.id}`, {
			method: "DELETE",
			authToken: annaSession.token,
		});

		await makeAPIRequest("/v1/push/subscriptions/unsubscribe", {
			method: "POST",
			authToken: benSession.token,
			body: { endpoint: phone.endpoint },
		});
		const benAfter = await makeAPIRequest("/v1/push/subscriptions", { authToken: benSession.token });
		expect(benAfter.map((entry: any) => entry.endpoint)).not.toContain(phone.endpoint);
	});

	test("an API key can't register a device; logging out ends the device's pushes", async () => {
		const key = await makeAPIRequest(
			"/v1/account/apikeys",
			{
				method: "POST",
				authToken: annaSession.token,
				body: { description: "Push-Test", expires_at: "7d" },
			},
			200,
		);
		await register(key.token, newDevice(), 403);

		const user = await seedUser("volunteer", { display_name: "Lea Logout" });
		const session = await seedSession(user.id);
		const device = newDevice();
		await register(session.token, device);
		await makeAPIRequest("/v1/auth/logout", { method: "POST", authToken: session.token });
		expect(
			DB.instance()
				.select()
				.from(DB.Tables.pushSubscriptions)
				.where(eq(DB.Tables.pushSubscriptions.endpoint, device.endpoint))
				.all(),
		).toHaveLength(0);
	});

	test("a device limit per person", async () => {
		const user = await seedUser("volunteer", { display_name: "Viele Geräte" });
		const session = await seedSession(user.id);
		for (let i = 0; i < PushService.MAX_SUBSCRIPTIONS_PER_USER + 3; i++) {
			await register(session.token, newDevice());
		}
		const list = await makeAPIRequest("/v1/push/subscriptions", { authToken: session.token });
		expect(list).toHaveLength(PushService.MAX_SUBSCRIPTIONS_PER_USER);
	});
});

describe("Delivery", () => {
	let benPhone: Device;

	beforeAll(async () => {
		benPhone = newDevice();
		await register(benSession.token, benPhone);
	});

	test("a chat message reaches the others' devices, encrypted and signed", async () => {
		const annaPhone = newDevice();
		await register(annaSession.token, annaPhone);

		await sendMessage(annaSession.token, chatId, "Treffen um 18 Uhr");

		const [push] = deliveredTo(benPhone);
		expect(push?.payload).toEqual({
			kind: "message",
			title: "Push-Gruppe",
			body: "Anna: Treffen um 18 Uhr",
			url: `/messages?c=${chatId}`,
			tag: `chat-${chatId}`,
		});
		// Not to the sender.
		expect(deliveredTo(annaPhone)).toHaveLength(0);

		expect(push?.headers.Urgency).toBe("high");
		expect(push?.headers.Topic).toBe(`chat${chatId}`);

		// VAPID: a JWT for the push service's origin, signed with the server's key.
		const keys = await WebPushKeys.get();
		const match = push!.headers.Authorization!.match(/^vapid t=([^,]+), k=(.+)$/);
		expect(match?.[2]).toBe(keys.publicKey);
		const [header, claims, signature] = match![1]!.split(".") as [string, string, string];
		const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
		expect(payload.aud).toBe("https://push.example.test");
		expect(payload.sub).toBe("mailto:push@example.com");
		expect(payload.exp * 1000).toBeGreaterThan(Date.now());
		const publicKey = await crypto.subtle.importKey(
			"raw",
			Buffer.from(keys.publicKey, "base64url"),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
		const valid = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			Buffer.from(signature, "base64url"),
			new TextEncoder().encode(`${header}.${claims}`),
		);
		expect(valid).toBe(true);
	});

	test("direct chats show the sender; attachments have a label", async () => {
		const direct = await makeAPIRequest(
			"/v1/conversations",
			{ method: "POST", authToken: annaSession.token, body: { type: "direct", user_ids: [ben.id] } },
			201,
		);
		await sendMessage(annaSession.token, direct.id, "Hallo Ben");
		expect(deliveredTo(benPhone)[0]?.payload).toMatchObject({
			title: "Anna Push",
			body: "Hallo Ben",
		});

		delivered = [];
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "bild.png", { type: "image/png" }),
		);
		const upload = await makeAPIRequest(
			`/v1/conversations/${direct.id}/attachments`,
			{ authToken: annaSession.token, additionalOptions: { method: "POST", body: form } },
			201,
		);
		await makeAPIRequest(
			`/v1/conversations/${direct.id}/messages`,
			{ method: "POST", authToken: annaSession.token, body: { attachment_ids: [upload.id] } },
			201,
		);
		await PushService.flush();
		expect(deliveredTo(benPhone)[0]?.payload.body).toBe("📷 Foto");
	});

	test("nothing while using the app, for muted chats, or when switched off", async () => {
		// Ben is in the app (visible, active tab).
		const active = fakeConnection(ben.id, true);
		RealtimeHub.add(active);
		await sendMessage(annaSession.token, chatId, "Siehst du eh");
		expect(deliveredTo(benPhone)).toHaveLength(0);
		// A tab in the background doesn't count.
		active.active = false;
		await sendMessage(annaSession.token, chatId, "Jetzt per Push");
		expect(deliveredTo(benPhone)).toHaveLength(1);
		RealtimeHub.remove(active);

		delivered = [];
		await makeAPIRequest(`/v1/conversations/${chatId}/preferences`, {
			method: "PUT",
			authToken: benSession.token,
			body: { muted: true },
		});
		await sendMessage(annaSession.token, chatId, "Stumm");
		expect(deliveredTo(benPhone)).toHaveLength(0);
		await makeAPIRequest(`/v1/conversations/${chatId}/preferences`, {
			method: "PUT",
			authToken: benSession.token,
			body: { muted: false },
		});

		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { push_preview: false },
		});
		await sendMessage(annaSession.token, chatId, "Geheimer Inhalt");
		expect(deliveredTo(benPhone)[0]?.payload.body).toBe("Neue Nachricht von Anna");
		expect(JSON.stringify(delivered)).not.toContain("Geheimer Inhalt");

		delivered = [];
		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { push_messages: false, push_preview: true },
		});
		await sendMessage(annaSession.token, chatId, "Gar nicht");
		expect(deliveredTo(benPhone)).toHaveLength(0);
		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { push_messages: true },
		});
	});

	test("in-app notifications are pushed too", async () => {
		await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: coreSession.token,
				body: {
					name: "Push-Camp",
					start_date: "2027-07-01",
					end_date: "2027-07-03",
					leader_ids: [ben.id],
				},
			},
			201,
		);
		await PushService.flush();
		const [push] = deliveredTo(benPhone);
		expect(push?.payload).toMatchObject({ kind: "notification", title: "Du leitest „Push-Camp“" });
		expect(push?.payload.url).toMatch(/^\/events\/\d+$/);

		delivered = [];
		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { push_notifications: false },
		});
		const event = await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: coreSession.token,
				body: { name: "Leise", start_date: "2027-08-01", end_date: "2027-08-02" },
			},
			201,
		);
		await addEventMember(event.id, ben.id, "staff");
		await makeAPIRequest(
			`/v1/events/${event.id}/tasks`,
			{
				method: "POST",
				authToken: coreSession.token,
				body: { title: "Aufgabe", assignee_id: ben.id },
			},
			201,
		);
		await PushService.flush();
		expect(deliveredTo(benPhone)).toHaveLength(0);
		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { push_notifications: true },
		});
	});

	test("the test push goes to all own devices, even while in the app", async () => {
		const active = fakeConnection(ben.id, true);
		RealtimeHub.add(active);
		const result = await makeAPIRequest("/v1/push/test", {
			method: "POST",
			authToken: benSession.token,
		});
		await PushService.flush();
		expect(result.devices).toBeGreaterThanOrEqual(1);
		expect(deliveredTo(benPhone)[0]?.payload.kind).toBe("test");
		RealtimeHub.remove(active);
	});

	test("gone subscriptions are deleted, failing ones after repeated failures", async () => {
		const gone = newDevice();
		const flaky = newDevice();
		await register(benSession.token, gone);
		await register(benSession.token, flaky);
		answers.set(gone.endpoint, 410);
		answers.set(flaky.endpoint, 503);

		await sendMessage(annaSession.token, chatId, "Wer ist noch da?");
		const rows = () =>
			DB.instance()
				.select()
				.from(DB.Tables.pushSubscriptions)
				.where(eq(DB.Tables.pushSubscriptions.user_id, ben.id))
				.all();
		expect(rows().some((row) => row.endpoint === gone.endpoint)).toBe(false);
		expect(rows().find((row) => row.endpoint === flaky.endpoint)?.failure_count).toBe(1);
		expect(rows().find((row) => row.endpoint === benPhone.endpoint)?.last_success_at).toBeNumber();

		for (let i = 1; i < PushService.MAX_FAILURES; i++) {
			await sendMessage(annaSession.token, chatId, `Versuch ${i}`);
		}
		expect(rows().some((row) => row.endpoint === flaky.endpoint)).toBe(false);
	});

	test("the HTTP transport doesn't follow redirects", async () => {
		let followed = false;
		const target = Bun.serve({
			port: 0,
			fetch() {
				followed = true;
				return new Response("ok");
			},
		});
		const redirector = Bun.serve({
			port: 0,
			fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/internal`, 307),
		});
		try {
			const result = await PushService.httpTransport({
				endpoint: `http://127.0.0.1:${redirector.port}/send`,
				headers: {},
				body: Buffer.from("x"),
			});
			expect(result.status).toBe(307);
			expect(followed).toBe(false);
		} finally {
			redirector.stop(true);
			target.stop(true);
		}
	});
});

describe("Other orgs", () => {
	let otherOrg: OrgInfo;

	beforeAll(async () => {
		otherOrg = await OrgService.create({
			slug: `push-${randomUUID().slice(0, 8)}`,
			display_name: "Push-Fremdorg",
		});
	});

	test("subscriptions and pushes stay in their org", async () => {
		const stranger = await OrgContext.run(otherOrg, () => seedUser("volunteer"));
		const strangerSession = await OrgContext.run(otherOrg, () => seedSession(stranger.id));
		const device = newDevice();
		const host = `${otherOrg.slug}.localhost`;
		const created = await makeAPIRequest("/v1/push/subscriptions", {
			method: "POST",
			authToken: strangerSession.token,
			body: { endpoint: device.endpoint, keys: device.keys },
			additionalOptions: { headers: hostHeaders(host) },
		});

		// Invisible and untouchable from this org.
		await makeAPIRequest(
			`/v1/push/subscriptions/${created.id}`,
			{ method: "DELETE", authToken: annaSession.token },
			404,
		);
		await sendMessage(annaSession.token, chatId, "Nur für uns");
		expect(deliveredTo(device)).toHaveLength(0);
	});
});

describe("Presence settings", () => {
	async function connect(token: string) {
		const { ticket } = await makeAPIRequest("/v1/realtime/ticket", {
			method: "POST",
			authToken: token,
		});
		const request = {
			url: `http://test.localhost${RealtimeLimits.PATH}?ticket=${ticket}`,
			headers: new Headers(hostHeaders("test.localhost")),
			context: {} as Record<string, unknown>,
		};
		expect(await RealtimeGateway.upgrade(request)).toBeUndefined();
		const received: RealtimeProtocol.ServerEvent[] = [];
		const peer = {
			id: randomUUID(),
			context: request.context,
			send: (data: string) => {
				received.push(JSON.parse(data));
			},
			close: () => RealtimeGateway.close(peer),
		};
		RealtimeGateway.open(peer);
		return { peer, received };
	}

	test("defaults, partial updates", async () => {
		const settings = await makeAPIRequest("/v1/account/preferences/notifications", {
			authToken: coreSession.token,
		});
		expect(settings).toEqual({
			push_messages: true,
			push_notifications: true,
			push_preview: true,
			share_presence: true,
		});
		const updated = await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: coreSession.token,
			body: { push_preview: false },
		});
		expect(updated).toMatchObject({ push_preview: false, push_messages: true });
		await makeAPIRequest(
			"/v1/account/preferences/notifications",
			{ method: "PUT", authToken: coreSession.token, body: { push_preview: "nein" } },
			400,
		);
	});

	test("last seen is stored and shown — unless the person hides it", async () => {
		const ben1 = await connect(benSession.token);
		ben1.peer.close();
		const members = await makeAPIRequest(`/v1/conversations/${chatId}/members`, {
			authToken: annaSession.token,
		});
		const benEntry = members.find((member: any) => member.user.id === ben.id);
		expect(benEntry.last_seen_at).toBeGreaterThan(Date.now() - 60_000);

		// Hidden: not online for others, no last seen.
		const anna1 = await connect(annaSession.token);
		const ben2 = await connect(benSession.token);
		expect(
			anna1.received.some((event) => event.type === "presence" && event.user_id === ben.id),
		).toBe(true);
		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { share_presence: false },
		});
		expect(anna1.received.at(-1)).toEqual({ type: "presence", user_id: ben.id, online: false });
		const anna2 = await connect(annaSession.token);
		const hello = anna2.received.find((event) => event.type === "hello");
		expect(hello?.type === "hello" && hello.online_user_ids.includes(ben.id)).toBe(false);

		const hidden = await makeAPIRequest(`/v1/conversations/${chatId}/members`, {
			authToken: annaSession.token,
		});
		expect(hidden.find((member: any) => member.user.id === ben.id).last_seen_at).toBeNull();

		// Going offline while hidden announces nothing.
		const before = anna1.received.length;
		ben2.peer.close();
		expect(anna1.received.length).toBe(before);

		await makeAPIRequest("/v1/account/preferences/notifications", {
			method: "PUT",
			authToken: benSession.token,
			body: { share_presence: true },
		});
		anna1.peer.close();
		anna2.peer.close();
	});

	test("activity reported over the socket holds pushes back", async () => {
		const benSocket = await connect(benSession.token);
		await RealtimeGateway.message(benSocket.peer, JSON.stringify({ type: "activity", active: true }));
		expect(RealtimeHub.isActive(OrgContext.id(), ben.id)).toBe(true);
		await RealtimeGateway.message(
			benSocket.peer,
			JSON.stringify({ type: "activity", active: false }),
		);
		expect(RealtimeHub.isActive(OrgContext.id(), ben.id)).toBe(false);
		benSocket.peer.close();
	});
});
