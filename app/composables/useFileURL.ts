/**
 * useFileURL — browser URL for a file's signed download token (`GET /files/download/{token}`).
 *
 * List endpoints return a short-lived `download_token` per file, so `<img src>`, `<a href>` and
 * "open in new tab" work without the bearer header. `download: true` forces an attachment.
 */
export function useFileURL() {
	const appUrl = useRuntimeAppConfigs().appUrl.replace(/\/$/, "");

	return function fileURL(token: string | null | undefined, download = false) {
		if (!token) return undefined;
		const url = `${appUrl}/api/v1/files/download/${encodeURIComponent(token)}`;
		return download ? `${url}?download=1` : url;
	};
}
