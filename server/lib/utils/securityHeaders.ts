import { createHash } from "node:crypto";

/**
 * Security headers for every response (`server/middleware/00.security-headers.ts`) and the
 * Content-Security-Policy of the app's pages (`server/plugins/csp.ts`).
 */
export namespace SecurityHeaders {
	/** Headers for every response. HSTS only when the app runs on https. */
	export function base(https: boolean): Record<string, string> {
		return {
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "strict-origin-when-cross-origin",
			"Permissions-Policy":
				"camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
			"Cross-Origin-Opener-Policy": "same-origin",
			...(https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
		};
	}

	/** API responses: JSON only, nothing to load or frame. Endpoints serving files set their own. */
	export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

	/**
	 * The policy of an app page. Scripts: only the app's own files plus the inline scripts of this
	 * very page, by hash (Nuxt's config script, the colour-mode script). Styles allow inline: Nuxt UI
	 * writes the org's colour palette into a `<style>` at runtime. Images may come from other hosts:
	 * the system dashboard shows the orgs' icons from their own domains.
	 */
	export function pageCsp(html: string, https: boolean): string {
		const hashes = inlineScriptHashes(html).map((hash) => `'sha256-${hash}'`);
		return [
			"default-src 'self'",
			`script-src 'self' ${hashes.join(" ")}`.trim(),
			"style-src 'self' 'unsafe-inline'",
			`img-src 'self' data: blob: ${https ? "https:" : "http: https:"}`,
			"font-src 'self' data:",
			"connect-src 'self'",
			"media-src 'self' blob:",
			"worker-src 'self' blob:",
			"manifest-src 'self'",
			"frame-src 'self' blob:",
			"object-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'",
			...(https ? ["upgrade-insecure-requests"] : []),
		].join("; ");
	}

	/** SHA-256 (base64) of every inline `<script>` body in `html`. */
	export function inlineScriptHashes(html: string): string[] {
		const hashes = new Set<string>();
		for (const match of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
			const body = match[1] ?? "";
			if (body.length === 0) continue;
			hashes.add(createHash("sha256").update(body, "utf8").digest("base64"));
		}
		return [...hashes];
	}
}
