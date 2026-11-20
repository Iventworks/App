/**
 * New office documents ("Neu → Textdokument / Tabelle / Präsentation") start as empty files (0
 * bytes), the WOPI way of creating documents: when the editor opens an empty file, the office
 * server writes its own template into it (PutFile) — in the editor's language (`ui=de-DE`), so new
 * documents are German (text language for spell checking, A4, styles).
 */
export namespace OfficeTemplates {
	export const TYPES = ["docx", "xlsx", "pptx"] as const;
	export type Type = (typeof TYPES)[number];

	export const MIME_TYPES: Record<Type, string> = {
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	};
}
