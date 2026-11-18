/**
 * Which in-app preview a file gets (`FilesPreview`). Decided by the stored MIME type and the
 * extension. Images only for the types the API serves inline (no SVG: it is only ever downloaded).
 */
export type FilePreviewKind = "image" | "pdf" | "markdown" | "csv" | "text" | "office" | "none";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const TEXT_EXTENSIONS = new Set(["txt", "log", "json", "xml", "yaml", "yml", "ini", "ics", "vcf"]);
const OFFICE_EXTENSIONS = new Set([
	"doc",
	"docx",
	"odt",
	"rtf",
	"xls",
	"xlsx",
	"ods",
	"ppt",
	"pptx",
	"odp",
]);

/** Text files larger than this are not previewed (they are downloaded instead). */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export function fileExtension(name: string) {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function filePreviewKind(
	name: string,
	mimeType: string | null | undefined,
): FilePreviewKind {
	const mime = (mimeType ?? "").toLowerCase();
	const ext = fileExtension(name);

	if (IMAGE_TYPES.has(mime)) return "image";
	if (mime === "application/pdf" || ext === "pdf") return "pdf";
	if (mime === "text/markdown" || ext === "md" || ext === "markdown") return "markdown";
	if (mime === "text/csv" || ext === "csv") return "csv";
	if (mime === "text/plain" || TEXT_EXTENSIONS.has(ext)) return "text";
	if (OFFICE_EXTENSIONS.has(ext)) return "office";
	return "none";
}

/**
 * Rows of a CSV text (comma or semicolon, whichever the first line uses more; quotes with `""`
 * escapes). At most `maxRows` rows.
 */
export function parseCsv(text: string, maxRows = 1000): string[][] {
	const lineEnd = text.indexOf("\n");
	const firstLine = lineEnd === -1 ? text : text.slice(0, lineEnd);
	const delimiter =
		(firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === delimiter) {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			rows.push(row);
			row = [];
			if (rows.length >= maxRows) return rows;
		} else {
			field += char;
		}
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}
