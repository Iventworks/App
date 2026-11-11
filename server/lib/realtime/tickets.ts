import { randomBytes } from "node:crypto";
import type { AuthHandler } from "../api/utils/authHandler";
import { RealtimeLimits } from "./limits";

/**
 * One-time tickets for opening the realtime WebSocket. A browser can't send the `Authorization`
 * header with a WebSocket, and the session cookie is deliberately not accepted there (WebSockets
 * have no same-site protection): the client fetches a ticket with its bearer token
 * (`POST /realtime/ticket`) and opens `/ws/realtime?ticket=…` within seconds. A ticket works once,
 * only on a host of the org it was issued in, and carries the session it was issued for, so the
 * connection ends with that session.
 *
 * In memory: there is one app instance, and a ticket outlives a restart by at most its TTL.
 */
export class RealtimeTickets {
	private static readonly tickets = new Map<string, RealtimeTickets.Entry>();

	static issue(orgId: number, auth: AuthHandler.AuthenticatedAuthContext, now = Date.now()) {
		RealtimeTickets.prune(now);

		// Bound what one person can park here.
		const own = [...RealtimeTickets.tickets].filter(
			([, entry]) => entry.orgId === orgId && entry.auth.user_id === auth.user_id,
		);
		if (own.length >= RealtimeLimits.MAX_TICKETS_PER_USER) {
			const oldest = own.sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
			if (oldest) RealtimeTickets.tickets.delete(oldest[0]);
		}

		const ticket = randomBytes(32).toString("base64url");
		const expiresAt = now + RealtimeLimits.TICKET_TTL_MS;
		RealtimeTickets.tickets.set(ticket, { orgId, auth, expiresAt });
		return { ticket, expiresAt };
	}

	/** The ticket's entry if it is valid for `orgId` — and gone afterwards either way. */
	static redeem(ticket: string, orgId: number, now = Date.now()): RealtimeTickets.Entry | null {
		const entry = RealtimeTickets.tickets.get(ticket);
		if (!entry) return null;
		RealtimeTickets.tickets.delete(ticket);
		if (entry.expiresAt <= now || entry.orgId !== orgId) return null;
		return entry;
	}

	static prune(now = Date.now()) {
		for (const [ticket, entry] of RealtimeTickets.tickets) {
			if (entry.expiresAt <= now) RealtimeTickets.tickets.delete(ticket);
		}
	}

	/** Tests only. */
	static clear() {
		RealtimeTickets.tickets.clear();
	}
}

export namespace RealtimeTickets {
	export interface Entry {
		orgId: number;
		auth: AuthHandler.AuthenticatedAuthContext;
		expiresAt: number;
	}
}
