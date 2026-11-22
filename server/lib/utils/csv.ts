/**
 * CSV for spreadsheets (Excel, LibreOffice with German settings): `;`-separated, UTF-8 with BOM,
 * CRLF. Pure — the server's participants export and the browser's export of form answers use it.
 */
export namespace Csv {
	export type Cell = string | number | boolean | null | undefined;

	/**
	 * One cell: numbers with a decimal comma (all their digits), yes/no as "ja"/"nein". Text that a
	 * spreadsheet would run as a formula gets a leading `'` — cells hold what anyone typed.
	 */
	export function cell(value: Cell): string {
		if (value === null || value === undefined) return "";
		if (typeof value === "number") return String(value).replace(".", ",");
		let text = typeof value === "boolean" ? (value ? "ja" : "nein") : value;
		if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
		if (/[";\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
		return text;
	}

	/** The whole file: rows of cells (the first one the header). */
	export function table(rows: Cell[][]): string {
		return `﻿${rows.map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
	}
}
