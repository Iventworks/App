import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import { LCrypt } from "../../utils/crypto/lcrypt";
import { FileService } from "./fileService";
import { UserSummary } from "./shared-models/userSummary";

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_LENGTH = 32;
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Share links for people without an account (`file_shares`, like Nextcloud): `<org url>/s/<token>`
 * opens one file or folder; a folder share covers everything below it. Every request through a
 * link is confined to that subtree ({@link FileShares.resolveInShare}).
 *
 * Links only work while the org allows sharing (`orgs.file_sharing_enabled`) and until they expire.
 * A password-protected link is unlocked per browser with a cookie that proves knowledge of the
 * password without storing anything: `<expiry>.<sha256(token:expiry:password_hash)>` — it stops
 * working when it expires or the password changes.
 */
export class FileShares {
	/** 32 characters from 62: about 190 bits, not guessable. Rejection sampling keeps it uniform. */
	static createToken(): string {
		let token = "";
		while (token.length < TOKEN_LENGTH) {
			for (const byte of LCrypt.randomBytes(48)) {
				if (byte < 248 && token.length < TOKEN_LENGTH) token += TOKEN_ALPHABET[byte % 62];
			}
		}
		return token;
	}

	static url(token: string) {
		return `${OrgContext.current().url}/s/${token}`;
	}

	static isExpired(share: Pick<DB.Models.FileShare, "expires_at">, now = Date.now()) {
		return share.expires_at !== null && share.expires_at <= now;
	}

	// --- management (signed-in people) ------------------------------------------------------

	static async listForFile(fileId: number, tx: DrizzleDB = DB.instance()) {
		return await tx
			.select()
			.from(DB.Tables.fileShares)
			.where(and(inOrg(DB.Tables.fileShares), eq(DB.Tables.fileShares.file_id, fileId)))
			.orderBy(desc(DB.Tables.fileShares.created_at), desc(DB.Tables.fileShares.id))
			.all();
	}

	static async get(shareId: number, tx: DrizzleDB = DB.instance()) {
		return (
			(await tx
				.select()
				.from(DB.Tables.fileShares)
				.where(and(inOrg(DB.Tables.fileShares), eq(DB.Tables.fileShares.id, shareId)))
				.get()) ?? null
		);
	}

	static async create(
		file: DB.Models.File,
		input: FileShares.Settings,
		userId: number,
		tx: DrizzleDB = DB.instance(),
	) {
		const permissions = FileShares.normalizePermissions(file, input.permissions);
		const defaultDays = OrgContext.current().share_default_expiry_days;
		const expiresAt =
			input.expires_at !== undefined
				? input.expires_at
				: defaultDays
					? Date.now() + defaultDays * 24 * 60 * 60 * 1000
					: null;

		return await tx
			.insert(DB.Tables.fileShares)
			.values({
				org_id: OrgContext.id(),
				file_id: file.id,
				token: FileShares.createToken(),
				label: input.label?.trim() || null,
				can_read: permissions.read,
				can_upload: permissions.upload,
				can_edit: permissions.edit,
				can_delete: permissions.delete,
				password_hash: input.password ? await Bun.password.hash(input.password) : null,
				expires_at: expiresAt,
				created_by: userId,
			})
			.returning()
			.get();
	}

	/** `password`: a string sets a new one, null removes it, undefined keeps it. */
	static async update(
		share: DB.Models.FileShare,
		file: DB.Models.File,
		changes: Partial<FileShares.Settings> & { password?: string | null },
		tx: DrizzleDB = DB.instance(),
	) {
		const set: Partial<typeof DB.Tables.fileShares.$inferInsert> = { updated_at: Date.now() };
		if (changes.permissions) {
			const permissions = FileShares.normalizePermissions(file, changes.permissions);
			set.can_read = permissions.read;
			set.can_upload = permissions.upload;
			set.can_edit = permissions.edit;
			set.can_delete = permissions.delete;
		}
		if (changes.label !== undefined) set.label = changes.label?.trim() || null;
		if (changes.expires_at !== undefined) set.expires_at = changes.expires_at;
		if (changes.password !== undefined) {
			set.password_hash = changes.password ? await Bun.password.hash(changes.password) : null;
		}

		return await tx
			.update(DB.Tables.fileShares)
			.set(set)
			.where(and(inOrg(DB.Tables.fileShares), eq(DB.Tables.fileShares.id, share.id)))
			.returning()
			.get();
	}

	static async remove(share: DB.Models.FileShare, tx: DrizzleDB = DB.instance()) {
		await tx
			.delete(DB.Tables.fileShares)
			.where(and(inOrg(DB.Tables.fileShares), eq(DB.Tables.fileShares.id, share.id)))
			.run();
	}

	/**
	 * What a link may do on `file`: a file share is read-only or editable (replace contents) — its
	 * contents can't be uploaded into or deleted from, and an upload-only drop box needs a folder.
	 */
	static normalizePermissions(file: DB.Models.File, permissions: FileShares.Permissions) {
		if (file.kind === "file") {
			return { read: true, upload: false, edit: permissions.edit, delete: false };
		}
		const result = { ...permissions };
		if (!result.read && !result.upload) result.read = true;
		return result;
	}

	/** API view of a link for the people managing it. */
	static async views(shares: DB.Models.FileShare[], tx: DrizzleDB = DB.instance()) {
		const users = await UserSummary.fetchMap(
			shares.map((share) => share.created_by),
			tx,
		);
		return shares.map(
			(share): FileShares.View => ({
				id: share.id,
				file_id: share.file_id,
				url: FileShares.url(share.token),
				label: share.label,
				permissions: {
					read: share.can_read,
					upload: share.can_upload,
					edit: share.can_edit,
					delete: share.can_delete,
				},
				has_password: share.password_hash !== null,
				expires_at: share.expires_at,
				expired: FileShares.isExpired(share),
				created_by: share.created_by ? (users.get(share.created_by) ?? null) : null,
				created_at: share.created_at,
				last_accessed_at: share.last_accessed_at,
				access_count: share.access_count,
			}),
		);
	}

	/** Every link of the org with what it points at, for the admins' overview. */
	static async listAll(tx: DrizzleDB = DB.instance()) {
		const shares = await tx
			.select()
			.from(DB.Tables.fileShares)
			.where(inOrg(DB.Tables.fileShares))
			.orderBy(desc(DB.Tables.fileShares.created_at), desc(DB.Tables.fileShares.id))
			.all();
		const fileIds = [...new Set(shares.map((share) => share.file_id))];
		const files = fileIds.length
			? await tx
					.select()
					.from(DB.Tables.files)
					.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.id, fileIds)))
					.all()
			: [];
		const eventIds = [...new Set(files.map((file) => file.event_id).filter((id) => id !== null))];
		const events = eventIds.length
			? await tx
					.select({ id: DB.Tables.events.id, name: DB.Tables.events.name })
					.from(DB.Tables.events)
					.where(and(inOrg(DB.Tables.events), inArray(DB.Tables.events.id, eventIds as number[])))
					.all()
			: [];
		const filesById = new Map(files.map((file) => [file.id, file]));
		const eventsById = new Map(events.map((event) => [event.id, event]));

		const views = await FileShares.views(shares, tx);
		return views.flatMap((view) => {
			const file = filesById.get(view.file_id);
			if (!file) return [];
			const path = FileShares.libraryPath(file);
			return [
				{
					...view,
					file: {
						id: file.id,
						kind: file.kind,
						name: file.name,
						scope: file.scope,
						event: file.event_id ? (eventsById.get(file.event_id) ?? null) : null,
						folder_id: file.kind === "folder" ? file.id : file.parent_id,
						path,
					},
				},
			];
		});
	}

	/** Where the item lives, for links back into the app (`?folder=`). */
	private static libraryPath(file: DB.Models.File) {
		const base = file.scope === "org" ? "/documents" : `/events/${file.event_id}/documents`;
		const folder = file.kind === "folder" ? file.id : file.parent_id;
		return folder ? `${base}?folder=${folder}` : base;
	}

	// --- public access ---------------------------------------------------------------------------

	/**
	 * The active link for `token` with its shared item, or null: unknown in this org, expired,
	 * sharing switched off by the org, or the item is gone.
	 */
	static async resolve(token: string, tx: DrizzleDB = DB.instance()) {
		const org = OrgContext.maybeCurrent();
		if (!org || org.kind !== "org" || !org.file_sharing_enabled) return null;
		if (!/^[A-Za-z0-9]{32}$/.test(token)) return null;

		const share = await tx
			.select()
			.from(DB.Tables.fileShares)
			.where(and(inOrg(DB.Tables.fileShares), eq(DB.Tables.fileShares.token, token)))
			.get();
		if (!share || FileShares.isExpired(share)) return null;

		const root = await FileService.get(share.file_id, tx);
		if (!root || root.scope === "receipt") return null;
		return { share, root };
	}

	/**
	 * `fileId` if it is the shared item or lies below the shared folder, else null. This is the
	 * check that keeps a link inside what it shares.
	 */
	static async resolveInShare(
		root: DB.Models.File,
		fileId: number,
		tx: DrizzleDB = DB.instance(),
	): Promise<DB.Models.File | null> {
		if (fileId === root.id) return root;
		if (root.kind !== "folder") return null;

		const file = await FileService.get(fileId, tx);
		if (!file) return null;
		const path = await FileService.getPath(file.parent_id, tx);
		return path.some((ancestor) => ancestor.id === root.id) ? file : null;
	}

	/** Breadcrumb inside the share: from the shared folder down to `folder`. */
	static async pathInShare(
		root: DB.Models.File,
		folder: DB.Models.File,
		tx: DrizzleDB = DB.instance(),
	) {
		const path = await FileService.getPath(folder.id, tx);
		const start = path.findIndex((entry) => entry.id === root.id);
		return start === -1 ? [] : path.slice(start);
	}

	static async recordAccess(share: DB.Models.FileShare, tx: DrizzleDB = DB.instance()) {
		await tx
			.update(DB.Tables.fileShares)
			.set({
				last_accessed_at: Date.now(),
				access_count: sql`${DB.Tables.fileShares.access_count} + 1`,
			})
			.where(and(inOrg(DB.Tables.fileShares), eq(DB.Tables.fileShares.id, share.id)))
			.run();
	}

	/** Cookie value that unlocks a password-protected link for {@link UNLOCK_TTL_MS}. */
	static unlockValue(share: DB.Models.FileShare, now = Date.now()) {
		const expires = now + UNLOCK_TTL_MS;
		return `${expires}.${FileShares.unlockHash(share, expires)}`;
	}

	static readonly UNLOCK_TTL_SECONDS = UNLOCK_TTL_MS / 1000;

	static isUnlocked(share: DB.Models.FileShare, cookie: string | undefined, now = Date.now()) {
		if (share.password_hash === null) return true;
		if (!cookie) return false;
		const [expiresRaw, hash] = cookie.split(".");
		const expires = Number(expiresRaw);
		if (!hash || !Number.isFinite(expires) || expires <= now) return false;

		const expected = Buffer.from(FileShares.unlockHash(share, expires));
		const given = Buffer.from(hash);
		return expected.length === given.length && timingSafeEqual(expected, given);
	}

	private static unlockHash(share: DB.Models.FileShare, expires: number) {
		return createHash("sha256")
			.update(`${share.token}:${expires}:${share.password_hash ?? ""}`)
			.digest("hex");
	}
}

export namespace FileShares {
	export const Permissions = z.object({
		/** View and download (off: an upload-only drop box, folders only). */
		read: z.boolean(),
		/** Folders: add files and folders. */
		upload: z.boolean(),
		/** Rename items inside the share, replace file contents. */
		edit: z.boolean(),
		/** Delete items inside the shared folder (never the shared item itself). */
		delete: z.boolean(),
	});
	export type Permissions = z.infer<typeof Permissions>;

	export interface Settings {
		permissions: Permissions;
		label?: string | null;
		/** Unix ms; null = never. Omitted on create: the org's default expiry, if any. */
		expires_at?: number | null;
		password?: string | null;
	}

	export const View = z.object({
		id: z.number(),
		file_id: z.number(),
		/** `<org url>/s/<token>` — what gets sent to people. */
		url: z.string(),
		/** Internal note; never shown to the link's visitors. */
		label: z.string().nullable(),
		permissions: Permissions,
		has_password: z.boolean(),
		expires_at: z.number().nullable(),
		expired: z.boolean(),
		created_by: UserSummary.Schema.nullable(),
		created_at: z.number(),
		last_accessed_at: z.number().nullable(),
		access_count: z.number(),
	});
	export type View = z.infer<typeof View>;
}
