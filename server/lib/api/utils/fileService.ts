import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import { FILE_SCOPES } from "../../db/schema";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileStorage } from "../../utils/fileStorage";
import { Logger } from "../../utils/logger";
import { CollabState } from "./collabState";
import { FileVersions } from "./fileVersions";
import { FileAccessModel } from "./shared-models/fileAccess";

/** Locks down inline responses: no script, no plugins, no requests to anywhere. */
const INLINE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

/** `Content-Disposition` with an ASCII fallback and the RFC 5987 UTF-8 file name. */
function contentDisposition(type: "inline" | "attachment", name: string) {
	const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
	return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Documents, folders and receipts on top of `FileStorage` (blobs) and the `files` table.
 *
 * File contents are plain paths with an access check on every request:
 * `GET /files/{fileId}/content/{name}` for signed-in people (the session cookie is accepted there,
 * so `<img src>`, links and new tabs work), `GET /shares/{token}/files/{fileId}/content/{name}`
 * for share links. Every item carries its `content_url`.
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

	static readonly MARKDOWN_MIME_TYPE = "text/markdown";

	static isInlineSafe(mimeType: string | null | undefined) {
		return Boolean(mimeType && FileService.INLINE_MIME_TYPES.has(mimeType.toLowerCase()));
	}

	// --- contents ------------------------------------------------------------------------------

	/** Path of a file's contents for signed-in people; the name only labels the tab and download. */
	static contentPath(file: Pick<DB.Models.File, "id" | "name">) {
		return `/api/v1/files/${file.id}/content/${encodeURIComponent(file.name)}`;
	}

	/**
	 * The file's bytes as a response. Only allow-listed types are rendered by the browser; anything
	 * else (SVG, HTML, …) goes out as opaque bytes so it can never run script on the app origin.
	 * Never cached by shared caches: access is checked on every request.
	 */
	static async contentResponse(file: DB.Models.File, options: { download?: boolean } = {}) {
		if (file.kind !== "file" || !file.storage_key) return null;

		const blob = FileStorage.open(file.storage_key);
		if (!(await blob.exists())) {
			Logger.error(`Stored blob for file ${file.id} is missing (${file.storage_key})`);
			return null;
		}

		const safe = FileService.isInlineSafe(file.mime_type);
		const inline = !options.download && safe;
		const headers: Record<string, string> = {
			"Content-Type": safe ? (file.mime_type as string) : "application/octet-stream",
			"Content-Length": String(blob.size),
			"Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
		};
		// Chrome refuses to render PDFs in sandboxed documents; PDFs cannot run page script anyway.
		if (inline && file.mime_type !== "application/pdf") {
			headers["Content-Security-Policy"] = INLINE_CSP;
		}
		return new Response(blob, { status: 200, headers });
	}

	// --- reads -------------------------------------------------------------------------------

	static async get(fileId: number, tx: DrizzleDB = DB.instance()) {
		return (
			(await tx
				.select()
				.from(DB.Tables.files)
				.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, fileId)))
				.get()) ?? null
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
					inOrg(DB.Tables.files),
					eq(DB.Tables.files.scope, location.scope),
					location.eventId === null
						? isNull(DB.Tables.files.event_id)
						: eq(DB.Tables.files.event_id, location.eventId),
					parentId === null
						? isNull(DB.Tables.files.parent_id)
						: eq(DB.Tables.files.parent_id, parentId),
					// The Papierkorb is listed on its own (`FileTrash`).
					isNull(DB.Tables.files.deleted_at),
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

	/** Whether something on the path (root → item) is in the Papierkorb. */
	static isTrashed(path: readonly Pick<DB.Models.File, "deleted_at">[]) {
		return path.some((entry) => entry.deleted_at !== null);
	}

	/** Whether the file or a folder above it is in the Papierkorb. */
	static async isInTrash(file: DB.Models.File, tx: DrizzleDB = DB.instance()) {
		if (file.deleted_at !== null) return true;
		if (file.parent_id === null) return false;
		return FileService.isTrashed(await FileService.getPath(file.parent_id, tx));
	}

	/** The library a file belongs to. */
	static locationOf(file: Pick<DB.Models.File, "scope" | "event_id">): FileService.Location {
		return { scope: file.scope, eventId: file.event_id ?? null };
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
		/** null: added through a share link. */
		userId: number | null,
		tx: DrizzleDB = DB.instance(),
	) {
		return await tx
			.insert(DB.Tables.files)
			.values({
				org_id: OrgContext.id(),
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
		/** null: uploaded through a share link. */
		userId: number | null,
		tx: DrizzleDB = DB.instance(),
	) {
		if (file.size > FileStorage.maxUploadBytes) return null;

		const { storageKey, size } = await FileStorage.save(file);

		try {
			return await tx
				.insert(DB.Tables.files)
				.values({
					org_id: OrgContext.id(),
					scope: location.scope,
					event_id: location.eventId,
					parent_id: parentId,
					kind: "file",
					name: FileService.sanitizeName(file.name || "Datei"),
					mime_type: file.type || "application/octet-stream",
					size,
					storage_key: storageKey,
					uploaded_by: userId,
					modified_by: userId,
				})
				.returning()
				.get();
		} catch (error) {
			await FileStorage.remove([storageKey]);
			throw error;
		}
	}

	/** A new Markdown document (`.md` is added to the name when missing). */
	static async createMarkdown(
		location: FileService.Location,
		parentId: number | null,
		name: string,
		content: string,
		userId: number,
	) {
		const cleaned = FileService.sanitizeName(name);
		const fileName = /\.(md|markdown)$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
		const file = new File([content], fileName, { type: FileService.MARKDOWN_MIME_TYPE });
		return await FileService.upload(location, parentId, file, userId);
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
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, file.id)))
			.returning()
			.get();
	}

	/** Ids among `fileIds` with at least one share link that hasn't expired (the "geteilt" icon). */
	static async sharedIds(fileIds: number[], tx: DrizzleDB = DB.instance()): Promise<Set<number>> {
		if (fileIds.length === 0) return new Set();
		const rows = await tx
			.selectDistinct({ file_id: DB.Tables.fileShares.file_id })
			.from(DB.Tables.fileShares)
			.where(
				and(
					inOrg(DB.Tables.fileShares),
					inArray(DB.Tables.fileShares.file_id, fileIds),
					or(isNull(DB.Tables.fileShares.expires_at), gt(DB.Tables.fileShares.expires_at, Date.now())),
				),
			)
			.all();
		return new Set(rows.map((row) => row.file_id));
	}

	/**
	 * Items for a listing, with the "shared" flag looked up in one query. `extra` adds the caller's
	 * permissions and (for managers) the item's own access list.
	 */
	static async toResponses(
		files: DB.Models.File[],
		extra: (file: DB.Models.File) => Omit<FileService.ResponseOptions, "shared"> = () => ({}),
		tx: DrizzleDB = DB.instance(),
	) {
		const shared = await FileService.sharedIds(
			files.map((file) => file.id),
			tx,
		);
		return files.map((file) =>
			FileService.toResponse(file, { ...extra(file), shared: shared.has(file.id) }),
		);
	}

	/**
	 * Replace a file's contents (same row, new blob). The old contents become a version
	 * (`FileVersions`). `userId` null: through a share link. Returns null when the upload is too
	 * large.
	 */
	static async replaceContent(
		file: DB.Models.File,
		upload: Blob,
		userId: number | null,
		/**
		 * `keepCollab`: written by the shared Markdown editing session itself. `session`: several
		 * people save in turns (shared editing, the office server) — versions per interval, not
		 * per author (default: `keepCollab`).
		 */
		options: { keepCollab?: boolean; session?: boolean } = {},
	) {
		if (upload.size > FileStorage.maxUploadBytes) return null;
		const { storageKey, size } = await FileStorage.save(upload);
		let updated: DB.Models.File;
		try {
			updated = await FileVersions.replace(
				file,
				{ storageKey, size, mimeType: upload.type || file.mime_type || "application/octet-stream" },
				userId,
				{ session: options.session ?? options.keepCollab },
			);
		} catch (error) {
			await FileStorage.remove([storageKey]);
			throw error;
		}
		// Contents from outside: a shared editing state of the old text is worthless now.
		if (!options.keepCollab) await CollabState.discard(file.id);
		return updated;
	}

	/** Save text as the new contents (the shared Markdown editor). */
	static async replaceText(
		file: DB.Models.File,
		text: string,
		userId: number,
		options: { keepCollab?: boolean } = {},
	) {
		const mimeType = FileService.isMarkdownName(file.name)
			? FileService.MARKDOWN_MIME_TYPE
			: (file.mime_type ?? "text/plain");
		return await FileService.replaceContent(
			file,
			new Blob([text], { type: mimeType }),
			userId,
			options,
		);
	}

	static isMarkdownName(name: string) {
		return /\.(md|markdown)$/i.test(name);
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

	/** Delete a file or a folder with everything below it, including the blobs on disk (and versions). */
	static async deleteRecursive(file: DB.Models.File, tx: DrizzleDB = DB.instance()) {
		const ids: number[] = [file.id];
		const storageKeys: (string | null)[] = [file.storage_key];

		let frontier = file.kind === "folder" ? [file.id] : [];
		while (frontier.length > 0) {
			const children = await tx
				.select()
				.from(DB.Tables.files)
				.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.parent_id, frontier)))
				.all();
			ids.push(...children.map((child) => child.id));
			storageKeys.push(...children.map((child) => child.storage_key));
			frontier = children.filter((child) => child.kind === "folder").map((child) => child.id);
		}

		storageKeys.push(...(await FileVersions.storageKeys(ids, tx)));

		// Children go via ON DELETE CASCADE; deleting them explicitly keeps it correct even if
		// foreign keys were ever disabled.
		await tx
			.delete(DB.Tables.files)
			.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.id, ids)))
			.run();
		await FileStorage.remove(storageKeys);
	}

	/** Remove every blob that belongs to an event (call before deleting the event). */
	static async deleteAllForEvent(eventId: number, tx: DrizzleDB = DB.instance()) {
		const rows = await tx
			.select({ id: DB.Tables.files.id, storage_key: DB.Tables.files.storage_key })
			.from(DB.Tables.files)
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.event_id, eventId)))
			.all();
		const versionKeys = await FileVersions.storageKeys(
			rows.map((row) => row.id),
			tx,
		);
		await tx
			.delete(DB.Tables.files)
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.event_id, eventId)))
			.run();
		await FileStorage.remove([...rows.map((row) => row.storage_key), ...versionKeys]);
	}

	static sanitizeName(name: string) {
		const cleaned = name
			.replace(/[\\/\0]/g, "_")
			.replace(/[\r\n\t]/g, " ")
			.trim()
			.slice(0, 200);
		return cleaned || "Unbenannt";
	}

	static toResponse(
		file: DB.Models.File,
		options: FileService.ResponseOptions = {},
	): FileService.Item {
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
			content_url: file.kind === "file" ? FileService.contentPath(file) : null,
			shared: options.shared ?? false,
			custom_access: file.custom_access,
			permissions: options.permissions ?? null,
			access: options.access ?? null,
			editing: options.editing ?? null,
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
		scope: z.enum(FILE_SCOPES),
		event_id: z.number().nullable(),
		parent_id: z.number().nullable(),
		kind: z.enum(["folder", "file"]),
		name: z.string(),
		mime_type: z.string().nullable(),
		size: z.number(),
		uploaded_by: z.number().nullable(),
		created_at: z.number(),
		updated_at: z.number(),
		/**
		 * `GET` path of the contents (null for folders). Opens in the browser — the session cookie
		 * authenticates it — or with the `Authorization` header; `?download=1` forces a download.
		 */
		content_url: z.string().nullable(),
		/** Has a share link for people without an account (listings only; false elsewhere). */
		shared: z.boolean(),
		/** Has its own access list instead of its folder's (org and event documents). */
		custom_access: z.boolean(),
		/** What the caller may do with it (listings and uploads of org and event documents). */
		permissions: FileAccessModel.Permissions.nullable(),
		/** Its own access list — only for managers and only on items with `custom_access`. */
		access: z.array(FileAccessModel.Entry).nullable(),
		/** Someone is editing it right now (listings and the file page). */
		editing: z
			.object({
				/** `editor`: a shared Markdown editing session; `office`: the office server. */
				kind: z.enum(["editor", "office"]),
				/** Who is in it (editor sessions). */
				users: z.array(z.object({ id: z.number(), display_name: z.string() })),
				expires_at: z.number(),
			})
			.nullable(),
	});
	export type Item = z.infer<typeof ItemSchema>;

	export interface ResponseOptions {
		shared?: boolean;
		permissions?: FileAccessModel.Permissions | null;
		access?: FileAccessModel.Entry[] | null;
		editing?: Item["editing"];
	}

	/** Folder listing with breadcrumb path. */
	export const FolderListingSchema = z.object({
		folder: ItemSchema.nullable(),
		path: z.array(ItemSchema),
		items: z.array(ItemSchema),
		/** What the caller may do in this folder (the root when `folder` is null). */
		permissions: FileAccessModel.Permissions,
		/** Who has access to this folder and where that comes from — managers only. */
		access: FileAccessModel.View.nullable(),
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

	export const CreateMarkdownBody = z.object({
		/** `.md` is added when missing. */
		name: z.string().trim().min(1).max(200),
		parent_id: z.number().int().positive().nullable().optional(),
	});
	export type CreateMarkdownBody = z.infer<typeof CreateMarkdownBody>;

	export const ListQuery = z.object({
		parent_id: z.coerce.number().int().positive().optional(),
		/**
		 * `member`: list as a member sees it — managers get no extra rights (the org library's
		 * member view at `/documents`).
		 */
		view: z.enum(["member"]).optional(),
	});
	export type ListQuery = z.infer<typeof ListQuery>;
}
