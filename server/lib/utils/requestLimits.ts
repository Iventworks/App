/**
 * How large a request body may be. File uploads (`multipart/form-data`) follow
 * `IVENTWORKS_MAX_UPLOAD_SIZE_MB` (plus room for the multipart framing); every other request —
 * JSON, forms — gets a small fixed limit. Checked in the Bun server entry (`server/runtime/bun.ts`)
 * before the body is read into memory.
 */
export namespace RequestLimits {
	const MB = 1024 * 1024;

	/** JSON bodies: the largest text field is 100 000 characters (notes); this leaves plenty of room. */
	export const DEFAULT_BYTES = 2 * MB;

	/** Multipart framing around the file: boundaries, part headers, other small fields. */
	const MULTIPART_OVERHEAD_BYTES = 1 * MB;

	/**
	 * Read from the env, not the ConfigHandler: the server entry needs it before the startup plugin
	 * has loaded the config. Same fallback as the ConfigHandler (`CMP_*` before the rename).
	 */
	export function uploadBytes(env: Record<string, string | undefined> = process.env): number {
		const raw = env.IVENTWORKS_MAX_UPLOAD_SIZE_MB ?? env.CMP_MAX_UPLOAD_SIZE_MB;
		const megabytes = Number(raw);
		return (
			(Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 25) * MB + MULTIPART_OVERHEAD_BYTES
		);
	}

	export function limitFor(headers: Headers, uploadLimit: number): number {
		const type = headers.get("content-type")?.toLowerCase() ?? "";
		return type.startsWith("multipart/form-data") ? uploadLimit : DEFAULT_BYTES;
	}

	export function tooLarge(limit: number): Response {
		return new Response(
			JSON.stringify({
				success: false,
				code: 413,
				message: `Request body too large (at most ${Math.floor(limit / MB)} MB)`,
			}),
			{ status: 413, headers: { "Content-Type": "application/json", Connection: "close" } },
		);
	}

	/**
	 * The body, or null when it exceeds `limit`. A declared Content-Length is checked before reading;
	 * a chunked body is read up to the limit and dropped beyond it.
	 */
	export async function readBody(request: Request, limit: number): Promise<ArrayBuffer | null> {
		const declared = Number(request.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > 0) {
			return declared > limit ? null : await request.arrayBuffer();
		}
		if (!request.body) return new ArrayBuffer(0);

		const reader = request.body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel().catch(() => {});
				return null;
			}
			chunks.push(value);
		}
		const body = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return body.buffer;
	}
}
