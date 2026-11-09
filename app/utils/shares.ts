import type { SharePermissions } from "~/utils/types";

/** Short name of what a share link allows, matching the presets of the share dialog. */
export function sharePermissionLabel(
	permissions: SharePermissions,
	kind: "file" | "folder",
): string {
	const { read, upload, edit, delete: del } = permissions;
	if (!read && upload) return "Nur hochladen";
	if (kind === "file") return edit ? "Bearbeiten" : "Nur ansehen";
	if (del) return "Vollzugriff";
	if (edit) return "Bearbeiten";
	if (upload) return "Ansehen & hochladen";
	return "Nur ansehen";
}
