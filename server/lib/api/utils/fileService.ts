import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import { FILE_SCOPES } from "../../db/schema";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileStorage } from "../../utils/fileStorage";
import { Logger } from "../../utils/logger";
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
	 * Images the browser may show from our origin (by their stored type). Not `image/svg+xml`: it
	 * can carry script. Uploaded `type`s are client-controlled, so this allow-list (with
	 * `displayAs`) is what keeps uploads from becoming stored XSS.
	 */
	static readonly IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
		"image/png",
		"image/jpeg",
		"image/gif",
		"image/webp",
		"image/avif",
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

	static isImage(mimeType: string | null | undefined) {
		return Boolean(mimeType && FileService.IMAGE_MIME_TYPES.has(mimeType.toLowerCase()));
	}

	// --- contents ------------------------------------------------------------------------------

	/** Path of a file's contents for signed-in people; the name only labels the tab and download. */
	static contentPath(file: Pick<DB.Models.File, "id" | "name">) {
		return `/api/v1/files/${file.id}/content/${encodeURIComponent(file.name)}`;
	}

	/**
	 * Text formats shown in the browser as plain text (never as HTML, XML or script): by type or,
	 * since uploads often come without a precise type, by extension.
	 */
	static readonly TEXT_MIME_TYPES: ReadonlySet<string> = new Set([
		"text/plain",
		"text/markdown",
		"text/x-markdown",
		"text/csv",
		"text/calendar",
		"text/vcard",
		"text/x-vcard",
		"text/yaml",
		"application/yaml",
		"application/x-yaml",
		"application/json",
		"application/xml",
		"text/xml",
	]);
	static readonly TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
		"txt",
		"md",
		"markdown",
		"csv",
		"log",
		"json",
		"xml",
		"yaml",
		"yml",
		"ini",
		"ics",
		"vcf",
	]);

	/**
	 * How the browser may show a file from our origin, or null: only as a download. Images by their
	 * stored type, PDFs (by type or extension) when they start like one, text formats always as
	 * `text/plain`. SVG, HTML and anything else never render here: uploaded types are
	 * client-controlled, so this is what keeps uploads from becoming stored XSS.
	 */
	static async displayAs(
		file: Pick<DB.Models.File, "name" | "mime_type">,
		blob: Blob,
	): Promise<"image" | "pdf" | "text" | null> {
		const mime = (file.mime_type ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
		const dot = file.name.lastIndexOf(".");
		const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
		if (FileService.IMAGE_MIME_TYPES.has(mime)) return "image";
		if (mime === "application/pdf" || ext === "pdf") {
			// A PDF starts with "%PDF-" (within its first kilobyte).
			const head = new TextDecoder("latin1").decode(await blob.slice(0, 1024).arrayBuffer());
			return head.includes("%PDF-") ? "pdf" : null;
		}
		if (FileService.TEXT_MIME_TYPES.has(mime) || FileService.TEXT_EXTENSIONS.has(ext)) return "text";
		return null;
	}

	/**
	 * The file's bytes as a response (`displayAs`: what the browser may show; everything else goes
	 * out as opaque bytes for download). Text and images get a sandbox policy. PDFs get none but
	 * `frame-ancestors 'self'`: the browsers' own PDF viewers don't run under a restrictive policy,
	 * run the PDF in their own sandbox, and our pages embed them. Never cached by shared caches:
	 * access is checked on every request.
	 */
	static async contentResponse(file: DB.Models.File, options: { download?: boolean } = {}) {
		if (file.kind !== "file" || !file.storage_key) return null;

		const blob = FileStorage.open(file.storage_key);
		if (!(await blob.exists())) {
			Logger.error(`Stored blob for file ${file.id} is missing (${file.storage_key})`);
			return null;
		}

		const display = await FileService.displayAs(file, blob);
		const inline = !options.download && display !== null;
		const contentType =
			display === "text"
				? "text/plain; charset=utf-8"
				: display === "pdf"
					? "application/pdf"
					: display === "image"
						? (file.mime_type as string)
						: "application/octet-stream";
		const headers: Record<string, string> = {
			"Content-Type": contentType,
			"Content-Length": String(blob.size),
			"Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.name),
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
		};
		if (inline && display === "pdf") {
			// Replaces the API's "nothing may frame this" (the security-headers middleware).
			headers["Content-Security-Policy"] = "frame-ancestors 'self'";
			headers["X-Frame-Options"] = "SAMEORIGIN";
		} else if (inline) {
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

	/**
	 * Folder chain from the root down to (and including) `folderId`, for breadcrumbs and the access
	 * walk. `cache`: rows already loaded (by id), shared between several walks. Throws when the chain
	 * is longer than any valid one (`MAX_DEPTH`): an incomplete chain would skip the access lists
	 * above it.
	 */
	static async getPath(
		folderId: number | null,
		tx: DrizzleDB = DB.instance(),
		cache?: Map<number, DB.Models.File>,
	) {
		const path: DB.Models.File[] = [];
		let currentId = folderId;
		for (let depth = 0; currentId !== null; depth++) {
			if (depth > FileService.MAX_DEPTH * 2) {
				throw new Error(`Folder chain of file ${folderId} is too deep (or a cycle)`);
			}
			const folder = cache?.get(currentId) ?? (await FileService.get(currentId, tx));
			if (!folder) break;
			cache?.set(folder.id, folder);
			path.unshift(folder);
			currentId = folder.parent_id;
		}
		return path;
	}

	/** Folders nest at most this deep (the top level is 1). */
	static readonly MAX_DEPTH = 30;
	static readonly TOO_DEEP =
		`Folders can't be nested more than ${FileService.MAX_DEPTH} levels deep`;

	/**
	 * Whether a folder fits into `parentId` (null = the top level), with `levelsBelow` levels of
	 * folders inside it (moving a folder).
	 */
	static async fitsDepth(parentId: number | null, levelsBelow = 0, tx: DrizzleDB = DB.instance()) {
		const depth = parentId === null ? 0 : (await FileService.getPath(parentId, tx)).length;
		return depth + 1 + levelsBelow <= FileService.MAX_DEPTH;
	}

	/**
	 * Everything below a folder, level by level (`[0]`: its children). `skipTrashed`: leave out
	 * what is in the Papierkorb, with what is inside it.
	 */
	static async descendantLevels(
		folderId: number,
		options: { skipTrashed?: boolean } = {},
		tx: DrizzleDB = DB.instance(),
	) {
		const levels: DB.Models.File[][] = [];
		let frontier = [folderId];
		while (frontier.length > 0 && levels.length <= FileService.MAX_DEPTH * 2) {
			let children = await tx
				.select()
				.from(DB.Tables.files)
				.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.parent_id, frontier)))
				.all();
			if (options.skipTrashed) children = children.filter((child) => child.deleted_at === null);
			if (children.length === 0) break;
			levels.push(children);
			frontier = children.filter((child) => child.kind === "folder").map((child) => child.id);
		}
		return levels;
	}

	/** How many levels of folders lie inside a folder (0 for a file or an empty folder). */
	static async folderLevelsBelow(file: DB.Models.File, tx: DrizzleDB = DB.instance()) {
		if (file.kind !== "folder") return 0;
		const levels = await FileService.descendantLevels(file.id, {}, tx);
		return levels.filter((level) => level.some((entry) => entry.kind === "folder")).length;
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

	/**
	 * A new office document (Word, Excel, PowerPoint; the extension is added when missing). It
	 * starts as an empty file, the WOPI way: the office server fills an empty file with its own
	 * template when the editor opens it (PutFile) — in the editor's language (`ui=de-DE`), so new
	 * documents are German (spell checking, A4, styles).
	 */
	static async createOffice(
		location: FileService.Location,
		parentId: number | null,
		name: string,
		type: FileService.OfficeType,
		userId: number,
	) {
		const file = new File([], FileService.withExtension(name, type), {
			type: FileService.OFFICE_MIME_TYPES[type],
		});
		// Empty: never over the upload limit.
		return (await FileService.upload(location, parentId, file, userId)) as DB.Models.File;
	}

	/**
	 * A clean file name that ends in `.ext` (added when missing), within the name length — a long
	 * name is shortened, not its extension.
	 */
	static withExtension(name: string, ext: string) {
		const cleaned = FileService.sanitizeName(name);
		if (cleaned.toLowerCase().endsWith(`.${ext}`)) return cleaned;
		const base = cleaned.slice(0, FileService.MAX_NAME_LENGTH - ext.length - 1).trimEnd();
		return `${base || "Unbenannt"}.${ext}`;
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
		 * `session`: several people save in turns (the office server) — versions per interval, not
		 * per author.
		 */
		options: { session?: boolean } = {},
	) {
		if (upload.size > FileStorage.maxUploadBytes) return null;
		const { storageKey, size } = await FileStorage.save(upload);
		let updated: DB.Models.File;
		try {
			updated = await FileVersions.replace(
				file,
				{ storageKey, size, mimeType: upload.type || file.mime_type || "application/octet-stream" },
				userId,
				{ session: options.session },
			);
		} catch (error) {
			await FileStorage.remove([storageKey]);
			throw error;
		}
		return updated;
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

	static readonly MAX_NAME_LENGTH = 200;

	static sanitizeName(name: string) {
		const cleaned = name
			.replace(/[\\/\0]/g, "_")
			.replace(/[\r\n\t]/g, " ")
			.trim()
			.slice(0, FileService.MAX_NAME_LENGTH);
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
		/** Someone has it open in the office editor, for editing (listings and the file page). */
		editing: z.object({ expires_at: z.number() }).nullable(),
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

	/** New office documents ("Neu → Textdokument / Tabelle / Präsentation", `createOffice`). */
	export const OFFICE_TYPES = ["docx", "xlsx", "pptx"] as const;
	export type OfficeType = (typeof OFFICE_TYPES)[number];
	export const OFFICE_LABELS: Record<OfficeType, string> = {
		docx: "Textdokument",
		xlsx: "Tabelle",
		pptx: "Präsentation",
	};
	export const OFFICE_MIME_TYPES: Record<OfficeType, string> = {
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	};

	export const CreateOfficeBody = z.object({
		/** The extension is added when missing. */
		name: z.string().trim().min(1).max(200),
		type: z.enum(OFFICE_TYPES),
		parent_id: z.number().int().positive().nullable().optional(),
	});
	export type CreateOfficeBody = z.infer<typeof CreateOfficeBody>;

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
