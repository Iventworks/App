/**
 * Files the browser saves: a name part from a title and the download itself (exports, PDFs,
 * QR codes).
 */

/**
 * A file name part from a title: lower case, ASCII, dashes — umlauts spelled out
 * ("Rückmeldung für Teamer" → "rueckmeldung-fuer-teamer").
 */
export function fileSlug(title: string, fallback: string) {
	return (
		title
			.normalize("NFC")
			.toLowerCase()
			.replace(/ä/g, "ae")
			.replace(/ö/g, "oe")
			.replace(/ü/g, "ue")
			.replace(/ß/g, "ss")
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || fallback
	);
}

/**
 * Save a Blob as a file. The link sits in the page and its address lives on for a minute: some
 * browsers (Safari, Firefox) start the download only after `click()` returns.
 */
export function downloadBlob(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
