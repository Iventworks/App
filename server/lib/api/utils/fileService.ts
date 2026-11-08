import { createHmac, timingSafeEqual } from "crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { LCrypt } from "../../utils/crypto/lcrypt";
import { FileStorage } from "../../utils/fileStorage";

/**
 * Documents, folders and receipts on top of `FileStorage` (blobs) and the `files` table.
 *
 * Downloads use short-lived signed tokens instead of bearer auth, so the browser can open them
 * directly (`<img src>`, `<a href download>`, PDFs in a new tab): list endpoints return
 * `download_token`, the frontend builds `<appUrl>/api/v1/files/download/<token>`.
 */
export class FileService {
	/**
	 * MIME types the browser may render inline from our origin. Everything else — notably
	 * `image/svg+xml`, HTML and XML, which can carry script — is only ever served as a download
	 * (`application/octet-stream`, `Content-Disposition: attachment`). Uploaded `type`s are
	 * client-controlled, so this allow-list is what keeps uploads from becoming stored XSS.
	 */
	static readonly INLINE_MIME_TYPES: ReadonlySet<string> = new Set([
		"image/png",
		"image/jpeg",
		"image/gif",
		"image/webp",
		"image/avif",
		"application/pdf",
		"text/plain",
	]);

	/** Receipt uploads: photos and PDFs only. */
	static readonly RECEIPT_MIME_TYPES: ReadonlySet<string> = new Set([
		"image/png",
		"image/jpeg",
		"image/gif",
		"image/webp",
		"image/avif",
		"image/heic",
		"image/heif",
		"application/pdf",
	]);

	static isInlineSafe(mimeType: string | null | undefined) {
		return Boolean(mimeType && FileService.INLINE_MIME_TYPES.has(mimeType.toLowerCase()));
	}

	/** Per-process HMAC key; links simply expire on restart. */
	protected static readonly SIGNING_KEY = LCrypt.randomBytes(32);
	static readonly DOWNLOAD_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

	// --- download tokens -------------------------------------------------------------------

	protected static sign(payload: string) {
		return createHmac("sha256", FileService.SIGNING_KEY).update(payload).digest("base64url");
	}

	static createDownloadToken(fileId: number, ttlMs = FileService.DOWNLOAD_TOKEN_TTL_MS) {
		const payload = `${fileId}.${Date.now() + ttlMs}`;
		return `${payload}.${FileService.sign(payload)}`;
	}

	/** Returns the file id for a valid, unexpired token, otherwise null. */
	static verifyDownloadToken(token: string): number | null {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const [fileIdRaw, expiresRaw, signature] = parts as [string, string, string];

		const expected = Buffer.from(FileService.sign(`${fileIdRaw}.${expiresRaw}`));
		const given = Buffer.from(signature);
		if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

		const fileId = Number(fileIdRaw);
		const expires = Number(expiresRaw);
		if (!Number.isInteger(fileId) || !Number.isFinite(expires) || expires < Date.now()) {
			return null;
		}
		return fileId;
	}

	// --- reads -------------------------------------------------------------------------------

	static async get(fileId: number, tx: DrizzleDB = DB.instance()) {
		return (
			(await tx.select().from(DB.Tables.files).where(eq(DB.Tables.files.id, fileId)).get()) ?? null
		);
	}

	/** Children of a folder (or the root when `parentId` is null) within a scope. */
	static async listFolder(
		location: FileService.Location,
		parentId: number | null,
		tx: DrizzleDB = DB.instance(),
	) {
		return await tx
			.select()
			.from(DB.Tables.files)
			.where(
				and(
					eq(DB.Tables.files.scope, location.scope),
					location.eventId === null
						? isNull(DB.Tables.files.event_id)
						: eq(DB.Tables.files.event_id, location.eventId),
					parentId === null
						? isNull(DB.Tables.files.parent_id)
						: eq(DB.Tables.files.parent_id, parentId),
				),
			)
			// Folders first ("folder" > "file"), then by name.
			.orderBy(desc(DB.Tables.files.kind), asc(DB.Tables.files.name))
			.all();
	}

	/** Folder chain from the root down to (and including) `folderId`, for breadcrumbs. */
	static async getPath(folderId: number | null, tx: DrizzleDB = DB.instance()) {
		const path: DB.Models.File[] = [];
		let currentId = folderId;
		// Bounded walk: protects against accidental cycles.
		for (let depth = 0; currentId !== null && depth < 64; depth++) {
			const folder = await FileService.get(currentId, tx);
			if (!folder) break;
			path.unshift(folder);
			currentId = folder.parent_id;
		}
		return path;
	}

	static isInLocation(file: DB.Models.File, location: FileService.Location) {
		return file.scope === location.scope && (file.event_id ?? null) === location.eventId;
	}

	/** Validate that `parentId` is a folder inside `location` (null = root is always valid). */
	static async resolveParent(
		location: FileService.Location,
		parentId: number | null | undefined,
		tx: DrizzleDB = DB.instance(),
	): Promise<{ ok: true; parentId: number | null } | { ok: false; message: string }> {
		if (parentId === null || parentId === undefined) return { ok: true, parentId: null };
		const parent = await FileService.get(parentId, tx);
		if (!parent || !FileService.isInLocation(parent, location) || parent.kind !== "folder") {
			return { ok: false, message: "Parent folder not found" };
		}
		return { ok: true, parentId: parent.id };
	}

	// --- writes ------------------------------------------------------------------------------

	static async createFolder(
		location: FileService.Location,
		parentId: number | null,
		name: string,
		userId: number,
		tx: DrizzleDB = DB.instance(),
	) {
		return await tx
			.insert(DB.Tables.files)
			.values({
				scope: location.scope,
				event_id: location.eventId,
				parent_id: parentId,
				kind: "folder",
				name,
				uploaded_by: userId,
			})
			.returning()
			.get();
	}

	/**
	 * Store an uploaded blob and create its row. Returns `null` when the file is too large.
	 */
	static async upload(
		location: FileService.Location,
		parentId: number | null,
		file: File,
		userId: number,
		tx: DrizzleDB = DB.instance(),
	) {
		if (file.size > FileStorage.maxUploadBytes) return null;

		const { storageKey, size } = await FileStorage.save(file);

		try {
			return await tx
				.insert(DB.Tables.files)
				.values({
					scope: location.scope,
					event_id: location.eventId,
					parent_id: parentId,
					kind: "file",
					name: FileService.sanitizeName(file.name || "Datei"),
					mime_type: file.type || "application/octet-stream",
					size,
					storage_key: storageKey,
					uploaded_by: userId,
				})
				.returning()
				.get();
		} catch (error) {
			await FileStorage.remove([storageKey]);
			throw error;
		}
	}

	static async update(
		file: DB.Models.File,
		changes: { name?: string; parent_id?: number | null },
		tx: DrizzleDB = DB.instance(),
	) {
		return await tx
			.update(DB.Tables.files)
			.set({
				...(changes.name !== undefined ? { name: FileService.sanitizeName(changes.name) } : {}),
				...(changes.parent_id !== undefined ? { parent_id: changes.parent_id } : {}),
				updated_at: Date.now(),
			})
			.where(eq(DB.Tables.files.id, file.id))
			.returning()
			.get();
	}

	/** True when `candidateId` is `folderId` itself or one of its descendants (move guard). */
	static async isDescendantOrSelf(
		folderId: number,
		candidateId: number,
		tx: DrizzleDB = DB.instance(),
	) {
		const path = await FileService.getPath(candidateId, tx);
		return path.some((entry) => entry.id === folderId);
	}

	/** Delete a file or a folder with everything below it, including the blobs on disk. */
	static async deleteRecursive(file: DB.Models.File, tx: DrizzleDB = DB.instance()) {
		const ids: number[] = [file.id];
		const storageKeys: (string | null)[] = [file.storage_key];

		let frontier = file.kind === "folder" ? [file.id] : [];
		while (frontier.length > 0) {
			const children = await tx
				.select()
				.from(DB.Tables.files)
				.where(inArray(DB.Tables.files.parent_id, frontier))
				.all();
			ids.push(...children.map((child) => child.id));
			storageKeys.push(...children.map((child) => child.storage_key));
			frontier = children.filter((child) => child.kind === "folder").map((child) => child.id);
		}

		// Children go via ON DELETE CASCADE; deleting them explicitly keeps it correct even if
		// foreign keys were ever disabled.
		await tx.delete(DB.Tables.files).where(inArray(DB.Tables.files.id, ids)).run();
		await FileStorage.remove(storageKeys);
	}

	/** Remove every blob that belongs to an event (call before deleting the event). */
	static async deleteAllForEvent(eventId: number, tx: DrizzleDB = DB.instance()) {
		const rows = await tx
			.select({ storage_key: DB.Tables.files.storage_key })
			.from(DB.Tables.files)
			.where(eq(DB.Tables.files.event_id, eventId))
			.all();
		await tx.delete(DB.Tables.files).where(eq(DB.Tables.files.event_id, eventId)).run();
		await FileStorage.remove(rows.map((row) => row.storage_key));
	}

	static sanitizeName(name: string) {
		const cleaned = name
			.replace(/[\\/\0]/g, "_")
			.replace(/[\r\n\t]/g, " ")
			.trim()
			.slice(0, 200);
		return cleaned || "Unbenannt";
	}

	static toResponse(file: DB.Models.File): FileService.Item {
		return {
			id: file.id,
			scope: file.scope,
			event_id: file.event_id,
			parent_id: file.parent_id,
			kind: file.kind,
			name: file.name,
			mime_type: file.mime_type,
			size: file.size,
			uploaded_by: file.uploaded_by,
			created_at: file.created_at,
			updated_at: file.updated_at,
			download_token: file.kind === "file" ? FileService.createDownloadToken(file.id) : null,
		};
	}
}

export namespace FileService {
	export interface Location {
		scope: DB.Models.File["scope"];
		/** null for the organisation library. */
		eventId: number | null;
	}

	export const ItemSchema = z.object({
		id: z.number(),
		scope: z.enum(["org", "event", "receipt"]),
		event_id: z.number().nullable(),
		parent_id: z.number().nullable(),
		kind: z.enum(["folder", "file"]),
		name: z.string(),
		mime_type: z.string().nullable(),
		size: z.number(),
		uploaded_by: z.number().nullable(),
		created_at: z.number(),
		updated_at: z.number(),
		/** Signed, short-lived token for `GET /files/download/{token}` (null for folders). */
		download_token: z.string().nullable(),
	});
	export type Item = z.infer<typeof ItemSchema>;

	/** Folder listing with breadcrumb path. */
	export const FolderListingSchema = z.object({
		folder: ItemSchema.nullable(),
		path: z.array(ItemSchema),
		items: z.array(ItemSchema),
	});
	export type FolderListing = z.infer<typeof FolderListingSchema>;

	export const UploadForm = z.object({
		file: z.file().describe("The file to upload"),
		parent_id: z.coerce.number().int().positive().optional(),
	});
	export type UploadForm = z.infer<typeof UploadForm>;

	export const CreateFolderBody = z.object({
		name: z.string().trim().min(1).max(200),
		parent_id: z.number().int().positive().nullable().optional(),
	});
	export type CreateFolderBody = z.infer<typeof CreateFolderBody>;

	export const ListQuery = z.object({
		parent_id: z.coerce.number().int().positive().optional(),
	});
	export type ListQuery = z.infer<typeof ListQuery>;
}
