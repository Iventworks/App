import { and, eq, inArray } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg } from "../../orgs/context";
import type { AuthHandler } from "./authHandler";
import { ConversationAccess } from "./conversations";
import { EventAccess } from "./eventAccess";
import { FileService } from "./fileService";
import { PermissionHelper } from "./permissions";

const NO_RIGHTS: FileAccess.Rights = { read: false, upload: false, edit: false, delete: false };
const NONE: FileAccess.Permissions = { ...NO_RIGHTS, rename: false, manage: false };
const FULL: FileAccess.Permissions = {
	read: true,
	upload: true,
	edit: true,
	delete: true,
	rename: true,
	manage: true,
};

/**
 * Who may do what with a row of the `files` table.
 *
 * Org and event documents ("libraries") have access lists, like Team folders in Nextcloud:
 * - **Managers** — the Kernteam for org documents (`org_documents:write`), the Leitung for event
 *   documents (`files:manage_all`, which includes the Kernteam) — may do everything, including
 *   changing access and creating share links.
 * - Everyone else gets the rights of the nearest access list above an item (`custom_access` +
 *   `file_access`: read, upload, edit, delete — the rights of share links). Without one, the
 *   library's default applies: org documents are Kernteam-only, event documents are open to the
 *   whole team (read + upload, `files:view` / `files:upload`).
 * - An item is only visible when every folder above it can be opened (read). A folder you may
 *   only upload into ("Nur hochladen") shows up, its contents don't.
 * - An item with its own access list is only renamed, moved or deleted by managers — and so is a
 *   folder that holds one (`hasCustomAccessBelow`).
 * - Own uploads may be renamed, moved, replaced and deleted while you may still add things where
 *   they are.
 *
 * `receipt` files: read by the expense's submitter and `expenses:review` in that event; renamed or
 * deleted like the expense is changed (reviewers, the submitter while it is `submitted`); their
 * contents are only replaced through the expense. `message` files (chat attachments): everyone in
 * the chat may read them; before they are sent only the uploader. They are never written through
 * the file routes.
 */
export class FileAccess {
	// --- the caller in a library --------------------------------------------------------------

	/**
	 * The caller as one library sees them. `asMember`: evaluate managers like everyone else (the
	 * member view of the org library); only ever lowers rights. `eventAccess`: the access the event
	 * loader resolved already.
	 */
	static async viewer(
		authContext: AuthHandler.AuthContext,
		location: FileService.Location,
		options: { asMember?: boolean; eventAccess?: PermissionHelper.EventAccess } = {},
	): Promise<FileAccess.Viewer | null> {
		if (authContext.type === "unauthenticated") return null;

		if (location.scope === "org") {
			const canRead = PermissionHelper.can({ authContext, permission: "org_documents:read" });
			const memberships = canRead
				? await DB.instance()
						.select({ group_id: DB.Tables.orgGroupMembers.group_id })
						.from(DB.Tables.orgGroupMembers)
						.where(
							and(
								inOrg(DB.Tables.orgGroupMembers),
								eq(DB.Tables.orgGroupMembers.user_id, authContext.user_id),
							),
						)
						.all()
				: [];
			return {
				userId: authContext.user_id,
				location,
				inLibrary: canRead,
				manager:
					!options.asMember && PermissionHelper.can({ authContext, permission: "org_documents:write" }),
				root: NO_RIGHTS,
				isOrgMember: canRead,
				isTeamMember: false,
				orgGroupIds: new Set(memberships.map((row) => row.group_id)),
				eventGroupIds: new Set(),
			};
		}

		if (location.scope === "event" && location.eventId !== null) {
			const eventId = location.eventId;
			const access = options.eventAccess ?? (await EventAccess.resolve(authContext, eventId));
			const can = (permission: PermissionHelper.EventPermission) =>
				PermissionHelper.canInEvent({ access, permission });
			const memberships = access.membership
				? await DB.instance()
						.select({ group_id: DB.Tables.eventGroupMembers.group_id })
						.from(DB.Tables.eventGroupMembers)
						.innerJoin(
							DB.Tables.eventGroups,
							and(
								inOrg(DB.Tables.eventGroups),
								eq(DB.Tables.eventGroups.id, DB.Tables.eventGroupMembers.group_id),
							),
						)
						.where(
							and(
								inOrg(DB.Tables.eventGroupMembers),
								eq(DB.Tables.eventGroupMembers.user_id, authContext.user_id),
								eq(DB.Tables.eventGroups.event_id, eventId),
							),
						)
						.all()
				: [];
			return {
				userId: authContext.user_id,
				location,
				inLibrary: can("files:view"),
				manager: !options.asMember && can("files:manage_all"),
				root: { read: can("files:view"), upload: can("files:upload"), edit: false, delete: false },
				isOrgMember: false,
				isTeamMember: Boolean(access.membership),
				orgGroupIds: new Set(),
				eventGroupIds: new Set(memberships.map((row) => row.group_id)),
			};
		}

		return null;
	}

	// --- evaluation ---------------------------------------------------------------------------

	/** Access lists of the given items (only those with `custom_access` have one). */
	static async loadEntries(
		files: readonly Pick<DB.Models.File, "id" | "custom_access">[],
	): Promise<Map<number, DB.Models.FileAccessEntry[]>> {
		const ids = [...new Set(files.filter((file) => file.custom_access).map((file) => file.id))];
		const map = new Map<number, DB.Models.FileAccessEntry[]>();
		if (ids.length === 0) return map;
		const rows = await DB.instance()
			.select()
			.from(DB.Tables.fileAccess)
			.where(and(inOrg(DB.Tables.fileAccess), inArray(DB.Tables.fileAccess.file_id, ids)))
			.all();
		for (const row of rows) {
			const list = map.get(row.file_id) ?? [];
			list.push(row);
			map.set(row.file_id, list);
		}
		return map;
	}

	static matches(viewer: FileAccess.Viewer, entry: DB.Models.FileAccessEntry) {
		switch (entry.principal) {
			case "members":
				return viewer.location.scope === "org" && viewer.isOrgMember;
			case "team":
				return viewer.location.scope === "event" && viewer.isTeamMember;
			case "org_group":
				return entry.org_group_id !== null && viewer.orgGroupIds.has(entry.org_group_id);
			case "event_group":
				return entry.event_group_id !== null && viewer.eventGroupIds.has(entry.event_group_id);
			case "user":
				return entry.user_id === viewer.userId;
			default:
				return false;
		}
	}

	/** Everything the matching entries of an access list allow together. */
	static rightsFrom(
		viewer: FileAccess.Viewer,
		entries: readonly DB.Models.FileAccessEntry[],
	): FileAccess.Rights {
		const rights = { ...NO_RIGHTS };
		for (const entry of entries) {
			if (!FileAccess.matches(viewer, entry)) continue;
			rights.read ||= entry.can_read;
			rights.upload ||= entry.can_upload;
			rights.edit ||= entry.can_edit;
			rights.delete ||= entry.can_delete;
		}
		return rights;
	}

	/** The rights inside an item, given the rights of its parent folder. */
	static rightsBelow(
		viewer: FileAccess.Viewer,
		item: Pick<DB.Models.File, "id" | "custom_access">,
		parentRights: FileAccess.Rights,
		entries: Map<number, DB.Models.FileAccessEntry[]>,
	) {
		return item.custom_access
			? FileAccess.rightsFrom(viewer, entries.get(item.id) ?? [])
			: parentRights;
	}

	/** Turn the rights that apply to an item into what the caller may do with it. */
	static permissionsOf(
		viewer: FileAccess.Viewer,
		item: DB.Models.File,
		rights: FileAccess.Rights,
		parentRights: FileAccess.Rights,
	): FileAccess.Permissions {
		if (!viewer.inLibrary) return NONE;
		if (viewer.manager) return FULL;

		const visible = rights.read || (item.kind === "folder" && rights.upload);
		if (!visible) return NONE;

		const own =
			item.uploaded_by === viewer.userId &&
			!item.custom_access &&
			parentRights.read &&
			parentRights.upload;
		return {
			read: rights.read,
			upload: item.kind === "folder" && rights.upload,
			edit: rights.edit || (own && item.kind === "file"),
			delete: own || (rights.delete && !item.custom_access),
			rename: own || (rights.edit && !item.custom_access),
			manage: false,
		};
	}

	/**
	 * What the caller may do with the last item of `path` (root → item). `null` rights: a folder
	 * above it can't be opened.
	 */
	static walk(
		viewer: FileAccess.Viewer,
		path: readonly DB.Models.File[],
		entries: Map<number, DB.Models.FileAccessEntry[]>,
	): { rights: FileAccess.Rights; parentRights: FileAccess.Rights } | null {
		let rights = viewer.root;
		let parentRights = viewer.root;
		for (const [index, item] of path.entries()) {
			// The root can always be listed; every folder below it must be readable.
			if (index > 0 && !rights.read) return null;
			parentRights = rights;
			rights = FileAccess.rightsBelow(viewer, item, rights, entries);
		}
		return { rights, parentRights };
	}

	/** What the caller may do with `item`, whose chain of folders is `path` (root → item). */
	static evaluate(
		viewer: FileAccess.Viewer,
		path: readonly DB.Models.File[],
		entries: Map<number, DB.Models.FileAccessEntry[]>,
	): FileAccess.Permissions {
		const item = path.at(-1);
		if (!item || !viewer.inLibrary) return NONE;
		if (viewer.manager) return FULL;
		const result = FileAccess.walk(viewer, path, entries);
		return result ? FileAccess.permissionsOf(viewer, item, result.rights, result.parentRights) : NONE;
	}

	/** The library's root as a folder: what the caller may do at the top level. */
	static rootPermissions(viewer: FileAccess.Viewer): FileAccess.Permissions {
		if (!viewer.inLibrary) return NONE;
		if (viewer.manager) return FULL;
		return { ...NONE, read: true, upload: viewer.root.upload };
	}

	/** Permissions of `folder` (null = the root) and of each of its children. */
	static async forFolder(
		viewer: FileAccess.Viewer,
		folderPath: readonly DB.Models.File[],
		children: readonly DB.Models.File[],
	) {
		const entries = await FileAccess.loadEntries([...folderPath, ...children]);
		const folder = folderPath.at(-1) ?? null;

		let folderPermissions: FileAccess.Permissions;
		let inside: FileAccess.Rights | null;
		if (viewer.manager && viewer.inLibrary) {
			folderPermissions = FULL;
			inside = { read: true, upload: true, edit: true, delete: true };
		} else if (!folder) {
			folderPermissions = FileAccess.rootPermissions(viewer);
			inside = viewer.inLibrary ? viewer.root : null;
		} else {
			const result = viewer.inLibrary ? FileAccess.walk(viewer, folderPath, entries) : null;
			folderPermissions = result
				? FileAccess.permissionsOf(viewer, folder, result.rights, result.parentRights)
				: NONE;
			inside = result?.rights ?? null;
		}

		const items = children.map((child) => ({
			file: child,
			permissions:
				// Children are listed only when the folder itself can be opened.
				inside && (inside.read || !folder)
					? viewer.manager
						? FULL
						: FileAccess.permissionsOf(
								viewer,
								child,
								FileAccess.rightsBelow(viewer, child, inside, entries),
								inside,
							)
					: NONE,
		}));

		return { permissions: folderPermissions, items, entries };
	}

	/**
	 * Load the folder chain of `file` and evaluate it. Nothing is allowed on items in the
	 * Papierkorb (or below a folder in it) — that goes through `FileTrash`. `path`: the chain
	 * (root → file), when the caller loaded it already.
	 */
	static async evaluateFile(
		viewer: FileAccess.Viewer,
		file: DB.Models.File,
		path?: readonly DB.Models.File[],
	) {
		if (!viewer.inLibrary) return NONE;
		const chain = path ?? (await FileService.getPath(file.id));
		if (FileService.isTrashed(chain)) return NONE;
		if (viewer.manager) return FULL;
		return FileAccess.evaluate(viewer, chain, await FileAccess.loadEntries(chain));
	}

	/**
	 * What the caller may do with `file`. Org and event documents follow their access lists
	 * (`path`: their chain root → file, when loaded already); receipts and chat attachments have
	 * fixed rules.
	 */
	static async permissionsFor(
		authContext: AuthHandler.AuthContext,
		file: DB.Models.File,
		path?: readonly DB.Models.File[],
	): Promise<FileAccess.Permissions> {
		if (authContext.type === "unauthenticated") return NONE;

		switch (file.scope) {
			case "org":
			case "event": {
				if (file.scope === "event" && file.event_id === null) return NONE;
				const viewer = await FileAccess.viewer(authContext, FileService.locationOf(file));
				return viewer ? await FileAccess.evaluateFile(viewer, file, path) : NONE;
			}
			case "receipt":
				// Its contents are only replaced through the expense (`…/expenses/{id}/receipt`).
				switch (await FileAccess.receiptAccess(authContext, file)) {
					case "modify":
						return { ...NONE, read: true, delete: true, rename: true };
					case "read":
						return { ...NONE, read: true };
					default:
						return NONE;
				}
			case "message":
				return (await FileAccess.canReadAttachment(authContext, file)) ? { ...NONE, read: true } : NONE;
			default:
				return NONE;
		}
	}

	/**
	 * Ids of the org and event documents among `files` the caller can open, e.g. a program item's
	 * attachments, which may come from the event and from the org library. `eventAccess`: the
	 * access the event loader resolved, for files of that event.
	 */
	static async readableIds(
		authContext: AuthHandler.AuthContext,
		files: readonly DB.Models.File[],
		options: { eventAccess?: PermissionHelper.EventAccess & { eventId: number } } = {},
	): Promise<Set<number>> {
		const documents = files.filter((file) => file.scope === "org" || file.scope === "event");
		// Shared folders are loaded once, their access lists in one query.
		const rows = new Map<number, DB.Models.File>();
		const paths = new Map<number, DB.Models.File[]>();
		for (const file of documents) {
			if (!paths.has(file.id)) paths.set(file.id, await FileService.getPath(file.id, undefined, rows));
		}
		const entries = await FileAccess.loadEntries([...rows.values()]);

		const readable = new Set<number>();
		const viewers = new Map<string, FileAccess.Viewer | null>();
		for (const file of documents) {
			const location = FileService.locationOf(file);
			const key = `${location.scope}:${location.eventId ?? ""}`;
			if (!viewers.has(key)) {
				const eventAccess =
					location.scope === "event" && options.eventAccess?.eventId === location.eventId
						? options.eventAccess
						: undefined;
				viewers.set(key, await FileAccess.viewer(authContext, location, { eventAccess }));
			}
			const viewer = viewers.get(key);
			const path = paths.get(file.id) ?? [];
			if (!viewer?.inLibrary || FileService.isTrashed(path)) continue;
			if (viewer.manager || FileAccess.evaluate(viewer, path, entries).read) readable.add(file.id);
		}
		return readable;
	}

	/**
	 * Whether a folder holds items with their own access list (not counting the Papierkorb). Only
	 * managers delete or move those, so only they delete or move such a folder.
	 */
	static async hasCustomAccessBelow(file: DB.Models.File) {
		if (file.kind !== "folder") return false;
		const levels = await FileService.descendantLevels(file.id, { skipTrashed: true });
		return levels.some((level) => level.some((entry) => entry.custom_access));
	}

	// --- fixed rules ----------------------------------------------------------------------------

	protected static async canReadAttachment(
		authContext: AuthHandler.AuthenticatedAuthContext,
		file: DB.Models.File,
	) {
		if (file.conversation_id === null) return false;
		if (file.message_id === null) return file.uploaded_by === authContext.user_id;

		const conversation = await DB.instance()
			.select()
			.from(DB.Tables.conversations)
			.where(and(inOrg(DB.Tables.conversations), eq(DB.Tables.conversations.id, file.conversation_id)))
			.get();
		return Boolean(
			conversation &&
				ConversationAccess.canAccess(conversation, authContext.user_id, authContext.user_role),
		);
	}

	/**
	 * A receipt, like its expense: reviewers may change it any time, the submitter only while the
	 * expense is still `submitted` (afterwards they can still open it).
	 */
	protected static async receiptAccess(
		authContext: AuthHandler.AuthenticatedAuthContext,
		file: DB.Models.File,
	): Promise<"none" | "read" | "modify"> {
		if (!PermissionHelper.hasOrgRole(authContext.user_role, "volunteer")) return "none";

		const expense = await DB.instance()
			.select()
			.from(DB.Tables.expenses)
			.where(and(inOrg(DB.Tables.expenses), eq(DB.Tables.expenses.receipt_file_id, file.id)))
			.get();

		const eventId = expense?.event_id ?? file.event_id;
		const access = eventId !== null ? await EventAccess.resolve(authContext, eventId) : null;
		const can = (permission: PermissionHelper.EventPermission) =>
			access !== null && PermissionHelper.canInEvent({ access, permission });

		if (can("expenses:review")) return "modify";
		if (expense && expense.submitted_by === authContext.user_id) {
			return expense.status === "submitted" && can("expenses:submit") ? "modify" : "read";
		}
		return "none";
	}
}

export namespace FileAccess {
	/** What an access list entry (or a share link) grants. */
	export interface Rights {
		read: boolean;
		upload: boolean;
		edit: boolean;
		delete: boolean;
	}

	/**
	 * What the caller may do with one item: `read` (open, download; a folder: list it), `upload`
	 * (folders: add files and folders), `edit` (files: replace contents), `rename`, `delete` (also
	 * needed to move it), `manage` (access lists and share links).
	 */
	export interface Permissions extends Rights {
		rename: boolean;
		manage: boolean;
	}

	export interface Viewer {
		readonly userId: number;
		readonly location: FileService.Location;
		/** May use the library at all (list its root). */
		readonly inLibrary: boolean;
		/** Kernteam (org) / Leitung (event): everything, always. */
		readonly manager: boolean;
		/** Rights at the top level without an access list. */
		readonly root: Rights;
		/** Matches `members` (org documents). */
		readonly isOrgMember: boolean;
		/** Matches `team`: actually on the event's team. */
		readonly isTeamMember: boolean;
		readonly orgGroupIds: ReadonlySet<number>;
		readonly eventGroupIds: ReadonlySet<number>;
	}
}
