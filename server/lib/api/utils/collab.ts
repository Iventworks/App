import { and, asc, eq, gt, lte, ne, sql } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { z } from "zod";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import { Realtime } from "../../realtime";
import { CollabSessions } from "./collabSessions";
import { CollabState } from "./collabState";
import { FileLocks } from "./fileLocks";
import { FileService } from "./fileService";

/** Cursor colours of the people in a session (by user id). */
const CURSOR_COLORS = [
	"#f97316",
	"#22c55e",
	"#3b82f6",
	"#e11d48",
	"#a855f7",
	"#14b8a6",
	"#eab308",
	"#ec4899",
];

/**
 * Shared editing of Markdown documents (like Nextcloud Text): the document is a Yjs document that
 * the browsers keep in sync through the API — the realtime socket only says "document changed"
 * (`{ type: "document" }`), the data always comes over REST, as for chats.
 *
 * - `sync` is everything a client does: join (`after: null` → the whole state), send its updates,
 *   send its awareness (cursor), pull what is new, leave. The first client of a fresh session
 *   fills the document from the file (`initialize`); everyone else waits until it did.
 * - The browsers write the Markdown back (`save`): after their own changes, with the `seq` the
 *   text reflects. Only newer saves are written, one at a time per file.
 * - While anyone is in the session, the file is locked (`FileLocks.holdSession`). When the last
 *   person leaves fully saved, the state is thrown away; contents changed from outside throw it
 *   away too (`CollabState.discard`).
 * - Awareness is rewritten by the server: only the sender's own entry, with its real name.
 *
 * Who is in a session lives in memory (`CollabSessions`), like the realtime hub: one server.
 */
export namespace Collab {
	/** Updates are merged into the base state once there are more than this. */
	export const COMPACT_AFTER = 200;
	/** How long the client that fills a fresh document has before someone else may. */
	export const INIT_CLAIM_MS = 15_000;
	export const MAX_AWARENESS_BYTES = 8_000;

	export const SyncBody = z.object({
		/** The Yjs client id of this tab. */
		client_id: z
			.number()
			.int()
			.nonnegative()
			.max(2 ** 32),
		/** The newest `seq` the client has; null: joining, send the whole state. */
		after: z.number().int().nonnegative().nullable(),
		/** Yjs updates (base64), in order. */
		updates: z.array(z.string().max(1_500_000)).max(50).default([]),
		/** The updates fill a fresh document (only the client that was told to `initialize`). */
		init: z.boolean().default(false),
		/** The client's awareness update (base64); null: none. */
		awareness: z.string().max(12_000).nullable().optional(),
		/** The tab closes the editor. */
		leave: z.boolean().default(false),
	});
	export type SyncBody = z.infer<typeof SyncBody>;

	export const SyncResponse = z.object({
		/** The newest update. */
		seq: z.number(),
		/** The newest update written back into the file. */
		saved_seq: z.number(),
		/** The whole document (base64) when the client joined or was too far behind. */
		state: z.string().nullable(),
		/** Others' updates after `after` (base64), in order. */
		updates: z.array(z.object({ seq: z.number(), data: z.string() })),
		/** This client fills the fresh document from the file. */
		initialize: z.boolean(),
		/** The document has contents (`seq > 0`); until then, wait. */
		ready: z.boolean(),
		participants: z.array(
			z.object({
				client_id: z.number(),
				user: z.object({ id: z.number(), display_name: z.string() }),
				color: z.string(),
			}),
		),
		/** Others' awareness updates (base64). */
		awareness: z.array(z.object({ client_id: z.number(), data: z.string() })),
	});
	export type SyncResponse = z.infer<typeof SyncResponse>;

	export const SaveBody = z.object({
		client_id: z
			.number()
			.int()
			.nonnegative()
			.max(2 ** 32),
		/** The newest update the text includes. */
		seq: z.number().int().positive(),
		content: z.string().max(500_000),
	});
	export type SaveBody = z.infer<typeof SaveBody>;

	export const SaveResponse = z.object({ saved_seq: z.number(), saved: z.boolean() });
	export type SaveResponse = z.infer<typeof SaveResponse>;

	export type Failure = { ok: false; status: 400 | 409; message: string };

	export function colorFor(userId: number) {
		return CURSOR_COLORS[userId % CURSOR_COLORS.length] as string;
	}

	/**
	 * Keep only the sender's own entry of an awareness update and set its name and colour from
	 * the account (nobody can show up as someone else). Null when nothing usable is left.
	 */
	export function sanitizeAwareness(
		update: Uint8Array,
		clientId: number,
		user: { name: string; color: string },
	): Uint8Array | null {
		try {
			const decoder = decoding.createDecoder(update);
			const count = decoding.readVarUint(decoder);
			for (let i = 0; i < count; i++) {
				const id = decoding.readVarUint(decoder);
				const clock = decoding.readVarUint(decoder);
				const raw = decoding.readVarString(decoder);
				if (id !== clientId) continue;
				const parsed = JSON.parse(raw) as unknown;
				const state =
					parsed && typeof parsed === "object" && !Array.isArray(parsed)
						? { ...(parsed as Record<string, unknown>), user }
						: null;
				const encoder = encoding.createEncoder();
				encoding.writeVarUint(encoder, 1);
				encoding.writeVarUint(encoder, id);
				encoding.writeVarUint(encoder, clock);
				encoding.writeVarString(encoder, JSON.stringify(state));
				const result = encoding.toUint8Array(encoder);
				return result.byteLength <= MAX_AWARENESS_BYTES ? result : null;
			}
		} catch {
			// Not an awareness update.
		}
		return null;
	}

	function decodeUpdates(updates: string[]): Buffer[] | null {
		const decoded: Buffer[] = [];
		for (const update of updates) {
			const data = Buffer.from(update, "base64");
			try {
				Y.decodeUpdate(data);
			} catch {
				return null;
			}
			decoded.push(data);
		}
		return decoded;
	}

	/** Join, send, pull, leave — see the namespace description. */
	export async function sync(
		file: DB.Models.File,
		user: { id: number; display_name: string },
		input: SyncBody,
		now = Date.now(),
	): Promise<{ ok: true; data: SyncResponse | null } | Failure> {
		const orgId = OrgContext.id();

		if (input.leave) {
			CollabSessions.remove(orgId, file.id, input.client_id);
			afterChange(file, null);
			if (CollabSessions.participants(orgId, file.id, now).length === 0) await endSession(file);
			return { ok: true, data: null };
		}

		const updates = decodeUpdates(input.updates);
		if (!updates) return { ok: false, status: 400, message: "Invalid document update" };
		if (!FileLocks.holdSession(file.id, now)) {
			return { ok: false, status: 409, message: "The file is being edited elsewhere" };
		}

		// Who is here, with their cursor.
		const color = colorFor(user.id);
		const previous = CollabSessions.get(orgId, file.id, input.client_id);
		let awareness = previous?.awareness ?? null;
		if (input.awareness !== undefined) {
			awareness =
				input.awareness === null
					? null
					: sanitizeAwareness(Buffer.from(input.awareness, "base64"), input.client_id, {
							name: user.display_name,
							color,
						});
		}
		const joined = CollabSessions.upsert(orgId, file.id, {
			clientId: input.client_id,
			userId: user.id,
			displayName: user.display_name,
			awareness,
			lastSeen: now,
		});
		if (!joined) return { ok: false, status: 400, message: "Invalid client id" };

		const result = DB.instance().transaction((tx) => {
			let row = tx
				.select()
				.from(DB.Tables.fileCollab)
				.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
				.get();
			if (!row) {
				row = tx
					.insert(DB.Tables.fileCollab)
					.values({ org_id: orgId, file_id: file.id, updated_at: now })
					.returning()
					.get();
			}

			// A fresh document: one client fills it from the file.
			let initialize = false;
			if (row.seq === 0) {
				const free =
					row.init_client === null || row.init_until < now || row.init_client === input.client_id;
				if (free) {
					tx
						.update(DB.Tables.fileCollab)
						.set({ init_client: input.client_id, init_until: now + INIT_CLAIM_MS })
						.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
						.run();
					initialize = true;
				}
			}

			if (updates.length > 0) {
				if (row.seq === 0 && !(input.init && initialize)) return { notReady: true as const };
				let seq = row.seq;
				for (const data of updates) {
					seq++;
					tx
						.insert(DB.Tables.fileCollabUpdates)
						.values({
							org_id: orgId,
							file_id: file.id,
							seq,
							data,
							client_id: input.client_id,
							user_id: user.id,
							created_at: now,
						})
						.run();
				}
				row = tx
					.update(DB.Tables.fileCollab)
					.set({ seq, updated_at: now, init_client: null, init_until: 0 })
					.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
					.returning()
					.get() as DB.Models.FileCollab;
				initialize = false;

				if (row.seq - row.base_seq > COMPACT_AFTER) {
					const pending = tx
						.select({ data: DB.Tables.fileCollabUpdates.data })
						.from(DB.Tables.fileCollabUpdates)
						.where(
							and(
								inOrg(DB.Tables.fileCollabUpdates),
								eq(DB.Tables.fileCollabUpdates.file_id, file.id),
								gt(DB.Tables.fileCollabUpdates.seq, row.base_seq),
							),
						)
						.orderBy(asc(DB.Tables.fileCollabUpdates.seq))
						.all();
					const merged = Buffer.from(
						Y.mergeUpdates([...(row.state ? [row.state] : []), ...pending.map((entry) => entry.data)]),
					);
					tx
						.update(DB.Tables.fileCollab)
						.set({ state: merged, base_seq: row.seq })
						.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
						.run();
					tx
						.delete(DB.Tables.fileCollabUpdates)
						.where(
							and(
								inOrg(DB.Tables.fileCollabUpdates),
								eq(DB.Tables.fileCollabUpdates.file_id, file.id),
								lte(DB.Tables.fileCollabUpdates.seq, row.seq),
							),
						)
						.run();
					row = { ...row, state: merged, base_seq: row.seq };
				}
			} else {
				tx
					.update(DB.Tables.fileCollab)
					.set({ updated_at: now })
					.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
					.run();
			}

			// What the client is missing.
			let state: Buffer | null = null;
			let missing: { seq: number; data: Buffer }[] = [];
			if (input.after === null || input.after < row.base_seq) {
				const rest = tx
					.select({ data: DB.Tables.fileCollabUpdates.data })
					.from(DB.Tables.fileCollabUpdates)
					.where(
						and(
							inOrg(DB.Tables.fileCollabUpdates),
							eq(DB.Tables.fileCollabUpdates.file_id, file.id),
							gt(DB.Tables.fileCollabUpdates.seq, row.base_seq),
						),
					)
					.orderBy(asc(DB.Tables.fileCollabUpdates.seq))
					.all();
				const parts = [...(row.state ? [row.state] : []), ...rest.map((entry) => entry.data)];
				state = parts.length ? Buffer.from(Y.mergeUpdates(parts)) : null;
			} else {
				missing = tx
					.select({ seq: DB.Tables.fileCollabUpdates.seq, data: DB.Tables.fileCollabUpdates.data })
					.from(DB.Tables.fileCollabUpdates)
					.where(
						and(
							inOrg(DB.Tables.fileCollabUpdates),
							eq(DB.Tables.fileCollabUpdates.file_id, file.id),
							gt(DB.Tables.fileCollabUpdates.seq, input.after),
							ne(DB.Tables.fileCollabUpdates.client_id, input.client_id),
						),
					)
					.orderBy(asc(DB.Tables.fileCollabUpdates.seq))
					.all();
			}
			return { notReady: false as const, row, initialize, state, missing };
		});

		if (result.notReady) return { ok: false, status: 409, message: "The document is not ready yet" };

		const participants = CollabSessions.participants(orgId, file.id, now);
		const awarenessChanged =
			input.awareness !== undefined &&
			Buffer.compare(Buffer.from(awareness ?? []), Buffer.from(previous?.awareness ?? [])) !== 0;
		if (updates.length > 0 || awarenessChanged || !previous) {
			afterChange(file, result.row.seq);
		}

		return {
			ok: true,
			data: {
				seq: result.row.seq,
				saved_seq: result.row.saved_seq,
				state: result.state ? result.state.toString("base64") : null,
				updates: result.missing.map((entry) => ({
					seq: entry.seq,
					data: Buffer.from(entry.data).toString("base64"),
				})),
				initialize: result.initialize,
				ready: result.row.seq > 0,
				participants: participants.map((participant) => ({
					client_id: participant.clientId,
					user: { id: participant.userId, display_name: participant.displayName },
					color: colorFor(participant.userId),
				})),
				awareness: participants
					.filter((participant) => participant.clientId !== input.client_id && participant.awareness)
					.map((participant) => ({
						client_id: participant.clientId,
						data: Buffer.from(participant.awareness as Uint8Array).toString("base64"),
					})),
			},
		};
	}

	/** Tell everyone in the session (all their tabs) to pull. */
	function afterChange(file: DB.Models.File, seq: number | null) {
		const orgId = OrgContext.id();
		const userIds = new Set(
			CollabSessions.participants(orgId, file.id).map((participant) => participant.userId),
		);
		if (userIds.size > 0) Realtime.documentChanged(userIds, file.id, seq);
	}

	/** The last person left: free the file; a fully saved state isn't needed any more. */
	async function endSession(file: DB.Models.File) {
		await FileLocks.releaseSession(file.id);
		const row = await DB.instance()
			.select()
			.from(DB.Tables.fileCollab)
			.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
			.get();
		if (row && row.saved_seq >= row.seq) await CollabState.discard(file.id);
	}

	/** One save at a time per file, so an older text never overwrites a newer one. */
	const saving = new Map<string, Promise<unknown>>();

	/** Write the Markdown a client serialised at `seq` back into the file (if it is newer). */
	export async function save(
		file: DB.Models.File,
		userId: number,
		input: SaveBody,
	): Promise<{ ok: true; data: SaveResponse } | Failure> {
		const key = `${OrgContext.id()}:${file.id}`;
		const previous = saving.get(key) ?? Promise.resolve();
		const run = previous
			.catch(() => {})
			.then(async (): Promise<{ ok: true; data: SaveResponse } | Failure> => {
				const row = await DB.instance()
					.select()
					.from(DB.Tables.fileCollab)
					.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
					.get();
				if (!row || input.seq > row.seq)
					return { ok: false, status: 409, message: "Unknown document state" };
				if (input.seq <= row.saved_seq)
					return { ok: true, data: { saved_seq: row.saved_seq, saved: false } };

				const current = (await FileService.get(file.id)) ?? file;
				const updated = await FileService.replaceText(current, input.content, userId, {
					keepCollab: true,
				});
				if (!updated) return { ok: false, status: 400, message: "File is too large" };
				await DB.instance()
					.update(DB.Tables.fileCollab)
					.set({ saved_seq: sql`max(${DB.Tables.fileCollab.saved_seq}, ${input.seq})` })
					.where(and(inOrg(DB.Tables.fileCollab), eq(DB.Tables.fileCollab.file_id, file.id)))
					.run();
				return { ok: true, data: { saved_seq: input.seq, saved: true } };
			});
		saving.set(key, run);
		try {
			return await run;
		} finally {
			if (saving.get(key) === run) saving.delete(key);
		}
	}
}
