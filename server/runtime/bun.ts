/**
 * The Bun server entry — Nitro's `bun` preset entry (nitropack/dist/presets/bun/runtime/bun.mjs)
 * plus request size limits: Nitro's own entry reads every body into memory first, up to Bun's
 * default 128 MB, before any of our code runs. Here an oversized body is refused with 413 before
 * it is read, uploads may be as large as `IVENTWORKS_MAX_UPLOAD_SIZE_MB`, everything else up to
 * `RequestLimits.DEFAULT_BYTES`.
 */
// Nitro's own virtual modules: they only resolve inside Nitro's build.
// @ts-ignore
import "#nitro-internal-pollyfills";
import { useNitroApp } from "nitropack/runtime";
// @ts-ignore
import { startScheduleRunner } from "nitropack/runtime/internal";
import { RequestLimits } from "../lib/utils/requestLimits";

const nitroApp = useNitroApp();
const uploadLimit = RequestLimits.uploadBytes();

function toInt(value: string | undefined) {
	const parsed = Number.parseInt(value ?? "");
	return Number.isNaN(parsed) ? undefined : parsed;
}

const server = Bun.serve({
	port: process.env.NITRO_PORT || process.env.PORT || 3000,
	hostname: process.env.NITRO_HOST || process.env.HOST,
	idleTimeout: toInt(process.env.NITRO_BUN_IDLE_TIMEOUT),
	// The hard cap for any body, also chunked ones; the per-request limit below is stricter.
	maxRequestBodySize: uploadLimit,

	async fetch(request) {
		const url = new URL(request.url);

		let body: ArrayBuffer | undefined;
		if (request.body) {
			const limit = RequestLimits.limitFor(request.headers, uploadLimit);
			const read = await RequestLimits.readBody(request, limit);
			if (read === null) return RequestLimits.tooLarge(limit);
			body = read;
		}

		return nitroApp.localFetch(url.pathname + url.search, {
			host: url.hostname,
			protocol: url.protocol,
			headers: request.headers,
			method: request.method,
			redirect: request.redirect,
			body,
		});
	},
});

console.log(`Listening on ${server.url}...`);

// @ts-ignore Nitro replaces this at build time.
if (import.meta._tasks) {
	startScheduleRunner();
}
