/**
 * Who is in a shared editing session right now (`Collab`), in memory like the realtime hub: one
 * entry per Yjs client (a tab), with its awareness (cursor, selection) and when it was last heard
 * of. Clients that stay silent for `TIMEOUT_MS` drop out. Keyed by org and file.
 */
export namespace CollabSessions {
	export const TIMEOUT_MS = 45_000;

	export interface Participant {
		clientId: number;
		userId: number;
		displayName: string;
		/** The client's last awareness update (already rewritten by the server), or null. */
		awareness: Uint8Array | null;
		lastSeen: number;
	}

	const sessions = new Map<string, Map<number, Participant>>();

	function key(orgId: number, fileId: number) {
		return `${orgId}:${fileId}`;
	}

	/** The live participants of a file's session (silent ones are dropped first). */
	export function participants(orgId: number, fileId: number, now = Date.now()): Participant[] {
		const session = sessions.get(key(orgId, fileId));
		if (!session) return [];
		for (const [clientId, participant] of session) {
			if (now - participant.lastSeen > TIMEOUT_MS) session.delete(clientId);
		}
		if (session.size === 0) sessions.delete(key(orgId, fileId));
		return [...session.values()];
	}

	export function upsert(orgId: number, fileId: number, participant: Participant) {
		let session = sessions.get(key(orgId, fileId));
		if (!session) {
			session = new Map();
			sessions.set(key(orgId, fileId), session);
		}
		const existing = session.get(participant.clientId);
		// A client id belongs to the person who used it first.
		if (existing && existing.userId !== participant.userId) return false;
		session.set(participant.clientId, participant);
		return true;
	}

	export function get(orgId: number, fileId: number, clientId: number) {
		return sessions.get(key(orgId, fileId))?.get(clientId) ?? null;
	}

	/** A tab leaves — only its own person can make it leave. */
	export function remove(orgId: number, fileId: number, clientId: number, userId: number) {
		const session = sessions.get(key(orgId, fileId));
		if (session?.get(clientId)?.userId !== userId) return false;
		session.delete(clientId);
		if (session.size === 0) sessions.delete(key(orgId, fileId));
		return true;
	}

	/** Everyone leaves (the file was deleted or its session ended). */
	export function end(orgId: number, fileId: number) {
		sessions.delete(key(orgId, fileId));
	}

	/** Tests. */
	export function clear() {
		sessions.clear();
	}
}
