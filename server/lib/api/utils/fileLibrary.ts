import type { DB } from "../../db";
import { FileAccess } from "./fileAccess";
import { FileAccessLists } from "./fileAccessLists";
import { FileLocks } from "./fileLocks";
import { FileService } from "./fileService";

type Failure = { ok: false; status: 400 | 403 | 404; message: string };

/**
 * What the org library and event documents routes share: listing a folder the way the caller sees
 * it, and checking where they may add files and folders. Rename, move, delete, contents, access
 * lists and share links go through `/files/{fileId}`.
 */
export namespace FileLibrary {
	/** A folder (`parentId`; root when undefined) with what the caller may see and do in it. */
	export async function list(
		viewer: FileAccess.Viewer,
		parentId: number | undefined,
	): Promise<{ ok: true; data: FileService.FolderListing } | Failure> {
		const location = viewer.location;
		if (!viewer.inLibrary) {
			return { ok: false, status: 403, message: "You are not allowed to view documents" };
		}

		let folder: DB.Models.File | null = null;
		if (parentId !== undefined) {
			folder = await FileService.get(parentId);
			if (folder?.kind !== "folder" || !FileService.isInLocation(folder, location)) {
				return { ok: false, status: 404, message: "Folder not found" };
			}
		}

		const path = folder
			? await FileService.getPath(folder.id, undefined, new Map([[folder.id, folder]]))
			: [];
		if (FileService.isTrashed(path)) return { ok: false, status: 404, message: "Folder not found" };
		const children = await FileService.listFolder(location, folder?.id ?? null);
		const { permissions, items, entries } = await FileAccess.forFolder(viewer, path, children);
		// Folders the caller can't see don't exist for them.
		if (folder && !permissions.read && !permissions.upload) {
			return { ok: false, status: 404, message: "Folder not found" };
		}

		const visible = items.filter(
			(item) => item.permissions.read || (item.file.kind === "folder" && item.permissions.upload),
		);
		const permissionsOf = new Map(visible.map((item) => [item.file.id, item.permissions]));

		// Managers see who has access: to this folder, and the own lists of the items in it.
		let access: FileService.FolderListing["access"] = null;
		let itemAccess = new Map<number, FileService.Item["access"] & object>();
		if (viewer.manager) {
			access = await FileAccessLists.describe(location, path, entries);
			itemAccess = await FileAccessLists.toEntries(
				visible
					.filter((item) => item.file.custom_access)
					.flatMap((item) => entries.get(item.file.id) ?? []),
			);
		}

		// "Wird in Office bearbeitet"
		const locks = await FileLocks.forFiles(visible.map((item) => item.file.id));

		return {
			ok: true,
			data: {
				folder: folder
					? FileService.toResponse(folder, {
							permissions,
							access: viewer.manager && folder.custom_access ? (access?.entries ?? []) : null,
						})
					: null,
				path: path.map((entry) => FileService.toResponse(entry)),
				items: await FileService.toResponses(
					visible.map((item) => item.file),
					(file) => ({
						permissions: permissionsOf.get(file.id) ?? null,
						access: viewer.manager && file.custom_access ? (itemAccess.get(file.id) ?? []) : null,
						editing: FileLocks.editingOf(locks.get(file.id)),
					}),
				),
				permissions,
				access,
			},
		};
	}

	/** Check that the caller may add something to `parentId` (root when null/undefined). */
	export async function resolveTarget(
		viewer: FileAccess.Viewer,
		parentId: number | null | undefined,
	): Promise<{ ok: true; parentId: number | null } | Failure> {
		const denied: Failure = {
			ok: false,
			status: 403,
			message: "You are not allowed to add documents here",
		};
		if (!viewer.inLibrary) return denied;
		if (parentId === null || parentId === undefined) {
			return FileAccess.rootPermissions(viewer).upload ? { ok: true, parentId: null } : denied;
		}

		const notFound: Failure = { ok: false, status: 400, message: "Parent folder not found" };
		const folder = await FileService.get(parentId);
		if (folder?.kind !== "folder" || !FileService.isInLocation(folder, viewer.location)) {
			return notFound;
		}
		const path = await FileService.getPath(folder.id, undefined, new Map([[folder.id, folder]]));
		const permissions = await FileAccess.evaluateFile(viewer, folder, path);
		if (!permissions.read && !permissions.upload) return notFound;
		return permissions.upload ? { ok: true, parentId: folder.id } : denied;
	}

	/** A newly created item with the caller's permissions on it. */
	export async function created(viewer: FileAccess.Viewer, file: DB.Models.File) {
		return FileService.toResponse(file, { permissions: await FileAccess.evaluateFile(viewer, file) });
	}
}
