/**
 * Rights presets shared by share links and access lists of documents ("Nur ansehen", "Ansehen &
 * hochladen", …) and labels for who has access. Files only take "Nur ansehen" or "Bearbeiten".
 */
import type { FileAccessEntry, FileAccessRights, FileItem } from "~/utils/types";

/** Keys of the presets below; folders and files share "view". */
export type RightsPresetKey = "view" | "upload" | "edit" | "full" | "dropbox" | "file-edit";

export interface RightsPreset {
	key: RightsPresetKey;
	label: string;
	description: string;
	icon: string;
	permissions: FileAccessRights;
}

export const FOLDER_RIGHTS_PRESETS: RightsPreset[] = [
	{
		key: "view",
		label: "Nur ansehen",
		description: "Ansehen und herunterladen",
		icon: "i-lucide-eye",
		permissions: { read: true, upload: false, edit: false, delete: false },
	},
	{
		key: "upload",
		label: "Ansehen & hochladen",
		description: "Dazu Dateien und Ordner hinzufügen",
		icon: "i-lucide-upload",
		permissions: { read: true, upload: true, edit: false, delete: false },
	},
	{
		key: "edit",
		label: "Bearbeiten",
		description: "Dazu umbenennen und Dateien ersetzen",
		icon: "i-lucide-pencil",
		permissions: { read: true, upload: true, edit: true, delete: false },
	},
	{
		key: "full",
		label: "Vollzugriff",
		description: "Dazu Dateien und Ordner löschen",
		icon: "i-lucide-shield",
		permissions: { read: true, upload: true, edit: true, delete: true },
	},
	{
		key: "dropbox",
		label: "Nur hochladen",
		description: "Briefkasten: hochladen, ohne den Inhalt zu sehen",
		icon: "i-lucide-inbox",
		permissions: { read: false, upload: true, edit: false, delete: false },
	},
];

export const FILE_RIGHTS_PRESETS: RightsPreset[] = [
	{
		key: "view",
		label: "Nur ansehen",
		description: "Ansehen und herunterladen",
		icon: "i-lucide-eye",
		permissions: { read: true, upload: false, edit: false, delete: false },
	},
	{
		key: "file-edit",
		label: "Bearbeiten",
		description: "Dazu eine neue Fassung hochladen",
		icon: "i-lucide-pencil",
		permissions: { read: true, upload: false, edit: true, delete: false },
	},
];

/** Which document library: the org's (managed by the Kernteam) or one event's (the Leitung). */
export type LibraryScope = "org" | "event";

/** The library a document belongs to (`scope` of a file item). */
export function libraryScopeOf(item: { scope: string }): LibraryScope {
	return item.scope === "event" ? "event" : "org";
}

/**
 * Who manages a library and always has full access: the Kernteam (org documents) or the Leitung
 * (event documents). `name` for labels ("Nur Kernteam"), `the` / `The` with the article ("nur das
 * Kernteam", "Die Leitung hat …").
 */
export function managersOf(scope: LibraryScope) {
	return scope === "org"
		? { name: "Kernteam", the: "das Kernteam", The: "Das Kernteam" }
		: { name: "Leitung", the: "die Leitung", The: "Die Leitung" };
}

export function rightsPresetsFor(kind: FileItem["kind"] | undefined) {
	return kind === "folder" ? FOLDER_RIGHTS_PRESETS : FILE_RIGHTS_PRESETS;
}

export function rightsPresetFor(
	kind: FileItem["kind"] | undefined,
	rights: FileAccessRights,
): RightsPreset | undefined {
	return rightsPresetsFor(kind).find(
		(preset) =>
			preset.permissions.read === rights.read &&
			preset.permissions.upload === rights.upload &&
			preset.permissions.edit === rights.edit &&
			preset.permissions.delete === rights.delete,
	);
}

/** "Nur ansehen", or the flags for an unusual combination. */
export function rightsLabel(kind: FileItem["kind"] | undefined, rights: FileAccessRights) {
	const preset = rightsPresetFor(kind, rights);
	if (preset) return preset.label;
	if (!rights.read) return "Nur hochladen";
	return [
		"Ansehen",
		rights.upload && "hochladen",
		rights.edit && "bearbeiten",
		rights.delete && "löschen",
	]
		.filter(Boolean)
		.join(", ");
}

export function accessEntryIcon(entry: Pick<FileAccessEntry, "principal">) {
	switch (entry.principal) {
		case "members":
			return "i-lucide-building-2";
		case "team":
			return "i-lucide-contact";
		case "org_group":
		case "event_group":
			return "i-lucide-users-round";
		default:
			return "i-lucide-user";
	}
}

/** What the caller may do in a folder, as a sentence for people who don't manage it. */
export function ownRightsSentence(permissions: {
	read: boolean;
	upload: boolean;
	edit: boolean;
	delete: boolean;
}) {
	if (!permissions.read && permissions.upload) {
		return "Du kannst hier nur hochladen – den Inhalt siehst du nicht.";
	}
	if (permissions.delete) return "Du kannst hier ansehen, hochladen, bearbeiten und löschen.";
	if (permissions.edit) return "Du kannst hier ansehen, hochladen und bearbeiten.";
	if (permissions.upload) return "Du kannst hier ansehen und hochladen.";
	return "Du kannst hier nur ansehen.";
}
