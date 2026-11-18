/** The toolbar of the Markdown editors (notes, announcements, documents). */
import type { EditorToolbarItem } from "@nuxt/ui";

export const MARKDOWN_TOOLBAR_ITEMS: EditorToolbarItem[][] = [
	[
		{ kind: "heading", level: 2, icon: "i-lucide-heading-2", tooltip: { text: "Überschrift" } },
		{
			kind: "heading",
			level: 3,
			icon: "i-lucide-heading-3",
			tooltip: { text: "Zwischenüberschrift" },
		},
	],
	[
		{ kind: "mark", mark: "bold", icon: "i-lucide-bold", tooltip: { text: "Fett" } },
		{ kind: "mark", mark: "italic", icon: "i-lucide-italic", tooltip: { text: "Kursiv" } },
		{
			kind: "mark",
			mark: "strike",
			icon: "i-lucide-strikethrough",
			tooltip: { text: "Durchgestrichen" },
		},
		{ kind: "link", icon: "i-lucide-link", tooltip: { text: "Link" } },
	],
	[
		{ kind: "bulletList", icon: "i-lucide-list", tooltip: { text: "Liste" } },
		{ kind: "orderedList", icon: "i-lucide-list-ordered", tooltip: { text: "Nummerierte Liste" } },
		{ kind: "taskList", icon: "i-lucide-list-checks", tooltip: { text: "Checkliste" } },
		{ kind: "blockquote", icon: "i-lucide-text-quote", tooltip: { text: "Zitat" } },
	],
	[
		{ kind: "undo", icon: "i-lucide-undo", tooltip: { text: "Rückgängig" } },
		{ kind: "redo", icon: "i-lucide-redo", tooltip: { text: "Wiederholen" } },
	],
];
