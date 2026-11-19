/**
 * The calls of one document library for `FilesBrowser` — the org library (`scope: "org"`,
 * `memberView`: as members see it) or one event's documents — with error toasts. Spread the result
 * onto the browser: `<FilesBrowser v-bind="library" … />`.
 */
import type { FileItem, FolderListing, OfficeType, TrashAdapter, TrashItem } from "~/utils/types";

type Source = { scope: "org"; memberView?: boolean } | { scope: "event"; eventId: () => number };

export function useDocumentLibrary(source: Source) {
	const toast = useToast();

	function failed(title: string, message: string) {
		toast.add({ title, description: message, color: "error" });
	}

	async function load(parentId: number | null): Promise<FolderListing | null> {
		const parent_id = parentId ?? undefined;
		const result =
			source.scope === "org"
				? await useAPI((api) =>
						api.getOrgDocuments({
							query: { parent_id, view: source.memberView ? "member" : undefined },
						}),
					)
				: await useAPI((api) =>
						api.getEventsByEventIdFiles({ path: { eventId: source.eventId() }, query: { parent_id } }),
					);
		if (!result.success) {
			failed("Dokumente konnten nicht geladen werden", result.message);
			return null;
		}
		return result.data;
	}

	async function upload(file: File, parentId: number | null) {
		const body = { file, parent_id: parentId ?? undefined };
		const result =
			source.scope === "org"
				? await useAPI((api) => api.postOrgDocuments({ body }))
				: await useAPI((api) =>
						api.postEventsByEventIdFiles({ path: { eventId: source.eventId() }, body }),
					);
		if (!result.success) failed(`„${file.name}“ konnte nicht hochgeladen werden`, result.message);
		return result.success;
	}

	async function createFolder(name: string, parentId: number | null) {
		const body = { name, parent_id: parentId };
		const result =
			source.scope === "org"
				? await useAPI((api) => api.postOrgDocumentsFolders({ body }))
				: await useAPI((api) =>
						api.postEventsByEventIdFilesFolders({ path: { eventId: source.eventId() }, body }),
					);
		if (!result.success) {
			failed("Ordner konnte nicht angelegt werden", fileErrorText(result.message, source.scope));
		}
		return result.success;
	}

	async function createOffice(
		name: string,
		type: OfficeType,
		parentId: number | null,
	): Promise<FileItem | null> {
		const body = { name, type, parent_id: parentId };
		const result =
			source.scope === "org"
				? await useAPI((api) => api.postOrgDocumentsOffice({ body }))
				: await useAPI((api) =>
						api.postEventsByEventIdFilesOffice({ path: { eventId: source.eventId() }, body }),
					);
		if (!result.success) {
			failed("Dokument konnte nicht angelegt werden", result.message);
			return null;
		}
		return result.data;
	}

	const trash: TrashAdapter = {
		async list(): Promise<TrashItem[] | null> {
			const result =
				source.scope === "org"
					? await useAPI((api) => api.getOrgDocumentsTrash({}))
					: await useAPI((api) =>
							api.getEventsByEventIdFilesTrash({ path: { eventId: source.eventId() } }),
						);
			if (!result.success) {
				failed("Papierkorb konnte nicht geladen werden", result.message);
				return null;
			}
			return result.data;
		},
		async restore(fileId: number) {
			const result =
				source.scope === "org"
					? await useAPI((api) => api.postOrgDocumentsTrashByFileIdRestore({ path: { fileId } }))
					: await useAPI((api) =>
							api.postEventsByEventIdFilesTrashByFileIdRestore({
								path: { eventId: source.eventId(), fileId },
							}),
						);
			if (!result.success) {
				failed("Wiederherstellen fehlgeschlagen", fileErrorText(result.message, source.scope));
				return null;
			}
			return result.data as FileItem;
		},
		async purge(fileId: number) {
			const result =
				source.scope === "org"
					? await useAPI((api) => api.deleteOrgDocumentsTrashByFileId({ path: { fileId } }))
					: await useAPI((api) =>
							api.deleteEventsByEventIdFilesTrashByFileId({
								path: { eventId: source.eventId(), fileId },
							}),
						);
			if (!result.success) failed("Löschen fehlgeschlagen", result.message);
			return result.success;
		},
		async empty() {
			const result =
				source.scope === "org"
					? await useAPI((api) => api.deleteOrgDocumentsTrash({}))
					: await useAPI((api) =>
							api.deleteEventsByEventIdFilesTrash({ path: { eventId: source.eventId() } }),
						);
			if (!result.success) failed("Papierkorb konnte nicht geleert werden", result.message);
			return result.success;
		},
	};

	return { load, upload, createFolder, createOffice, trash };
}
