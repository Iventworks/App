/**
 * "Neue Fassung hochladen" and "Version wiederherstellen" for one file, with the confirmation and
 * the toasts — shared by the file browsers, the "Versionen" dialog and the file page. Both are
 * refused while the file is open for editing in Office. Call it in `setup`; `uploading` and
 * `restoring` (the version's id) belong to the calling component.
 */
import type { FileItem, FileVersion } from "~/utils/types";

type Target = Pick<FileItem, "id" | "name" | "scope">;

export function useFileVersions() {
	const toast = useToast();
	const confirm = useConfirmDialog();

	const uploading = ref(false);
	const restoring = ref<number | null>(null);

	/** Replace the contents of `file` with `upload` (the old contents become a version). */
	async function uploadNewVersion(file: Target, upload: File) {
		uploading.value = true;
		const result = await useAPI((api) =>
			api.putFilesByFileIdContent({ path: { fileId: file.id }, body: { file: upload } }),
		);
		uploading.value = false;
		if (!result.success) {
			toast.add({
				title: "Neue Fassung nicht hochgeladen",
				description: fileErrorText(result.message, libraryScopeOf(file)),
				color: "error",
			});
			return false;
		}
		toast.add({
			title: `Neue Fassung von „${file.name}“ hochgeladen`,
			color: "success",
			icon: "i-lucide-check",
		});
		return true;
	}

	/** Ask, then make `version` the current contents again (the current ones stay as a version). */
	async function restoreVersion(file: Target, version: FileVersion) {
		const choice = await confirm({
			title: "Version wiederherstellen?",
			description: `Die Fassung vom ${formatDate(version.modified_at)} wird wieder die aktuelle. Die jetzige bleibt als Version erhalten.`,
			icon: "i-lucide-history",
			confirmLabel: "Wiederherstellen",
			confirmIcon: "i-lucide-history",
		});
		if (choice !== "confirm") return false;

		restoring.value = version.id;
		const result = await useAPI((api) =>
			api.postFilesByFileIdVersionsByVersionIdRestore({
				path: { fileId: file.id, versionId: version.id },
			}),
		);
		restoring.value = null;
		if (!result.success) {
			toast.add({
				title: "Wiederherstellen fehlgeschlagen",
				description: fileErrorText(result.message, libraryScopeOf(file)),
				color: "error",
			});
			return false;
		}
		toast.add({ title: "Version wiederhergestellt", color: "success", icon: "i-lucide-check" });
		return true;
	}

	return { uploading, restoring, uploadNewVersion, restoreVersion };
}
