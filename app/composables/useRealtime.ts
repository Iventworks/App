/**
 * useRealtime — the realtime WebSocket (`/ws/realtime`): pushes that a chat changed, who is
 * typing, who is online and that there are new notifications. The data itself still comes from
 * the REST API; the socket only says when to load it, so polling stays as a slow fallback.
 *
 * One connection per browser tab, opened by the dashboard layout (`start()`) and closed on logout
 * or when the layout goes (`stop()`). It authenticates with a one-time ticket from
 * `POST /realtime/ticket` (the bearer token never goes into the URL), reconnects with backoff,
 * and after a reconnect emits `resync` so open views catch up on what they missed.
 */
import { tryOnScopeDispose } from "@vueuse/core";
import type { NuxtApp } from "#app";
import type { RealtimeProtocol } from "~~/server/lib/realtime/protocol";

export type RealtimeEvent = RealtimeProtocol.ServerEvent | { type: "resync" };
export type RealtimeListener = (event: RealtimeEvent) => void;

export interface RealtimeTypist {
	id: number;
	name: string;
}

const PING_MS = 25_000;
/** No traffic for this long (pongs included): the connection is dead, reconnect. */
const STALE_MS = 70_000;
const MAX_BACKOFF_MS = 30_000;
/** A typing signal shows this long unless it is repeated. */
const TYPING_TTL_MS = 6_000;
/** Send at most one typing signal per chat in this interval (the server drops more anyway). */
const TYPING_SEND_MS = 2_500;
/** Without input for this long, the person counts as away (pushes go out again). */
const IDLE_AFTER_MS = 3 * 60_000;
const ACTIVITY_CHECK_MS = 30_000;
const INTERACTION_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

class RealtimeClient {
	/** Connected and greeted by the server: views may poll slowly. */
	readonly connected = ref(false);
	/** The signed-in user (from the server's hello). */
	readonly selfId = ref<number | null>(null);
	readonly online = shallowRef<ReadonlySet<number>>(new Set());
	/** Chat id → people typing there right now. */
	readonly typing = shallowRef<ReadonlyMap<number, RealtimeTypist[]>>(new Map());
	/** User id → when they were last online (from the members list and presence events). */
	readonly lastSeen = shallowRef<ReadonlyMap<number, number>>(new Map());

	private nuxtApp: NuxtApp | null = null;
	private socket: WebSocket | null = null;
	private wanted = false;
	private attempts = 0;
	private greetedBefore = false;
	private lastTraffic = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private typingTimer: ReturnType<typeof setInterval> | null = null;
	private readonly listeners = new Set<RealtimeListener>();
	private readonly typingUntil = new Map<number, Map<number, { name: string; until: number }>>();
	private readonly typingSentAt = new Map<number, number>();
	private lastInteraction = Date.now();
	private sentActive: boolean | null = null;
	private activityTimer: ReturnType<typeof setInterval> | null = null;

	/** Connect (idempotent). Call from a component's setup or lifecycle hook. */
	start() {
		if (import.meta.server || this.wanted) return;
		this.nuxtApp = useNuxtApp();
		this.wanted = true;
		window.addEventListener("online", this.wake);
		document.addEventListener("visibilitychange", this.wake);
		document.addEventListener("visibilitychange", this.updateActivity);
		window.addEventListener("focus", this.updateActivity);
		window.addEventListener("blur", this.updateActivity);
		for (const type of INTERACTION_EVENTS) {
			window.addEventListener(type, this.onInteraction, { passive: true, capture: true });
		}
		this.activityTimer = setInterval(this.updateActivity, ACTIVITY_CHECK_MS);
		void this.connect();
	}

	/** Disconnect and forget everything (logout, leaving the dashboard). */
	stop() {
		this.wanted = false;
		this.greetedBefore = false;
		if (import.meta.client) {
			window.removeEventListener("online", this.wake);
			document.removeEventListener("visibilitychange", this.wake);
			document.removeEventListener("visibilitychange", this.updateActivity);
			window.removeEventListener("focus", this.updateActivity);
			window.removeEventListener("blur", this.updateActivity);
			for (const type of INTERACTION_EVENTS) {
				window.removeEventListener(type, this.onInteraction, { capture: true });
			}
		}
		if (this.activityTimer) clearInterval(this.activityTimer);
		this.activityTimer = null;
		this.sentActive = null;
		this.clearTimers();
		const socket = this.socket;
		this.socket = null;
		socket?.close(1000, "stopped");
		this.connected.value = false;
		this.selfId.value = null;
		this.online.value = new Set();
		this.typingUntil.clear();
		this.publishTyping();
	}

	/** Listen to everything the server sends (and `resync`). Returns the unsubscribe function. */
	on(listener: RealtimeListener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Tell the others in a chat that the user is typing (throttled). */
	sendTyping(conversationId: number) {
		const now = Date.now();
		if (now - (this.typingSentAt.get(conversationId) ?? 0) < TYPING_SEND_MS) return;
		this.typingSentAt.set(conversationId, now);
		this.send({ type: "typing", conversation_id: conversationId });
	}

	/** Who is typing in a chat (reactive through `typing`). */
	typingIn(conversationId: number): RealtimeTypist[] {
		return this.typing.value.get(conversationId) ?? [];
	}

	/** A message from these people arrived: they stopped typing. */
	clearTyping(conversationId: number, userIds: Iterable<number>) {
		const entries = this.typingUntil.get(conversationId);
		if (!entries) return;
		let changed = false;
		for (const id of userIds) changed = entries.delete(id) || changed;
		if (changed) this.publishTyping();
	}

	isOnline(userId: number | null | undefined) {
		return userId !== null && userId !== undefined && this.online.value.has(userId);
	}

	lastSeenOf(userId: number | null | undefined) {
		return userId === null || userId === undefined ? null : (this.lastSeen.value.get(userId) ?? null);
	}

	/** Seed last-seen times (from `/conversations/{id}/members`). */
	rememberLastSeen(entries: Iterable<[number, number | null]>) {
		const next = new Map(this.lastSeen.value);
		let changed = false;
		for (const [userId, at] of entries) {
			if (at === null || (next.get(userId) ?? 0) >= at) continue;
			next.set(userId, at);
			changed = true;
		}
		if (changed) this.lastSeen.value = next;
	}

	// --- activity (no pushes while the person is using the app) --------------------------------

	private readonly onInteraction = () => {
		const wasIdle = Date.now() - this.lastInteraction > IDLE_AFTER_MS;
		this.lastInteraction = Date.now();
		if (wasIdle || this.sentActive === false) this.updateActivity();
	};

	private readonly updateActivity = () => {
		const active =
			document.visibilityState === "visible" &&
			document.hasFocus() &&
			Date.now() - this.lastInteraction < IDLE_AFTER_MS;
		if (active === this.sentActive || this.socket?.readyState !== WebSocket.OPEN) return;
		this.sentActive = active;
		this.send({ type: "activity", active });
	};

	// --- connection --------------------------------------------------------------------------

	private readonly wake = () => {
		if (!this.wanted || this.socket) return;
		if (document.visibilityState !== "visible" && navigator.onLine) return;
		// Back online or back in the tab: don't wait for the backoff.
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		void this.connect();
	};

	private async connect() {
		if (!this.wanted || this.socket || !this.nuxtApp) return;
		const nuxtApp = this.nuxtApp;
		const result = await nuxtApp.runWithContext(() =>
			useAPI((api) => api.postRealtimeTicket({}), true),
		);
		if (!this.wanted || this.socket) return;

		if (!result.success) {
			// Signed out, not activated, or a host without chats: polling only, no retries.
			if ([401, 403, 404].includes(result.code as number)) {
				this.wanted = false;
				return;
			}
			this.scheduleReconnect();
			return;
		}

		const url = new URL(result.data.path, window.location.origin);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		url.searchParams.set("ticket", result.data.ticket);

		let socket: WebSocket;
		try {
			socket = new WebSocket(url);
		} catch {
			this.scheduleReconnect();
			return;
		}
		this.socket = socket;
		this.lastTraffic = Date.now();

		socket.addEventListener("message", (message) => {
			this.lastTraffic = Date.now();
			let event: RealtimeProtocol.ServerEvent;
			try {
				event = JSON.parse(String(message.data));
			} catch {
				return;
			}
			this.handle(event);
		});

		socket.addEventListener("close", () => {
			if (this.socket !== socket) return;
			this.socket = null;
			this.connected.value = false;
			this.online.value = new Set();
			this.clearTimers();
			if (this.wanted) this.scheduleReconnect();
		});
	}

	private scheduleReconnect() {
		if (!this.wanted || this.reconnectTimer) return;
		const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
		this.attempts++;
		this.reconnectTimer = setTimeout(
			() => {
				this.reconnectTimer = null;
				void this.connect();
			},
			base * (0.5 + Math.random() * 0.5),
		);
	}

	private clearTimers() {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		if (this.pingTimer) clearInterval(this.pingTimer);
		if (this.typingTimer) clearInterval(this.typingTimer);
		this.reconnectTimer = null;
		this.pingTimer = null;
		this.typingTimer = null;
	}

	private send(event: RealtimeProtocol.ClientEvent) {
		if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
	}

	private handle(event: RealtimeProtocol.ServerEvent) {
		switch (event.type) {
			case "hello":
				this.attempts = 0;
				this.connected.value = true;
				this.selfId.value = event.user_id;
				this.online.value = new Set(event.online_user_ids);
				this.startPing();
				// A new connection starts as "not active" on the server: report the real state.
				this.sentActive = null;
				this.updateActivity();
				// After a reconnect, views catch up on what happened while the socket was gone.
				if (this.greetedBefore) this.emit({ type: "resync" });
				this.greetedBefore = true;
				break;
			case "presence": {
				const next = new Set(this.online.value);
				if (event.online) next.add(event.user_id);
				else next.delete(event.user_id);
				this.online.value = next;
				if (!event.online && event.last_seen_at) {
					this.rememberLastSeen([[event.user_id, event.last_seen_at]]);
				}
				break;
			}
			case "typing": {
				let entries = this.typingUntil.get(event.conversation_id);
				if (!entries) {
					entries = new Map();
					this.typingUntil.set(event.conversation_id, entries);
				}
				entries.set(event.user.id, {
					name: event.user.display_name,
					until: Date.now() + TYPING_TTL_MS,
				});
				this.publishTyping();
				this.startTypingExpiry();
				break;
			}
		}
		this.emit(event);
	}

	private emit(event: RealtimeEvent) {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("Realtime listener failed:", error);
			}
		}
	}

	private startPing() {
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = setInterval(() => {
			if (Date.now() - this.lastTraffic > STALE_MS) {
				// Half-open connection: drop it, the close handler reconnects.
				this.socket?.close(4000, "stale");
				return;
			}
			this.send({ type: "ping" });
		}, PING_MS);
	}

	// --- typing --------------------------------------------------------------------------------

	private startTypingExpiry() {
		if (this.typingTimer) return;
		this.typingTimer = setInterval(() => {
			const now = Date.now();
			let changed = false;
			for (const [conversationId, entries] of this.typingUntil) {
				for (const [userId, entry] of entries) {
					if (entry.until <= now) {
						entries.delete(userId);
						changed = true;
					}
				}
				if (entries.size === 0) this.typingUntil.delete(conversationId);
			}
			if (changed) this.publishTyping();
			if (this.typingUntil.size === 0 && this.typingTimer) {
				clearInterval(this.typingTimer);
				this.typingTimer = null;
			}
		}, 1_000);
	}

	private publishTyping() {
		const next = new Map<number, RealtimeTypist[]>();
		for (const [conversationId, entries] of this.typingUntil) {
			if (entries.size === 0) continue;
			next.set(
				conversationId,
				[...entries].map(([id, entry]) => ({ id, name: entry.name })),
			);
		}
		this.typing.value = next;
	}
}

let client: RealtimeClient | null = null;

export function useRealtime() {
	client ??= new RealtimeClient();
	return client;
}

/** Listen to realtime events for as long as the calling component (or scope) lives. */
export function useRealtimeEvent(listener: RealtimeListener) {
	const off = useRealtime().on(listener);
	tryOnScopeDispose(off);
	return off;
}

/** "Anna schreibt …", "Anna und Ben schreiben …", "3 Personen schreiben …" */
export function typingLabel(typists: RealtimeTypist[]) {
	const first = (name: string) => name.split(" ")[0] ?? name;
	if (typists.length === 0) return "";
	if (typists.length === 1) return `${first(typists[0]!.name)} schreibt …`;
	if (typists.length === 2) {
		return `${first(typists[0]!.name)} und ${first(typists[1]!.name)} schreiben …`;
	}
	return `${typists.length} Personen schreiben …`;
}
