import type { AuthHandler } from "../api/utils/authHandler";
import type { UserAccountSettings } from "../api/utils/shared-models/accountData";
import type { RealtimeProtocol } from "./protocol";

/**
 * The open realtime connections, per org. Everything sent goes to connections of one org only:
 * the org is part of every lookup, so an event can never reach another tenant.
 */
export class RealtimeHub {
	private static readonly byOrg = new Map<number, Set<RealtimeHub.Connection>>();

	static connectionsOf(orgId: number): ReadonlySet<RealtimeHub.Connection> {
		return RealtimeHub.byOrg.get(orgId) ?? new Set();
	}

	static hasConnections(orgId: number) {
		return (RealtimeHub.byOrg.get(orgId)?.size ?? 0) > 0;
	}

	static all(): RealtimeHub.Connection[] {
		return [...RealtimeHub.byOrg.values()].flatMap((set) => [...set]);
	}

	static countForUser(orgId: number, userId: number) {
		let count = 0;
		for (const connection of RealtimeHub.connectionsOf(orgId)) {
			if (connection.userId === userId) count++;
		}
		return count;
	}

	/** Add a connection. True when it is the person's first one: they just came online. */
	static add(connection: RealtimeHub.Connection) {
		const first = RealtimeHub.countForUser(connection.orgId, connection.userId) === 0;
		let set = RealtimeHub.byOrg.get(connection.orgId);
		if (!set) {
			set = new Set();
			RealtimeHub.byOrg.set(connection.orgId, set);
		}
		set.add(connection);
		return first;
	}

	/** Remove a connection. True when it was the person's last one: they went offline. */
	static remove(connection: RealtimeHub.Connection) {
		const set = RealtimeHub.byOrg.get(connection.orgId);
		if (!set?.delete(connection)) return false;
		if (set.size === 0) RealtimeHub.byOrg.delete(connection.orgId);
		return RealtimeHub.countForUser(connection.orgId, connection.userId) === 0;
	}

	/** People shown as online: connected and sharing their presence. */
	static onlineUserIds(orgId: number): number[] {
		return [
			...new Set(
				[...RealtimeHub.connectionsOf(orgId)]
					.filter((entry) => entry.sharePresence)
					.map((entry) => entry.userId),
			),
		];
	}

	/** The person is using the app right now (a visible tab with recent activity): no push. */
	static isActive(orgId: number, userId: number) {
		for (const connection of RealtimeHub.connectionsOf(orgId)) {
			if (connection.userId === userId && connection.active) return true;
		}
		return false;
	}

	/** The person changed whether others may see them online; true when it changed anything. */
	static setSharePresence(orgId: number, userId: number, share: boolean) {
		let changed = false;
		for (const connection of RealtimeHub.connectionsOf(orgId)) {
			if (connection.userId === userId && connection.sharePresence !== share) {
				connection.sharePresence = share;
				changed = true;
			}
		}
		return changed;
	}

	/** Send to every connection of the given people in the org. */
	static sendToUsers(
		orgId: number,
		userIds: Iterable<number>,
		event: RealtimeProtocol.ServerEvent,
		options: { exceptUserId?: number } = {},
	) {
		const connections = RealtimeHub.byOrg.get(orgId);
		if (!connections?.size) return;
		const recipients = new Set(userIds);
		if (options.exceptUserId !== undefined) recipients.delete(options.exceptUserId);
		if (recipients.size === 0) return;

		const data = JSON.stringify(event);
		for (const connection of connections) {
			if (recipients.has(connection.userId)) RealtimeHub.deliver(connection, data);
		}
	}

	/** Send to everyone connected in the org. */
	static broadcast(
		orgId: number,
		event: RealtimeProtocol.ServerEvent,
		options: { exceptUserId?: number } = {},
	) {
		const data = JSON.stringify(event);
		for (const connection of RealtimeHub.connectionsOf(orgId)) {
			if (connection.userId !== options.exceptUserId) RealtimeHub.deliver(connection, data);
		}
	}

	static send(connection: RealtimeHub.Connection, event: RealtimeProtocol.ServerEvent) {
		RealtimeHub.deliver(connection, JSON.stringify(event));
	}

	private static deliver(connection: RealtimeHub.Connection, data: string) {
		try {
			connection.send(data);
		} catch {
			// A socket that can't take data is closing anyway; its close handler cleans up.
		}
	}

	/** Tests only. */
	static clear() {
		RealtimeHub.byOrg.clear();
	}
}

export namespace RealtimeHub {
	export interface Connection {
		readonly id: string;
		readonly orgId: number;
		readonly userId: number;
		role: UserAccountSettings.Role;
		displayName: string;
		/** Others may see the person online (`notifications.share_presence`). */
		sharePresence: boolean;
		/** Visible tab with recent activity (reported by the client): pushes are held back. */
		active: boolean;
		/** The session or API key the ticket was issued for: the connection lives as long as it. */
		readonly auth: AuthHandler.AuthenticatedAuthContext;
		send(data: string): void;
		close(code?: number, reason?: string): void;
		/** Receive times within the current rate-limit window. */
		recentMessages: number[];
		/** Last typing signal passed on, per chat. */
		lastTyping: Map<number, number>;
	}
}
