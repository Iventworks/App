/**
 * useFileURL — browser URL of a file's contents (`content_url` of every file item).
 *
 * Content paths are checked on every request: the session cookie authenticates them, so
 * `<img src>`, `<a href>` and "open in new tab" work. Share links have their own content paths
 * (`/api/v1/shares/<token>/files/…`) in the same field. `download: true` forces an attachment.
 */
export function useFileURL() {
	const origin = useAPIOrigin();

	return function fileURL(contentUrl: string | null | undefined, download = false) {
		if (!contentUrl) return undefined;
		const url = `${origin}${contentUrl}`;
		return download ? `${url}?download=1` : url;
	};
}
