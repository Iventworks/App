/**
 * Chat features beyond plain text: attachments, replies, reactions, pinned messages, search,
 * member lists, read receipts and the per-person chat settings (pinned, muted).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { EMOJI_GROUPS, QUICK_REACTIONS } from "../app/utils/chat";
import { API } from "../server/lib/api";
import { MessageService } from "../server/lib/api/utils/messages";
import { MessagesModel } from "../server/lib/api/versions/v1/routes/conversations/messages/model";
import { ConversationsModel } from "../server/lib/api/versions/v1/routes/conversations/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { FileStorage } from "../server/lib/utils/fileStorage";
import { TimeUtils } from "../server/lib/utils/time";
import { makeAPIRequest } from "./helpers/api";
import { hostHeaders, TEST_HOST } from "./helpers/orgs";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let core: SeededUser;
let alice: SeededUser;
let bob: SeededUser;
let carol: SeededUser;

let coreSession: SeededSession;
let aliceSession: SeededSession;
let bobSession: SeededSession;
let carolSession: SeededSession;

/** Group chat of Alice and Bob (Carol is never in it). */
let chatId: number;
let eventId: number;
let eventGroupId: number;

const today = TimeUtils.today();

async function send(
	token: string,
	conversationId: number,
	body: { content?: string; attachment_ids?: number[]; reply_to_id?: number | null },
) {
	return await makeAPIRequest(
		`/v1/conversations/${conversationId}/messages`,
		{ method: "POST", authToken: token, body, expectedBodySchema: MessagesModel.Create.Response },
		201,
	);
}

async function upload(
	token: string,
	conversationId: number,
	name: string,
	content: BlobPart,
	type = "text/plain",
	expectedCode = 201,
) {
	const form = new FormData();
	form.append("file", new File([content], name, { type }));
	return await makeAPIRequest(
		`/v1/conversations/${conversationId}/attachments`,
		{ authToken: token, additionalOptions: { method: "POST", body: form } },
		expectedCode,
	);
}

async function sync(token: string, conversationId: number, after: number, since = 0, from = 0) {
	return await makeAPIRequest(
		`/v1/conversations/${conversationId}/messages/sync?after=${after}&since=${since}&from=${from}`,
		{ authToken: token, expectedBodySchema: MessagesModel.Sync.Response },
	);
}

async function listChats(token: string) {
	return await makeAPIRequest("/v1/conversations", {
		authToken: token,
		expectedBodySchema: ConversationsModel.GetAll.Response,
	});
}

/** A file's contents by its `content_url`, with the bearer token. */
async function content(token: string, contentUrl: string) {
	return await API.getApp().request(contentUrl.replace("/api", ""), {
		headers: { ...hostHeaders(TEST_HOST), Authorization: `Bearer ${token}` },
	});
}

beforeAll(async () => {
	core = await seedUser("core_team", { display_name: "Kira Kraus" });
	alice = await seedUser("volunteer", { display_name: "Anna Albrecht" });
	bob = await seedUser("volunteer", { display_name: "Ben Brandt" });
	carol = await seedUser("volunteer", { display_name: "Cora Christ" });

	coreSession = await seedSession(core.id);
	aliceSession = await seedSession(alice.id);
	bobSession = await seedSession(bob.id);
	carolSession = await seedSession(carol.id);

	const chat = await makeAPIRequest(
		"/v1/conversations",
		{
			method: "POST",
			authToken: aliceSession.token,
			body: { type: "group", name: "Planung", user_ids: [bob.id] },
			expectedBodySchema: ConversationsModel.Create.Response,
		},
		201,
	);
	chatId = chat.id;

	const event = await makeAPIRequest(
		"/v1/events",
		{
			method: "POST",
			authToken: coreSession.token,
			body: {
				name: "Chat-Freizeit",
				start_date: TimeUtils.addDays(today, 5),
				end_date: TimeUtils.addDays(today, 9),
				leader_ids: [alice.id],
			},
		},
		201,
	);
	eventId = event.id;
	const membership = await addEventMember(eventId, bob.id, "staff");
	DB.instance()
		.update(DB.Tables.eventMembers)
		.set({ position: "Küche" })
		.where(eq(DB.Tables.eventMembers.id, membership.id))
		.run();

	const group = DB.instance()
		.insert(DB.Tables.eventGroups)
		.values({ org_id: OrgContext.id(), event_id: eventId, name: "Musikteam" })
		.returning()
		.get();
	eventGroupId = group.id;
	DB.instance()
		.insert(DB.Tables.eventGroupMembers)
		.values({ org_id: OrgContext.id(), group_id: group.id, user_id: bob.id })
		.run();
});

describe("Attachments", () => {
	test("an upload is private until it is sent, then everyone in the chat can open it", async () => {
		const attachment = await upload(aliceSession.token, chatId, "Packliste.txt", "Zelt, Schlafsack");
		expect(attachment.name).toBe("Packliste.txt");
		expect(attachment.is_image).toBe(false);
		expect(attachment.content_url).toBeString();

		// Not sent yet: only the uploader.
		expect((await content(aliceSession.token, attachment.content_url)).status).toBe(200);
		expect((await content(bobSession.token, attachment.content_url)).status).toBe(403);

		// Nobody else can send it.
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{ method: "POST", authToken: bobSession.token, body: { attachment_ids: [attachment.id] } },
			400,
		);

		const message = await send(aliceSession.token, chatId, {
			content: "Hier die Liste",
			attachment_ids: [attachment.id],
		});
		expect(message.attachments).toHaveLength(1);
		expect(message.attachments[0]!.id).toBe(attachment.id);

		const forBob = await content(bobSession.token, attachment.content_url);
		expect(forBob.status).toBe(200);
		expect(await forBob.text()).toBe("Zelt, Schlafsack");
		// Carol is not in the chat.
		expect((await content(carolSession.token, attachment.content_url)).status).toBe(403);

		// An attachment belongs to one message.
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{ method: "POST", authToken: aliceSession.token, body: { attachment_ids: [attachment.id] } },
			400,
		);

		// The chat list previews it.
		const listed = (await listChats(bobSession.token)).find((entry) => entry.id === chatId)!;
		expect(listed.last_message?.attachment_count).toBe(1);
		expect(listed.last_message?.attachment_name).toBe("Packliste.txt");
	});

	test("a message can consist of attachments only, but never of nothing", async () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const image = await upload(aliceSession.token, chatId, "Lageplan.png", png, "image/png");
		expect(image.is_image).toBe(true);

		const message = await send(aliceSession.token, chatId, { attachment_ids: [image.id] });
		expect(message.content).toBe("");
		expect(message.attachments[0]!.is_image).toBe(true);

		const listed = (await listChats(bobSession.token)).find((entry) => entry.id === chatId)!;
		expect(listed.last_message?.content).toBe("");
		expect(listed.last_message?.attachment_is_image).toBe(true);

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{ method: "POST", authToken: aliceSession.token, body: { content: "   " } },
			400,
		);
		// The text of an attachment-only message may stay empty, a text message's may not.
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${message.id}`,
			{ method: "PUT", authToken: aliceSession.token, body: { content: "" } },
			200,
		);
		const text = await send(aliceSession.token, chatId, { content: "Nur Text" });
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${text.id}`,
			{ method: "PUT", authToken: aliceSession.token, body: { content: "" } },
			400,
		);
	});

	test("SVG and HTML attachments are downloads, never rendered", async () => {
		const svg = await upload(
			aliceSession.token,
			chatId,
			"logo.svg",
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			"image/svg+xml",
		);
		expect(svg.is_image).toBe(false);
		const response = await content(aliceSession.token, svg.content_url);
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect(response.headers.get("content-disposition")).toStartWith("attachment");
	});

	test("unsent uploads can be discarded by their uploader only", async () => {
		const attachment = await upload(aliceSession.token, chatId, "Entwurf.txt", "noch nicht fertig");

		await makeAPIRequest(
			`/v1/conversations/${chatId}/attachments/${attachment.id}`,
			{ method: "DELETE", authToken: bobSession.token },
			404,
		);
		await makeAPIRequest(
			`/v1/conversations/${chatId}/attachments/${attachment.id}`,
			{ method: "DELETE", authToken: aliceSession.token },
			200,
		);
		expect((await content(aliceSession.token, attachment.content_url)).status).toBe(404);

		// A sent attachment cannot be discarded any more.
		const sent = await upload(aliceSession.token, chatId, "Fertig.txt", "fertig");
		await send(aliceSession.token, chatId, { attachment_ids: [sent.id] });
		await makeAPIRequest(
			`/v1/conversations/${chatId}/attachments/${sent.id}`,
			{ method: "DELETE", authToken: aliceSession.token },
			404,
		);
	});

	test("attachments are not documents: no rename, delete or share link through the file routes", async () => {
		const attachment = await upload(aliceSession.token, chatId, "Fest.txt", "bleibt");
		await send(aliceSession.token, chatId, { attachment_ids: [attachment.id] });

		// Not even for the uploader; the core team (not in the chat) cannot see it at all.
		await makeAPIRequest(
			`/v1/files/${attachment.id}`,
			{ method: "PUT", authToken: aliceSession.token, body: { name: "Anders.txt" } },
			403,
		);
		await makeAPIRequest(
			`/v1/files/${attachment.id}`,
			{ method: "DELETE", authToken: aliceSession.token },
			403,
		);
		await makeAPIRequest(`/v1/files/${attachment.id}`, { authToken: coreSession.token }, 403);
		await makeAPIRequest(
			`/v1/files/${attachment.id}/shares`,
			{ method: "POST", authToken: aliceSession.token, body: {} },
			403,
		);
		// Nor do they show up among the organisation's documents.
		const documents = await makeAPIRequest("/v1/org/documents", { authToken: coreSession.token });
		expect(documents.items.some((item: any) => item.id === attachment.id)).toBe(false);
	});

	test("deleting a message removes its attachments", async () => {
		const attachment = await upload(aliceSession.token, chatId, "Weg.txt", "wird gelöscht");
		const message = await send(aliceSession.token, chatId, { attachment_ids: [attachment.id] });
		const row = DB.instance()
			.select()
			.from(DB.Tables.files)
			.where(eq(DB.Tables.files.id, attachment.id))
			.get()!;
		expect(await FileStorage.open(row.storage_key!).exists()).toBe(true);

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${message.id}`,
			{ method: "DELETE", authToken: aliceSession.token },
			200,
		);

		expect((await content(aliceSession.token, attachment.content_url)).status).toBe(404);
		expect(await FileStorage.open(row.storage_key!).exists()).toBe(false);
	});

	test("an upload needs access to the chat and respects the size limit", async () => {
		await upload(carolSession.token, chatId, "fremd.txt", "nope", "text/plain", 403);
		// The test config allows 5 MB per file.
		await upload(
			aliceSession.token,
			chatId,
			"riesig.bin",
			new Uint8Array(5 * 1024 * 1024 + 1),
			"application/octet-stream",
			400,
		);
	});

	test("housekeeping removes uploads that were never sent", async () => {
		const attachment = await upload(aliceSession.token, chatId, "Vergessen.txt", "liegen gelassen");
		const { Housekeeping } = await import("../server/lib/utils/housekeeping");

		// Still within the grace period.
		await Housekeeping.run(Date.now());
		expect((await content(aliceSession.token, attachment.content_url)).status).toBe(200);

		const result = await Housekeeping.run(Date.now() + 2 * 86_400_000);
		expect(result.unsentAttachments).toBeGreaterThanOrEqual(1);
		expect((await content(aliceSession.token, attachment.content_url)).status).toBe(404);
	});

	test("deleting an event takes its channel's messages and attachments along", async () => {
		const temp = await makeAPIRequest(
			"/v1/events",
			{
				method: "POST",
				authToken: coreSession.token,
				body: {
					name: "Kurzes Event",
					start_date: TimeUtils.addDays(today, 20),
					end_date: TimeUtils.addDays(today, 21),
					leader_ids: [alice.id],
				},
			},
			201,
		);
		const channel = (await listChats(aliceSession.token)).find(
			(entry) => entry.type === "event" && entry.event?.id === temp.id,
		)!;
		const attachment = await upload(aliceSession.token, channel.id, "Ablauf.txt", "Plan");
		const first = await send(aliceSession.token, channel.id, { attachment_ids: [attachment.id] });
		const reply = await send(aliceSession.token, channel.id, {
			content: "dazu",
			reply_to_id: first.id,
		});
		await makeAPIRequest(
			`/v1/conversations/${channel.id}/messages/${reply.id}/reactions`,
			{ method: "POST", authToken: aliceSession.token, body: { emoji: "👍" } },
			200,
		);

		await makeAPIRequest(`/v1/events/${temp.id}`, { method: "DELETE", authToken: coreSession.token });

		const db = DB.instance();
		expect(
			db
				.select()
				.from(DB.Tables.conversations)
				.where(eq(DB.Tables.conversations.id, channel.id))
				.all(),
		).toHaveLength(0);
		expect(
			db.select().from(DB.Tables.files).where(eq(DB.Tables.files.id, attachment.id)).all(),
		).toHaveLength(0);
		expect(
			db
				.select()
				.from(DB.Tables.messageReactions)
				.where(eq(DB.Tables.messageReactions.message_id, reply.id))
				.all(),
		).toHaveLength(0);
	});
});

describe("Replies", () => {
	test("a reply quotes the message it answers", async () => {
		const original = await send(bobSession.token, chatId, { content: "Wer bringt den Grill mit?" });
		const reply = await send(aliceSession.token, chatId, {
			content: "Ich!",
			reply_to_id: original.id,
		});

		expect(reply.reply_to).toEqual({
			id: original.id,
			content: "Wer bringt den Grill mit?",
			sender_name: "Ben Brandt",
			is_deleted: false,
			attachment_count: 0,
		});

		// Once the original is deleted the quote says so instead of keeping its text.
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${original.id}`,
			{ method: "DELETE", authToken: bobSession.token },
			200,
		);
		const page = await makeAPIRequest(`/v1/conversations/${chatId}/messages?limit=100`, {
			authToken: aliceSession.token,
			expectedBodySchema: MessagesModel.GetAll.Response,
		});
		const reloaded = page.find((message) => message.id === reply.id)!;
		expect(reloaded.reply_to?.is_deleted).toBe(true);
		expect(reloaded.reply_to?.content).toBe("");
	});

	test("only messages of the same chat can be answered", async () => {
		const other = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "direct", user_ids: [carol.id] },
			},
			201,
		);
		const elsewhere = await send(aliceSession.token, other.id, { content: "Anderer Chat" });

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { content: "Antwort", reply_to_id: elsewhere.id },
			},
			400,
		);
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages`,
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { content: "Antwort", reply_to_id: 99_999_999 },
			},
			400,
		);
	});
});

describe("Reactions", () => {
	test("toggle, counts and who reacted", async () => {
		const message = await send(aliceSession.token, chatId, { content: "Treffen um 18 Uhr" });
		const react = async (token: string, emoji: string, expectedCode = 200) =>
			await makeAPIRequest(
				`/v1/conversations/${chatId}/messages/${message.id}/reactions`,
				{ method: "POST", authToken: token, body: { emoji } },
				expectedCode,
			);

		await react(bobSession.token, "👍");
		const twice = MessagesModel.Message.parse(await react(aliceSession.token, "👍"));
		expect(twice.reactions).toHaveLength(1);
		expect(twice.reactions[0]).toMatchObject({ emoji: "👍", count: 2, reacted_by_me: true });
		expect(twice.reactions[0]!.users.map((user) => user.display_name).sort()).toEqual([
			"Anna Albrecht",
			"Ben Brandt",
		]);

		const second = MessagesModel.Message.parse(await react(bobSession.token, "🎉"));
		expect(second.reactions.map((reaction) => reaction.emoji)).toEqual(["👍", "🎉"]);

		// The same emoji again takes the reaction back.
		const removed = MessagesModel.Message.parse(await react(bobSession.token, "👍"));
		expect(removed.reactions.find((reaction) => reaction.emoji === "👍")).toMatchObject({
			count: 1,
			reacted_by_me: false,
		});

		// Flags and emoji with modifiers are fine; text is not.
		await react(aliceSession.token, "🇩🇪");
		await react(aliceSession.token, "👍🏽");
		await react(aliceSession.token, "ok", 400);
		await react(aliceSession.token, "1", 400);
		await react(aliceSession.token, "<b>", 400);
		// Not in the chat.
		await react(carolSession.token, "👍", 403);
	});

	test("every emoji the app offers is accepted", () => {
		const offered = [...QUICK_REACTIONS, ...EMOJI_GROUPS.flatMap((group) => group.emojis)];
		expect(offered.length).toBeGreaterThan(100);
		const rejected = offered.filter((emoji) => !MessageService.Emoji.safeParse(emoji).success);
		expect(rejected).toEqual([]);
	});

	test("the other person's open chat learns about reactions through sync", async () => {
		const message = await send(aliceSession.token, chatId, { content: "Sync-Reaktion" });
		const before = await sync(aliceSession.token, chatId, message.id);
		expect(before.updated.some((entry) => entry.id === message.id)).toBe(false);

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${message.id}/reactions`,
			{ method: "POST", authToken: bobSession.token, body: { emoji: "❤️" } },
			200,
		);

		const after = await sync(aliceSession.token, chatId, message.id, before.server_time);
		const updated = after.updated.find((entry) => entry.id === message.id)!;
		expect(updated.reactions[0]).toMatchObject({ emoji: "❤️", count: 1, reacted_by_me: false });

		// `from` leaves out changes of messages the client has not loaded.
		const narrowed = await sync(
			aliceSession.token,
			chatId,
			message.id,
			before.server_time,
			message.id + 1,
		);
		expect(narrowed.updated).toHaveLength(0);
	});
});

describe("Pinned messages", () => {
	test("anyone in the chat pins and unpins; deleted messages drop out", async () => {
		const first = await send(aliceSession.token, chatId, { content: "Adresse: Waldweg 3" });
		const second = await send(bobSession.token, chatId, { content: "Abfahrt 8:00" });

		const pinned = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${first.id}/pin`,
			{ method: "PUT", authToken: bobSession.token, expectedBodySchema: MessagesModel.Pin.Response },
			200,
		);
		expect(pinned.pinned_at).toBeNumber();
		expect(pinned.pinned_by?.display_name).toBe("Ben Brandt");
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${second.id}/pin`,
			{ method: "PUT", authToken: aliceSession.token },
			200,
		);
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${first.id}/pin`,
			{ method: "PUT", authToken: carolSession.token },
			403,
		);

		const list = await makeAPIRequest(`/v1/conversations/${chatId}/messages/pinned`, {
			authToken: aliceSession.token,
			expectedBodySchema: MessagesModel.Pinned.Response,
		});
		// The latest pin first.
		expect(list.map((message) => message.id)).toEqual([second.id, first.id]);

		const synced = await sync(aliceSession.token, chatId, second.id);
		expect(synced.pinned_ids.sort()).toEqual([first.id, second.id].sort());

		const unpinned = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${first.id}/pin`,
			{
				method: "DELETE",
				authToken: aliceSession.token,
				expectedBodySchema: MessagesModel.Pin.Response,
			},
			200,
		);
		expect(unpinned.pinned_at).toBeNull();

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${second.id}`,
			{ method: "DELETE", authToken: bobSession.token },
			200,
		);
		expect((await sync(aliceSession.token, chatId, second.id)).pinned_ids).toEqual([]);
	});
});

describe("Search", () => {
	let directId: number;

	beforeAll(async () => {
		const direct = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "direct", user_ids: [carol.id] },
			},
			200,
		);
		directId = direct.id;
		await send(aliceSession.token, chatId, { content: "Der Bus fährt am Bahnhof ab" });
		await send(bobSession.token, chatId, { content: "100% sicher? Bahnhof_Nord oder Süd?" });
		await send(aliceSession.token, directId, { content: "Carol, kommst du zum Bahnhof?" });
		const attachment = await upload(aliceSession.token, chatId, "Fahrplan-Bahnhof.txt", "8:00");
		await send(aliceSession.token, chatId, { attachment_ids: [attachment.id] });
	});

	test("within one chat, text and attachment names, newest first", async () => {
		const hits = await makeAPIRequest(`/v1/conversations/${chatId}/messages/search?q=bahnhof`, {
			authToken: bobSession.token,
			expectedBodySchema: MessagesModel.Search.Response,
		});
		expect(hits).toHaveLength(3);
		expect(hits[0]!.attachments[0]?.name).toBe("Fahrplan-Bahnhof.txt");
		expect(hits.map((hit) => hit.id)).toEqual([...hits.map((hit) => hit.id)].sort((a, b) => b - a));

		// Paging with `before`.
		const next = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/search?q=bahnhof&limit=1&before=${hits[0]!.id}`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Search.Response },
		);
		expect(next.map((hit) => hit.id)).toEqual([hits[1]!.id]);

		// `%` and `_` are literal characters, not wildcards.
		const percent = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/search?q=${encodeURIComponent("100%")}`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Search.Response },
		);
		expect(percent).toHaveLength(1);
		const underscore = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/search?q=${encodeURIComponent("Bahnhof_S")}`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Search.Response },
		);
		expect(underscore).toHaveLength(0);

		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/search?q=x`,
			{ authToken: bobSession.token },
			400,
		);
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/search?q=bahnhof`,
			{ authToken: carolSession.token },
			403,
		);
	});

	test("across all chats, only the caller's own", async () => {
		const forAlice = await makeAPIRequest("/v1/conversations/search?q=bahnhof", {
			authToken: aliceSession.token,
			expectedBodySchema: ConversationsModel.Search.Response,
		});
		expect(new Set(forAlice.map((hit) => hit.conversation.id))).toEqual(new Set([chatId, directId]));
		expect(forAlice.find((hit) => hit.conversation.id === directId)?.conversation.title).toBe(
			"Cora Christ",
		);

		const forCarol = await makeAPIRequest("/v1/conversations/search?q=bahnhof", {
			authToken: carolSession.token,
			expectedBodySchema: ConversationsModel.Search.Response,
		});
		expect(forCarol.map((hit) => hit.conversation.id)).toEqual([directId]);

		// Deleted messages are not found.
		const secret = await send(aliceSession.token, chatId, { content: "Geheimwort Zitronenfalter" });
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${secret.id}`,
			{ method: "DELETE", authToken: aliceSession.token },
			200,
		);
		const gone = await makeAPIRequest("/v1/conversations/search?q=Zitronenfalter", {
			authToken: bobSession.token,
			expectedBodySchema: ConversationsModel.Search.Response,
		});
		expect(gone).toHaveLength(0);
	});

	test("`around` loads the page around a hit", async () => {
		const ids: number[] = [];
		for (let i = 0; i < 12; i++) {
			ids.push((await send(aliceSession.token, chatId, { content: `Verlauf ${i}` })).id);
		}
		const target = ids[5]!;
		const page = await makeAPIRequest(
			`/v1/conversations/${chatId}/messages?around=${target}&limit=6`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.GetAll.Response },
		);
		expect(page.map((message) => message.id)).toEqual(ids.slice(3, 9));
	});
});

describe("Members", () => {
	async function members(token: string, conversationId: number) {
		return await makeAPIRequest(`/v1/conversations/${conversationId}/members`, {
			authToken: token,
			expectedBodySchema: ConversationsModel.Members.Response,
		});
	}

	test("every type of chat lists its people", async () => {
		const chats = await listChats(bobSession.token);

		const group = await members(bobSession.token, chatId);
		expect(group.map((member) => member.user.display_name)).toEqual(["Anna Albrecht", "Ben Brandt"]);

		// Event channel: leaders first, with role and function.
		const eventChannel = chats.find(
			(entry) => entry.type === "event" && entry.event?.id === eventId,
		)!;
		expect(eventChannel.member_count).toBe(2);
		const staff = await members(bobSession.token, eventChannel.id);
		expect(
			staff.map((member) => [member.user.display_name, member.event_role, member.position]),
		).toEqual([
			["Anna Albrecht", "leader", null],
			["Ben Brandt", "staff", "Küche"],
		]);

		const groupChannel = chats.find(
			(entry) => entry.type === "event_group" && entry.group?.id === eventGroupId,
		)!;
		expect(groupChannel.member_count).toBe(1);
		const musicians = await members(bobSession.token, groupChannel.id);
		expect(musicians.map((member) => member.user.display_name)).toEqual(["Ben Brandt"]);
		expect(musicians[0]!.event_role).toBe("staff");

		const coreChannel = (await listChats(coreSession.token)).find(
			(entry) => entry.type === "core_team",
		)!;
		const coreTeam = await members(coreSession.token, coreChannel.id);
		expect(coreTeam.some((member) => member.user.id === core.id)).toBe(true);
		expect(coreTeam.every((member) => ["core_team", "admin"].includes(member.user.role))).toBe(true);
		expect(coreChannel.member_count).toBe(coreTeam.length);

		await makeAPIRequest(
			`/v1/conversations/${chatId}/members`,
			{ authToken: carolSession.token },
			403,
		);
	});

	test("read markers show who has read how far", async () => {
		const message = await send(aliceSession.token, chatId, { content: "Bitte lesen" });

		const unread = await sync(aliceSession.token, chatId, message.id);
		expect(unread.read_by_all_until).toBeLessThan(message.created_at);

		await makeAPIRequest(`/v1/conversations/${chatId}/read`, {
			method: "POST",
			authToken: bobSession.token,
		});
		const read = await sync(aliceSession.token, chatId, message.id);
		expect(read.read_by_all_until).toBeGreaterThanOrEqual(message.created_at);

		const list = await members(aliceSession.token, chatId);
		expect(list.find((member) => member.user.id === bob.id)?.last_read_at).toBeGreaterThanOrEqual(
			message.created_at,
		);

		// A chat nobody else is in has nobody to read it.
		const lonely = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "group", name: "Bald allein", user_ids: [bob.id] },
			},
			201,
		);
		await makeAPIRequest(`/v1/conversations/${lonely.id}/membership`, {
			method: "DELETE",
			authToken: bobSession.token,
		});
		const note = await send(aliceSession.token, lonely.id, { content: "Hallo?" });
		expect((await sync(aliceSession.token, lonely.id, note.id)).read_by_all_until).toBe(0);
	});
});

describe("Chat settings", () => {
	test("pinned chats sort first, muted chats leave the unread total", async () => {
		const quiet = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "group", name: "Leise", user_ids: [bob.id] },
				expectedBodySchema: ConversationsModel.Create.Response,
			},
			201,
		);
		expect(quiet.pinned_at).toBeNull();
		expect(quiet.muted).toBe(false);

		const pinned = await makeAPIRequest(`/v1/conversations/${quiet.id}/preferences`, {
			method: "PUT",
			authToken: bobSession.token,
			body: { pinned: true },
			expectedBodySchema: ConversationsModel.Preferences.Response,
		});
		expect(pinned.pinned_at).toBeNumber();
		// Still a member after the settings row was written.
		expect(pinned.members.map((member) => member.id).sort()).toEqual([alice.id, bob.id].sort());

		// Newer activity elsewhere doesn't push the pinned chat down.
		await send(aliceSession.token, chatId, { content: "Neuer als der angeheftete Chat" });
		expect((await listChats(bobSession.token))[0]!.id).toBe(quiet.id);
		// It is Bob's setting only.
		expect(
			(await listChats(aliceSession.token)).find((entry) => entry.id === quiet.id)?.pinned_at,
		).toBeNull();

		const unreadTotal = async () =>
			(
				await makeAPIRequest("/v1/conversations/unread", {
					authToken: bobSession.token,
					expectedBodySchema: ConversationsModel.Unread.Response,
				})
			).total;

		const before = await unreadTotal();
		await send(aliceSession.token, quiet.id, { content: "Eins" });
		await send(aliceSession.token, quiet.id, { content: "Zwei" });
		expect(await unreadTotal()).toBe(before + 2);

		await makeAPIRequest(`/v1/conversations/${quiet.id}/preferences`, {
			method: "PUT",
			authToken: bobSession.token,
			body: { muted: true },
		});
		expect(await unreadTotal()).toBe(before);
		// The chat itself still knows what is unread.
		const listed = (await listChats(bobSession.token)).find((entry) => entry.id === quiet.id)!;
		expect(listed).toMatchObject({ muted: true, unread_count: 2 });
		expect(listed.pinned_at).toBeNumber();

		await makeAPIRequest(`/v1/conversations/${quiet.id}/preferences`, {
			method: "PUT",
			authToken: bobSession.token,
			body: { pinned: false, muted: false },
		});
		const reset = (await listChats(bobSession.token)).find((entry) => entry.id === quiet.id)!;
		expect(reset).toMatchObject({ pinned_at: null, muted: false });

		await makeAPIRequest(
			`/v1/conversations/${quiet.id}/preferences`,
			{ method: "PUT", authToken: bobSession.token, body: {} },
			400,
		);
		await makeAPIRequest(
			`/v1/conversations/${quiet.id}/preferences`,
			{ method: "PUT", authToken: carolSession.token, body: { pinned: true } },
			403,
		);
	});

	test("settings on a channel never make someone a member", async () => {
		const channel = (await listChats(bobSession.token)).find(
			(entry) => entry.type === "event" && entry.event?.id === eventId,
		)!;
		await makeAPIRequest(`/v1/conversations/${channel.id}/preferences`, {
			method: "PUT",
			authToken: bobSession.token,
			body: { muted: true },
		});
		const row = DB.instance()
			.select()
			.from(DB.Tables.conversationMembers)
			.where(
				and(
					eq(DB.Tables.conversationMembers.conversation_id, channel.id),
					eq(DB.Tables.conversationMembers.user_id, bob.id),
				),
			)
			.get()!;
		expect(row.is_member).toBe(false);
		expect(row.muted).toBe(true);
	});
});

describe("Review fixes", () => {
	test("sync caps the changes it reports and says so", async () => {
		const chat = await makeAPIRequest(
			"/v1/conversations",
			{
				method: "POST",
				authToken: aliceSession.token,
				body: { type: "group", name: "Viel los", user_ids: [bob.id] },
			},
			201,
		);
		// 510 changed messages straight into the database (through the API this would take long).
		const now = Date.now();
		DB.instance()
			.insert(DB.Tables.messages)
			.values(
				Array.from({ length: 510 }, (_, i) => ({
					org_id: OrgContext.id(),
					conversation_id: chat.id,
					sender_id: alice.id,
					content: `Nachricht ${i}`,
					created_at: now - 1000 + i,
					updated_at: now,
				})),
			)
			.run();
		const last = DB.instance()
			.select({ id: DB.Tables.messages.id })
			.from(DB.Tables.messages)
			.where(eq(DB.Tables.messages.conversation_id, chat.id))
			.all()
			.at(-1)!.id;

		const synced = await makeAPIRequest(
			`/v1/conversations/${chat.id}/messages/sync?after=${last}&since=0&from=0`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Sync.Response },
		);
		expect(synced.updated).toHaveLength(500);
		expect(synced.truncated).toBe(true);

		const small = await makeAPIRequest(
			`/v1/conversations/${chat.id}/messages/sync?after=${last}&since=${now + 1}&from=0`,
			{ authToken: bobSession.token, expectedBodySchema: MessagesModel.Sync.Response },
		);
		expect(small.truncated).toBe(false);
	});

	test("the members list gives the read position, not the time someone was active", async () => {
		const message = await send(aliceSession.token, chatId, { content: "Position, nicht Uhrzeit" });
		// Bob reads a little later.
		await Bun.sleep(30);
		await makeAPIRequest(`/v1/conversations/${chatId}/read`, {
			method: "POST",
			authToken: bobSession.token,
		});
		const members = await makeAPIRequest(`/v1/conversations/${chatId}/members`, {
			authToken: aliceSession.token,
			expectedBodySchema: ConversationsModel.Members.Response,
		});
		const bobEntry = members.find((member) => member.user.id === bob.id)!;
		// Exactly the newest message he has seen, not the moment he opened the chat.
		expect(bobEntry.last_read_at).toBe(message.created_at);
	});

	test("a double tap on a reaction doesn't fail", async () => {
		const message = await send(aliceSession.token, chatId, { content: "Doppelt" });
		const path = `/v1/conversations/${chatId}/messages/${message.id}/reactions`;
		const [first, second] = await Promise.all([
			API.getApp().request(path, {
				method: "POST",
				headers: {
					...hostHeaders(TEST_HOST),
					Authorization: `Bearer ${bobSession.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ emoji: "👍" }),
			}),
			API.getApp().request(path, {
				method: "POST",
				headers: {
					...hostHeaders(TEST_HOST),
					Authorization: `Bearer ${bobSession.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ emoji: "👍" }),
			}),
		]);
		expect(first.status).toBeLessThan(500);
		expect(second.status).toBeLessThan(500);
	});

	test("a deleted message is quoted empty, whatever its row still holds", async () => {
		const original = await send(bobSession.token, chatId, { content: "Gleich weg" });
		const reply = await send(aliceSession.token, chatId, {
			content: "Antwort",
			reply_to_id: original.id,
		});
		// A tombstone that still carries text (as a lost race once could leave it).
		DB.instance()
			.update(DB.Tables.messages)
			.set({ deleted_at: Date.now(), content: "Sollte niemand sehen" })
			.where(eq(DB.Tables.messages.id, original.id))
			.run();
		const page = await makeAPIRequest(`/v1/conversations/${chatId}/messages?around=${reply.id}`, {
			authToken: bobSession.token,
			expectedBodySchema: MessagesModel.GetAll.Response,
		});
		const quoted = page.find((message) => message.id === reply.id)!.reply_to!;
		expect(quoted).toMatchObject({ is_deleted: true, content: "" });
		// And nothing can be written to it any more.
		await makeAPIRequest(
			`/v1/conversations/${chatId}/messages/${original.id}/reactions`,
			{ method: "POST", authToken: aliceSession.token, body: { emoji: "👍" } },
			404,
		);
	});
});
