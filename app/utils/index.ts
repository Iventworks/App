export namespace Utils {
	/** Copy text to the clipboard; resolves to false when the browser refuses. */
	export async function copyToClipboard(text: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	/** Lucide icon for a file by MIME type / extension. */
	export function getFileIcon(name: string, mimeType?: string | null): string {
		const mime = mimeType ?? "";
		if (mime.startsWith("image/")) return "i-lucide-file-image";
		if (mime === "application/pdf") return "i-lucide-file-text";
		if (mime.startsWith("video/")) return "i-lucide-file-video";
		if (mime.startsWith("audio/")) return "i-lucide-file-audio";

		const ext = name.split(".").pop()?.toLowerCase() ?? "";
		const byExtension: Record<string, string> = {
			pdf: "i-lucide-file-text",
			doc: "i-lucide-file-text",
			docx: "i-lucide-file-text",
			odt: "i-lucide-file-text",
			txt: "i-lucide-file-text",
			md: "i-lucide-file-text",
			ppt: "i-lucide-presentation",
			pptx: "i-lucide-presentation",
			odp: "i-lucide-presentation",
			key: "i-lucide-presentation",
			xls: "i-lucide-file-spreadsheet",
			xlsx: "i-lucide-file-spreadsheet",
			ods: "i-lucide-file-spreadsheet",
			csv: "i-lucide-file-spreadsheet",
			zip: "i-lucide-file-archive",
			rar: "i-lucide-file-archive",
			"7z": "i-lucide-file-archive",
			mp3: "i-lucide-file-audio",
			wav: "i-lucide-file-audio",
			mp4: "i-lucide-file-video",
			mov: "i-lucide-file-video",
		};
		return byExtension[ext] ?? "i-lucide-file";
	}
}
