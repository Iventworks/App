/**
 * Limits of the realtime channel. No imports: the server entry (`server/runtime/bun.ts`) reads
 * them before the app has started.
 */
export namespace RealtimeLimits {
	/** The one path that is upgraded to a WebSocket. */
	export const PATH = "/ws/realtime";

	/** Largest frame a client may send (they only send pings and typing signals). */
	export const MAX_FRAME_BYTES = 4 * 1024;
	/** Seconds without any traffic before the server drops the socket (clients ping every 25 s). */
	export const IDLE_TIMEOUT_SECONDS = 75;
	/** Unsent bytes queued for a slow client before it is disconnected. */
	export const BACKPRESSURE_BYTES = 1024 * 1024;

	/** A ticket is valid this long, once. */
	export const TICKET_TTL_MS = 30_000;
	/** Unredeemed tickets one person may hold. */
	export const MAX_TICKETS_PER_USER = 10;
	/** Open connections one person may have in an org (tabs, devices). */
	export const MAX_CONNECTIONS_PER_USER = 20;

	/** Messages a connection may send per window before it is closed. */
	export const MAX_MESSAGES_PER_WINDOW = 40;
	export const MESSAGE_WINDOW_MS = 10_000;
	/** At most one typing signal per chat in this interval is passed on. */
	export const TYPING_THROTTLE_MS = 2_500;

	/** How often open connections are checked against their session (revoked, suspended, role). */
	export const REVALIDATE_INTERVAL_MS = 60_000;
}
