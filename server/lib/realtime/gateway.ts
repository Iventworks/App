import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AuthHandler } from "../api/utils/authHandler";
import { ConversationAccess } from "../api/utils/conversations";
import { PermissionHelper } from "../api/utils/permissions";
import { UserPreferencesHandler } from "../api/utils/preferences";
import { DB } from "../db";
import { inOrg, OrgContext } from "../orgs/context";
import { normalizeHost, OrgRegistry } from "../orgs/registry";
import { Logger } from "../utils/logger";
import { RealtimeHub } from "./hub";
import { RealtimeLimits } from "./limits";
import { RealtimeProtocol } from "./protocol";
import { RealtimeTickets } from "./tickets";

/** What the gateway needs of a socket (crossws' `Peer` has all of it). */
export interface RealtimePeer {
	readonly id: string;
	readonly context: Record<string, unknown>;
	send(data: string): unknown;
	close(code?: number, reason?: string): void;
}

/** What the upgrade hook sees of the request. */
export interface RealtimeUpgradeRequest {
	readonly url: string;
	readonly headers: Headers;
	readonly context: Record<string, unknown>;
}

interface Session {
	orgId: number;
	userId: number;
	role: AuthHandler.AuthenticatedAuthContext["user_role"];
	displayName: string;
	sharePresence: boolean;
	auth: AuthHandler.AuthenticatedAuthContext;
}

const ClientEvent = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ping") }),
	z.object({ type: z.literal("typing"), conversation_id: z.number().int().positive() }),
	z.object({ type: z.literal("activity"), active: z.boolean() }),
]);

/** Remember when people were last connected ("zuletzt online"). */
function touchLastSeen(orgId: number, userIds: number[], at = Date.now()) {
	const org = OrgRegistry.get(orgId);
	if (!org || userIds.length === 0) return;
	try {
		OrgContext.run(org, () =>
			DB.instance()
				.update(DB.Tables.users)
				.set({ last_seen_at: at })
				.where(and(inOrg(DB.Tables.users), inArray(DB.Tables.users.id, userIds)))
				.run(),
		);
	} catch (error) {
		Logger.error("Realtime: failed to store last seen:", error);
	}
}

function reject(status: number, message: string) {
	return new Response(message, { status, headers: { "Content-Type": "text/plain" } });
}

/**
 * The realtime WebSocket (`/ws/realtime`): accepts connections with a ticket, keeps them in the
 * {@link RealtimeHub}, passes typing signals on and announces who is online. The hooks are plain
 * functions of a minimal peer, so the tests drive them without a server.
 *
 * Security:
 * - The org comes from the host, like for the API; the ticket must have been issued in that org.
 * - A browser's `Origin` must be the host itself (no other site opens sockets in a user's name;
 *   the ticket already requires the bearer token, this is a second fence).
 * - Every connection is checked again every minute: a revoked session or API key, a suspended
 *   account or one demoted to `unverified` loses its socket.
 * - Clients may only send pings, typing signals and whether they are active, small and
 *   rate-limited; a typing signal is only passed on to the people of a chat the sender is in.
 * - Presence: people who switched off `share_presence` are never announced online.
 */
export class RealtimeGateway {
	private static revalidateTimer: ReturnType<typeof setInterval> | null = null;

	static readonly hooks = {
		upgrade: (request: RealtimeUpgradeRequest) => RealtimeGateway.upgrade(request),
		open: (peer: RealtimePeer) => RealtimeGateway.open(peer),
		message: (peer: RealtimePeer, message: { text(): string }) =>
			RealtimeGateway.message(peer, message.text()),
		close: (peer: RealtimePeer) => RealtimeGateway.close(peer),
		error: (peer: RealtimePeer) => RealtimeGateway.close(peer),
	};

	/** Accept or refuse the upgrade; on success the session goes into `request.context`. */
	static async upgrade(request: RealtimeUpgradeRequest): Promise<Response | undefined> {
		try {
			const resolution = OrgRegistry.resolveHost(
				OrgRegistry.requestHost(request.headers, request.url),
			);
			if (resolution.kind !== "org") return reject(404, "No organisation for this host");

			const origin = request.headers.get("origin");
			if (origin) {
				let originHost = "";
				try {
					originHost = normalizeHost(new URL(origin).host);
				} catch {}
				if (originHost !== resolution.host) return reject(403, "Origin not allowed");
			}

			const ticket = new URL(request.url, "http://localhost").searchParams.get("ticket") ?? "";
			const entry = RealtimeTickets.redeem(ticket, resolution.org.id);
			if (!entry) return reject(401, "Invalid or expired ticket");

			const current = await OrgContext.run(resolution.org, () =>
				RealtimeGateway.loadSessionState(entry.auth),
			);
			if (!current) return reject(401, "Session no longer valid");
			const preferences = await OrgContext.run(resolution.org, () =>
				UserPreferencesHandler.get(entry.auth.user_id, "notifications"),
			);

			if (
				RealtimeHub.countForUser(resolution.org.id, entry.auth.user_id) >=
				RealtimeLimits.MAX_CONNECTIONS_PER_USER
			) {
				return reject(429, "Too many connections");
			}

			request.context.session = {
				orgId: resolution.org.id,
				userId: entry.auth.user_id,
				role: current.role,
				displayName: current.displayName,
				sharePresence: preferences.share_presence,
				auth: entry.auth,
			} satisfies Session;
			return undefined;
		} catch (error) {
			Logger.error("Realtime upgrade failed:", error);
			return reject(500, "Upgrade failed");
		}
	}

	static open(peer: RealtimePeer) {
		const session = peer.context.session as Session | undefined;
		if (!session) {
			peer.close(RealtimeProtocol.CLOSE_UNAUTHORIZED, "Unauthorized");
			return;
		}

		const connection: RealtimeHub.Connection = {
			id: peer.id || randomUUID(),
			orgId: session.orgId,
			userId: session.userId,
			role: session.role,
			displayName: session.displayName,
			sharePresence: session.sharePresence,
			// Until the client says otherwise: pushes still go out.
			active: false,
			auth: session.auth,
			send: (data) => void peer.send(data),
			close: (code, reason) => peer.close(code, reason),
			recentMessages: [],
			lastTyping: new Map(),
		};
		peer.context.connection = connection;

		const cameOnline = RealtimeHub.add(connection);
		RealtimeHub.send(connection, {
			type: "hello",
			user_id: connection.userId,
			online_user_ids: RealtimeHub.onlineUserIds(connection.orgId),
		});
		if (cameOnline) {
			touchLastSeen(connection.orgId, [connection.userId]);
			if (connection.sharePresence) {
				RealtimeHub.broadcast(
					connection.orgId,
					{ type: "presence", user_id: connection.userId, online: true },
					{ exceptUserId: connection.userId },
				);
			}
		}
		RealtimeGateway.startRevalidation();
	}

	static close(peer: RealtimePeer) {
		const connection = peer.context.connection as RealtimeHub.Connection | undefined;
		if (!connection) return;
		peer.context.connection = undefined;
		if (RealtimeHub.remove(connection)) {
			const now = Date.now();
			touchLastSeen(connection.orgId, [connection.userId], now);
			if (connection.sharePresence) {
				RealtimeHub.broadcast(connection.orgId, {
					type: "presence",
					user_id: connection.userId,
					online: false,
					last_seen_at: now,
				});
			}
		}
	}

	static async message(peer: RealtimePeer, text: string) {
		const connection = peer.context.connection as RealtimeHub.Connection | undefined;
		if (!connection) return;

		const now = Date.now();
		connection.recentMessages = connection.recentMessages.filter(
			(at) => at > now - RealtimeLimits.MESSAGE_WINDOW_MS,
		);
		connection.recentMessages.push(now);
		if (connection.recentMessages.length > RealtimeLimits.MAX_MESSAGES_PER_WINDOW) {
			peer.close(RealtimeProtocol.CLOSE_TOO_MANY_MESSAGES, "Too many messages");
			return;
		}

		if (text.length > RealtimeLimits.MAX_FRAME_BYTES) return;
		let parsed: z.infer<typeof ClientEvent>;
		try {
			const result = ClientEvent.safeParse(JSON.parse(text));
			if (!result.success) return;
			parsed = result.data;
		} catch {
			return;
		}

		if (parsed.type === "ping") {
			RealtimeHub.send(connection, { type: "pong" });
			return;
		}
		if (parsed.type === "activity") {
			connection.active = parsed.active;
			return;
		}
		await RealtimeGateway.typing(connection, parsed.conversation_id, now);
	}

	/** Pass a typing signal on to the other people of the chat — if the sender is in it. */
	static async typing(connection: RealtimeHub.Connection, conversationId: number, now = Date.now()) {
		const last = connection.lastTyping.get(conversationId) ?? 0;
		if (now - last < RealtimeLimits.TYPING_THROTTLE_MS) return;
		connection.lastTyping.set(conversationId, now);

		const org = OrgRegistry.get(connection.orgId);
		if (!org) return;

		try {
			await OrgContext.run(org, () => {
				const conversation = DB.instance()
					.select()
					.from(DB.Tables.conversations)
					.where(and(inOrg(DB.Tables.conversations), eq(DB.Tables.conversations.id, conversationId)))
					.get();
				if (
					!conversation ||
					!ConversationAccess.canAccess(conversation, connection.userId, connection.role)
				) {
					return;
				}
				const members = ConversationAccess.getMembers(conversation).map((member) => member.user_id);
				RealtimeHub.sendToUsers(
					connection.orgId,
					members,
					{
						type: "typing",
						conversation_id: conversationId,
						user: { id: connection.userId, display_name: connection.displayName },
					},
					{ exceptUserId: connection.userId },
				);
			});
		} catch (error) {
			Logger.error("Realtime typing signal failed:", error);
		}
	}

	/**
	 * The current role and name of the person behind a session or API key, or null when it is no
	 * longer valid (revoked, expired, suspended, not activated). Runs inside the org's context.
	 */
	static loadSessionState(auth: AuthHandler.AuthenticatedAuthContext) {
		const db = DB.instance();
		const now = Date.now();

		const token =
			auth.type === "session"
				? db
						.select({ expires_at: DB.Tables.sessions.expires_at })
						.from(DB.Tables.sessions)
						.where(and(inOrg(DB.Tables.sessions), eq(DB.Tables.sessions.id, auth.id)))
						.get()
				: db
						.select({ expires_at: DB.Tables.apiKeys.expires_at })
						.from(DB.Tables.apiKeys)
						.where(and(inOrg(DB.Tables.apiKeys), eq(DB.Tables.apiKeys.id, auth.id)))
						.get();
		if (!token || (token.expires_at !== null && token.expires_at < now)) return null;

		const user = db
			.select({
				role: DB.Tables.users.role,
				display_name: DB.Tables.users.display_name,
				suspended_at: DB.Tables.users.suspended_at,
			})
			.from(DB.Tables.users)
			.where(and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, auth.user_id)))
			.get();
		if (!user || user.suspended_at !== null) return null;
		if (!PermissionHelper.hasOrgRole(user.role, "volunteer")) return null;
		return { role: user.role, displayName: user.display_name };
	}

	/** Check every open connection against its session; close the ones that lost it. */
	static async revalidate() {
		for (const connection of RealtimeHub.all()) {
			const org = OrgRegistry.get(connection.orgId);
			let state: ReturnType<typeof RealtimeGateway.loadSessionState> = null;
			try {
				state = org
					? await OrgContext.run(org, () => RealtimeGateway.loadSessionState(connection.auth))
					: null;
			} catch (error) {
				Logger.error("Realtime revalidation failed:", error);
				continue;
			}
			if (!state) {
				connection.close(RealtimeProtocol.CLOSE_UNAUTHORIZED, "Session ended");
				continue;
			}
			connection.role = state.role;
			connection.displayName = state.displayName;
		}

		// Whoever is still connected was seen just now.
		const byOrg = new Map<number, Set<number>>();
		for (const connection of RealtimeHub.all()) {
			const ids = byOrg.get(connection.orgId) ?? new Set<number>();
			ids.add(connection.userId);
			byOrg.set(connection.orgId, ids);
		}
		for (const [orgId, ids] of byOrg) touchLastSeen(orgId, [...ids]);
	}

	private static startRevalidation() {
		if (RealtimeGateway.revalidateTimer) return;
		RealtimeGateway.revalidateTimer = setInterval(() => {
			if (RealtimeHub.all().length === 0) {
				RealtimeGateway.stopRevalidation();
				return;
			}
			void RealtimeGateway.revalidate();
		}, RealtimeLimits.REVALIDATE_INTERVAL_MS);
		RealtimeGateway.revalidateTimer.unref?.();
	}

	static stopRevalidation() {
		if (RealtimeGateway.revalidateTimer) clearInterval(RealtimeGateway.revalidateTimer);
		RealtimeGateway.revalidateTimer = null;
	}
}
