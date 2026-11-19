/**
 * The browser side of shared Markdown editing (`server/lib/api/utils/collab.ts`): a Yjs document
 * plus awareness (cursors) kept in sync through `POST /files/{id}/collab`. The realtime channel
 * only says "document changed" (`{ type: "document" }`), then the provider pulls; without the
 * channel it polls. It also writes the Markdown back (`PUT …/collab/content`): soon after its own
 * changes, later for changes nobody saved (someone closed the tab mid-sentence).
 *
 * Works with TipTap's `Collaboration` (`doc`) and `CollaborationCaret` (`awareness`, the provider
 * itself). `serialize` must be set to the editor's `getMarkdown` once the editor exists.
 */
import {
	Awareness,
	applyAwarenessUpdate,
	encodeAwarenessUpdate,
	removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

const REMOTE = "remote";
/** Own changes are written back this long after typing stops (at most this long while typing). */
const SAVE_AFTER_MS = 2_000;
const SAVE_MAX_WAIT_MS = 10_000;
/** Changes nobody saved are saved by anyone after this. */
const CATCH_UP_SAVE_MS = 8_000;
/** Keeps the session (and the lock) alive; the server drops silent tabs after 45 s. */
const HEARTBEAT_MS = 10_000;
/** Without the realtime channel. */
const POLL_MS = 2_000;
const CURSOR_SEND_MS = 250;

export interface CollabParticipant {
	client_id: number;
	user: { id: number; display_name: string };
	color: string;
}

type SyncResult = {
	epoch: number;
	reset: boolean;
	seq: number;
	saved_seq: number;
	state: string | null;
	updates: { seq: number; data: string }[];
	initialize: boolean;
	ready: boolean;
	participants: CollabParticipant[];
	awareness: { client_id: number; data: string }[];
};

function toBase64(data: Uint8Array) {
	let binary = "";
	for (let i = 0; i < data.length; i += 0x8000) {
		binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

function fromBase64(text: string) {
	const binary = atob(text);
	const data = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
	return data;
}

export class CollabProvider {
	readonly doc = new Y.Doc();
	readonly awareness = new Awareness(this.doc);

	/**
	 * `waiting`: the document is being filled by someone else. `ended`: left, or broken. `reset`:
	 * the session ended while this tab was away; its document is gone — open the editor again.
	 */
	readonly status = ref<"connecting" | "waiting" | "ready" | "error" | "ended" | "reset">(
		"connecting",
	);
	readonly participants = shallowRef<CollabParticipant[]>([]);
	readonly saveState = ref<"saved" | "pending" | "saving" | "error">("saved");
	readonly savedAt = ref<number | null>(null);
	/** This tab is to fill the fresh document from the file (`initializeWith`). */
	readonly initializeRequested = ref(false);

	/** The editor's Markdown, set once it exists. */
	serialize: (() => string) | null = null;

	private epoch: number | null = null;
	private initState: "none" | "running" | "done" = "none";
	private seq: number | null = null;
	private savedSeq = 0;
	private pending: Uint8Array[] = [];
	private ownChanges = false;
	private awarenessDirty = false;
	private initializing = false;
	/** Something went wrong that retrying doesn't fix (the fresh document was filled twice). */
	private fatal = false;
	private failures = 0;
	private disposed = false;
	private inFlight: Promise<void> | null = null;
	private again = false;
	private stopped = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private saveDeadline: number | null = null;
	private cursorTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeat: ReturnType<typeof setInterval> | null = null;
	private offRealtime: (() => void) | null = null;

	constructor(readonly fileId: number) {}

	/** Something isn't written back yet. */
	get dirty() {
		return this.pending.length > 0 || this.ownChanges || (this.seq ?? 0) > this.savedSeq;
	}

	// --- lifecycle --------------------------------------------------------------------------------

	/**
	 * Join the session. When this tab is to fill the fresh document — now or later, if the tab
	 * that should have left — `initializeRequested` turns true: see `initializeWith`.
	 */
	async start() {
		const result = await this.request({ after: null });
		if (!result) {
			this.status.value = "error";
			return;
		}
		this.apply(result);
		this.doc.on("update", this.onDocUpdate);
		this.awareness.on("update", this.onAwarenessUpdate);

		const realtime = useRealtime();
		this.offRealtime = realtime.on((event) => {
			if (event.type === "document" && event.file_id === this.fileId) void this.sync();
		});
		// Send the own name/cursor right away.
		this.awarenessDirty = true;
		void this.sync();
		this.heartbeat = setInterval(() => {
			const quiet = realtime.connected.value && this.status.value === "ready";
			if (!quiet || Date.now() - this.lastRequest >= HEARTBEAT_MS) void this.sync();
		}, POLL_MS);
	}

	/**
	 * Fill the fresh document (`fill` sets the editor's content, from `load`) and send it as the
	 * start. Once per tab.
	 */
	async initializeWith(load: () => Promise<string | null>, fill: (text: string) => void) {
		if (this.initState !== "none" || this.stopped) return true;
		this.initState = "running";
		this.initializeRequested.value = false;
		const text = await load();
		if (text === null) {
			// Try again with the next claim.
			this.initState = "none";
			return false;
		}
		this.initializing = true;
		try {
			fill(text);
			// The editor may write into the Yjs document a moment later.
			await new Promise((resolve) => setTimeout(resolve, 0));
		} finally {
			this.initializing = false;
		}
		const result = await this.request({
			after: this.seq,
			updates: [toBase64(Y.encodeStateAsUpdate(this.doc))],
			init: true,
		});
		this.initState = "done";
		if (!result) {
			// Someone else filled it meanwhile: two copies of the text would be merged.
			this.fatal = true;
			this.status.value = "error";
			return false;
		}
		this.apply(result);
		return true;
	}

	/** Write everything back and leave the session (closing the editor). */
	async stop() {
		if (this.stopped) return;
		await this.flush();
		this.stopped = true;
		this.cleanup();
		await this.request({ after: this.seq, leave: true });
		this.status.value = "ended";
	}

	/** Leave without waiting (the page goes away) and free everything. */
	destroy() {
		if (this.disposed) return;
		this.disposed = true;
		if (!this.stopped) {
			this.stopped = true;
			this.cleanup();
			void this.request({ after: this.seq, leave: true });
		}
		this.awareness.destroy();
		this.doc.destroy();
	}

	private cleanup() {
		if (this.heartbeat) clearInterval(this.heartbeat);
		if (this.saveTimer) clearTimeout(this.saveTimer);
		if (this.cursorTimer) clearTimeout(this.cursorTimer);
		this.offRealtime?.();
		this.doc.off("update", this.onDocUpdate);
		this.awareness.off("update", this.onAwarenessUpdate);
	}

	/** Send what is pending and write the text back; false when that failed. */
	async flush() {
		if (this.stopped) return !this.dirty;
		await this.sync();
		if ((this.seq ?? 0) > this.savedSeq || this.ownChanges) await this.save();
		return !this.dirty;
	}

	// --- syncing ----------------------------------------------------------------------------------

	private lastRequest = 0;

	private onDocUpdate = (update: Uint8Array, origin: unknown) => {
		if (origin === REMOTE || this.initializing || this.stopped) return;
		this.pending.push(update);
		this.ownChanges = true;
		this.saveState.value = "pending";
		void this.sync();
		this.scheduleSave(SAVE_AFTER_MS);
	};

	private onAwarenessUpdate = (_changes: unknown, origin: unknown) => {
		if (origin !== "local" || this.stopped) return;
		this.awarenessDirty = true;
		if (this.cursorTimer) return;
		this.cursorTimer = setTimeout(() => {
			this.cursorTimer = null;
			void this.sync();
		}, CURSOR_SEND_MS);
	};

	/** Send pending updates and the cursor, receive what is new (one request at a time). */
	sync(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		if (this.inFlight) {
			this.again = true;
			return this.inFlight;
		}
		this.inFlight = (async () => {
			do {
				this.again = false;
				const updates = this.pending.splice(0);
				const awareness = this.awarenessDirty
					? toBase64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
					: undefined;
				this.awarenessDirty = false;
				const result = await this.request({
					after: this.seq,
					updates: updates.length ? [toBase64(Y.mergeUpdates(updates))] : [],
					awareness,
				});
				if (!result) {
					// Try again with the next sync.
					this.pending.unshift(...updates);
					break;
				}
				this.apply(result);
			} while (this.again && !this.stopped);
		})().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}

	private apply(result: SyncResult) {
		if (result.reset) {
			// The session ended while this tab was away: its document can't be merged into the new
			// one (the text would be there twice). Stop; the editor offers to open it again.
			this.stopped = true;
			this.cleanup();
			// Nothing of it can be saved any more (`dirty` is false: leaving isn't held up).
			this.pending = [];
			this.ownChanges = false;
			this.seq = null;
			this.status.value = "reset";
			return;
		}
		this.epoch = result.epoch;
		if (result.state) Y.applyUpdate(this.doc, fromBase64(result.state), REMOTE);
		for (const update of result.updates) Y.applyUpdate(this.doc, fromBase64(update.data), REMOTE);
		this.seq = result.seq;
		this.savedSeq = Math.max(this.savedSeq, result.saved_seq);
		this.participants.value = result.participants;
		if (!this.fatal && this.status.value !== "ended") {
			this.status.value = result.ready ? "ready" : "waiting";
		}
		if (result.ready && this.initState === "none") this.initState = "done";
		else if (result.initialize && this.initState === "none") this.initializeRequested.value = true;

		for (const entry of result.awareness) {
			applyAwarenessUpdate(this.awareness, fromBase64(entry.data), REMOTE);
		}
		const live = new Set(result.participants.map((participant) => participant.client_id));
		const gone = [...this.awareness.getStates().keys()].filter(
			(id) => id !== this.doc.clientID && !live.has(id),
		);
		if (gone.length) removeAwarenessStates(this.awareness, gone, REMOTE);

		// Changes nobody wrote back yet (someone left mid-sentence): anyone saves them.
		if (!this.ownChanges && result.seq > this.savedSeq) this.scheduleSave(CATCH_UP_SAVE_MS);
	}

	private async request(body: {
		after: number | null;
		updates?: string[];
		init?: boolean;
		awareness?: string;
		leave?: boolean;
	}): Promise<SyncResult | null> {
		this.lastRequest = Date.now();
		const result = await useAPI((api) =>
			api.postFilesByFileIdCollab({
				path: { fileId: this.fileId },
				body: {
					client_id: this.doc.clientID,
					epoch: this.epoch,
					updates: [],
					init: false,
					leave: false,
					...body,
				},
			}),
		);
		if (!result.success) {
			// Several failures in a row: show it (the next success clears it).
			if (++this.failures >= 3 && !body.leave) this.status.value = "error";
			return null;
		}
		this.failures = 0;
		return (result.data as SyncResult | undefined) ?? null;
	}

	// --- writing back ------------------------------------------------------------------------------

	private scheduleSave(delay: number) {
		if (this.stopped) return;
		const now = Date.now();
		this.saveDeadline ??= now + SAVE_MAX_WAIT_MS;
		const at = Math.min(now + delay, this.saveDeadline);
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.save(), Math.max(0, at - now));
	}

	/** Write the current text back (after sending own changes, so `seq` covers them). */
	async save() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.saveDeadline = null;
		if (!this.serialize || this.status.value !== "ready") return;
		await this.sync();
		const seq = this.seq ?? 0;
		if (seq === 0 || (seq <= this.savedSeq && !this.ownChanges)) {
			this.saveState.value = "saved";
			return;
		}
		const content = this.serialize();
		const hadOwnChanges = this.ownChanges;
		this.ownChanges = false;
		this.saveState.value = "saving";
		const result = await useAPI((api) =>
			api.putFilesByFileIdCollabContent({
				path: { fileId: this.fileId },
				body: { client_id: this.doc.clientID, seq, epoch: this.epoch, content },
			}),
		);
		if (!result.success) {
			this.ownChanges ||= hadOwnChanges;
			this.saveState.value = "error";
			return;
		}
		this.savedSeq = Math.max(this.savedSeq, result.data.saved_seq);
		this.savedAt.value = Date.now();
		this.saveState.value = this.dirty ? "pending" : "saved";
	}
}
