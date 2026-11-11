import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import { DB } from "../db";
import { inOrg, OrgContext } from "../orgs/context";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { WebPushKeys } from "./keys";

/**
 * Web Push: notifications on phones and desktops while the app is closed.
 *
 * The browser subscribes at its push service (Google, Mozilla, Apple, Microsoft) and hands us the
 * endpoint and keys; we encrypt every payload for that browser (RFC 8291, via `web-push`) and POST
 * it to the endpoint, signed with our VAPID key. The push service can't read the payload.
 *
 * Security: the server sends requests to the endpoint, so a stored endpoint must not be able to
 * point anywhere else (SSRF) — only https URLs of known push services are accepted, redirects are
 * not followed, and requests time out. Subscriptions are per org and user; a subscription that the
 * push service reports as gone (404/410) or that keeps failing is deleted.
 *
 * Sending never blocks a request: `send()` queues the delivery and returns.
 */
export class PushService {
	static readonly MAX_SUBSCRIPTIONS_PER_USER = 20;
	static readonly SEND_TIMEOUT_MS = 10_000;
	static readonly CONCURRENCY = 8;
	/** Consecutive failures (not "gone") after which a subscription is dropped. */
	static readonly MAX_FAILURES = 10;
	/** Most queued deliveries (see `send`). */
	static readonly MAX_PENDING = 2_000;
	/** Push services accept at most ~4 KB; stay well below. */
	static readonly MAX_BODY_LENGTH = 300;

	static readonly KNOWN_HOSTS: ReadonlySet<string> = new Set([
		"fcm.googleapis.com",
		"updates.push.services.mozilla.com",
		"push.services.mozilla.com",
		"web.push.apple.com",
	]);
	static readonly KNOWN_HOST_SUFFIXES: readonly string[] = [
		".push.apple.com",
		".notify.windows.com",
	];

	private static transport: PushService.Transport = PushService.httpTransport;
	private static readonly pending = new Set<Promise<void>>();

	// --- subscriptions -------------------------------------------------------------------------

	/** An https URL of a known (or configured) push service. */
	static isAllowedEndpoint(endpoint: string) {
		let url: URL;
		try {
			url = new URL(endpoint);
		} catch {
			return false;
		}
		if (url.protocol !== "https:" || url.username || url.password) return false;
		if (url.port && url.port !== "443") return false;

		const host = url.hostname.toLowerCase();
		const extra = (ConfigHandler.getConfig()?.WEB_PUSH_EXTRA_HOSTS ?? "")
			.split(",")
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean);
		return (
			PushService.KNOWN_HOSTS.has(host) ||
			extra.includes(host) ||
			PushService.KNOWN_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
		);
	}

	/** The browser's keys: an uncompressed P-256 point and a 16-byte secret, base64url. */
	static hasValidKeys(keys: { p256dh: string; auth: string }) {
		try {
			const p256dh = Buffer.from(keys.p256dh, "base64url");
			const auth = Buffer.from(keys.auth, "base64url");
			return p256dh.length === 65 && p256dh[0] === 0x04 && auth.length === 16;
		} catch {
			return false;
		}
	}

	/**
	 * Store (or move to this person and login) a browser's subscription. It lives as long as the
	 * session: logging out, a revoked or an expired session deletes it (`ON DELETE CASCADE`).
	 */
	static subscribe(
		owner: { userId: number; sessionId: string },
		input: PushService.SubscriptionInput,
		label: string | null,
	) {
		const userId = owner.userId;
		const table = DB.Tables.pushSubscriptions;
		const db = DB.instance();

		const existing = db
			.select()
			.from(table)
			.where(and(inOrg(table), eq(table.endpoint, input.endpoint)))
			.get();

		let subscription: DB.Models.PushSubscription;
		if (existing) {
			// The same browser, maybe now signed in as someone else.
			subscription = db
				.update(table)
				.set({
					user_id: userId,
					session_id: owner.sessionId,
					p256dh: input.keys.p256dh,
					auth: input.keys.auth,
					label,
					failure_count: 0,
				})
				.where(and(inOrg(table), eq(table.id, existing.id)))
				.returning()
				.get();
		} else {
			subscription = db
				.insert(table)
				.values({
					org_id: OrgContext.id(),
					user_id: userId,
					session_id: owner.sessionId,
					endpoint: input.endpoint,
					p256dh: input.keys.p256dh,
					auth: input.keys.auth,
					label,
					created_at: Date.now(),
				})
				.returning()
				.get();
		}

		// Bound the devices per person: the oldest go.
		const own = PushService.list(userId);
		const surplus = own.length - PushService.MAX_SUBSCRIPTIONS_PER_USER;
		if (surplus > 0) {
			const oldest = own
				.filter((entry) => entry.id !== subscription.id)
				.sort((a, b) => a.created_at - b.created_at)
				.slice(0, surplus)
				.map((entry) => entry.id);
			PushService.deleteIds(oldest);
		}
		return subscription;
	}

	static list(userId: number) {
		const table = DB.Tables.pushSubscriptions;
		return DB.instance()
			.select()
			.from(table)
			.where(and(inOrg(table), eq(table.user_id, userId)))
			.orderBy(asc(table.created_at))
			.all();
	}

	/** Remove one of the person's subscriptions, by id or by endpoint. True when one was removed. */
	static remove(userId: number, match: { id?: number; endpoint?: string }) {
		const table = DB.Tables.pushSubscriptions;
		if (match.id === undefined && match.endpoint === undefined) return false;
		const removed = DB.instance()
			.delete(table)
			.where(
				and(
					inOrg(table),
					eq(table.user_id, userId),
					match.id !== undefined ? eq(table.id, match.id) : undefined,
					match.endpoint !== undefined ? eq(table.endpoint, match.endpoint) : undefined,
				),
			)
			.returning({ id: table.id })
			.all();
		return removed.length > 0;
	}

	private static deleteIds(ids: number[]) {
		if (ids.length === 0) return;
		const table = DB.Tables.pushSubscriptions;
		DB.instance()
			.delete(table)
			.where(and(inOrg(table), inArray(table.id, ids)))
			.run();
	}

	// --- sending -------------------------------------------------------------------------------

	/**
	 * Queue a push to every device of these people (in the current org). Returns at once; the
	 * deliveries run in the background (`flush()` waits for them).
	 */
	static send(
		userIds: Iterable<number>,
		payload: PushService.Payload,
		options: PushService.SendOptions = {},
	) {
		// A burst must not pile up without bound: beyond this, pushes are dropped (the app loads
		// everything on open anyway).
		if (PushService.pending.size >= PushService.MAX_PENDING) {
			Logger.warn(`Web Push skipped: ${PushService.pending.size} deliveries are already queued`);
			return;
		}
		const ids = [...new Set(userIds)];
		if (ids.length === 0) return;
		const table = DB.Tables.pushSubscriptions;
		const now = Date.now();
		// Only devices of people who may still use the portal, on logins that are still valid:
		// demotion to `unverified`, suspension and expired sessions end the pushes here (the
		// rows follow with the cascade deletes and housekeeping).
		const subscriptions = DB.instance()
			.select({ push: table })
			.from(table)
			.innerJoin(DB.Tables.users, and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, table.user_id)))
			.innerJoin(
				DB.Tables.sessions,
				and(inOrg(DB.Tables.sessions), eq(DB.Tables.sessions.id, table.session_id)),
			)
			.where(
				and(
					inOrg(table),
					inArray(table.user_id, ids),
					isNull(DB.Tables.users.suspended_at),
					inArray(DB.Tables.users.role, ["volunteer", "core_team", "admin"]),
					or(isNull(DB.Tables.sessions.expires_at), gt(DB.Tables.sessions.expires_at, now)),
				),
			)
			.all()
			.map((row) => row.push);
		if (subscriptions.length === 0) return;

		PushService.track(PushService.deliver(subscriptions, PushService.limit(payload), options));
	}

	/** Count background work (triggers, deliveries) so `flush()` can wait for it. */
	static track(work: Promise<unknown>) {
		const job = work.then(
			() => {},
			(error) => Logger.error("Web Push background work failed:", error),
		);
		PushService.pending.add(job);
		void job.finally(() => PushService.pending.delete(job));
		return job;
	}

	/** Wait for queued deliveries (tests, shutdown). */
	static async flush() {
		while (PushService.pending.size > 0) await Promise.all([...PushService.pending]);
	}

	private static limit(payload: PushService.Payload): PushService.Payload {
		const cut = (text: string, max: number) =>
			text.length > max ? `${text.slice(0, max - 1)}…` : text;
		return {
			...payload,
			title: cut(payload.title, 120),
			body: cut(payload.body, PushService.MAX_BODY_LENGTH),
		};
	}

	private static async deliver(
		subscriptions: DB.Models.PushSubscription[],
		payload: PushService.Payload,
		options: PushService.SendOptions,
	) {
		const keys = await WebPushKeys.get();
		const body = JSON.stringify(payload);

		for (let at = 0; at < subscriptions.length; at += PushService.CONCURRENCY) {
			const batch = subscriptions.slice(at, at + PushService.CONCURRENCY);
			await Promise.all(
				batch.map((subscription) => PushService.deliverOne(subscription, body, keys, options)),
			);
		}
	}

	private static async deliverOne(
		subscription: DB.Models.PushSubscription,
		body: string,
		keys: WebPushKeys.Keys,
		options: PushService.SendOptions,
	) {
		const table = DB.Tables.pushSubscriptions;
		// Checked again: the allow-list may have changed since the subscription was stored.
		if (!PushService.isAllowedEndpoint(subscription.endpoint)) {
			PushService.deleteIds([subscription.id]);
			return;
		}

		let status: number;
		try {
			const request = webpush.generateRequestDetails(
				{
					endpoint: subscription.endpoint,
					keys: { p256dh: subscription.p256dh, auth: subscription.auth },
				},
				body,
				{
					vapidDetails: {
						subject: keys.subject,
						publicKey: keys.publicKey,
						privateKey: keys.privateKey,
					},
					TTL: options.ttlSeconds ?? 24 * 60 * 60,
					urgency: options.urgency ?? "normal",
					...(options.topic ? { topic: options.topic } : {}),
				},
			);
			({ status } = await PushService.transport({
				endpoint: request.endpoint,
				headers: request.headers as Record<string, string>,
				body: request.body as Buffer,
			}));
		} catch (error) {
			Logger.warn(`Web Push to subscription ${subscription.id} failed: ${String(error)}`);
			status = 0;
		}

		if (status >= 200 && status < 300) {
			DB.instance()
				.update(table)
				.set({ last_success_at: Date.now(), failure_count: 0 })
				.where(and(inOrg(table), eq(table.id, subscription.id)))
				.run();
			return;
		}
		if (status === 404 || status === 410) {
			// Unsubscribed or expired at the push service.
			PushService.deleteIds([subscription.id]);
			return;
		}
		const updated = DB.instance()
			.update(table)
			.set({ failure_count: sql`${table.failure_count} + 1` })
			.where(and(inOrg(table), eq(table.id, subscription.id)))
			.returning({ failure_count: table.failure_count })
			.get();
		if ((updated?.failure_count ?? 0) >= PushService.MAX_FAILURES)
			PushService.deleteIds([subscription.id]);
	}

	/** POST to the push service; no redirects, with a timeout. */
	static async httpTransport(request: PushService.Request): Promise<{ status: number }> {
		const response = await fetch(request.endpoint, {
			method: "POST",
			headers: request.headers,
			body: new Uint8Array(request.body),
			redirect: "manual",
			signal: AbortSignal.timeout(PushService.SEND_TIMEOUT_MS),
		});
		await response.body?.cancel().catch(() => {});
		return { status: response.status };
	}

	/** Tests: deliver somewhere else (null: back to HTTP). */
	static setTransport(transport: PushService.Transport | null) {
		PushService.transport = transport ?? PushService.httpTransport;
	}
}

export namespace PushService {
	/** What the service worker shows (`public/sw-push.js`). */
	export interface Payload {
		title: string;
		body: string;
		/** In-app path opened by a click. */
		url: string;
		/** Notifications with the same tag replace each other (one per chat). */
		tag?: string;
		kind: "message" | "notification" | "test";
	}

	export interface SendOptions {
		ttlSeconds?: number;
		urgency?: "very-low" | "low" | "normal" | "high";
		/** Undelivered pushes with the same topic replace each other at the push service. */
		topic?: string;
	}

	export interface Request {
		endpoint: string;
		headers: Record<string, string>;
		body: Buffer;
	}

	export type Transport = (request: Request) => Promise<{ status: number }>;

	export const SubscriptionInputSchema = z.object({
		endpoint: z.string().max(2048),
		keys: z.object({
			p256dh: z.string().max(200),
			auth: z.string().max(100),
		}),
	});
	export type SubscriptionInput = z.infer<typeof SubscriptionInputSchema>;
}
