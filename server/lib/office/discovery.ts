import { ConfigHandler } from "../utils/config";
import { AppConstants } from "../utils/constants";
import { Logger } from "../utils/logger";

/**
 * The office server's WOPI discovery (`<office>/hosting/discovery`): which file types it opens
 * how (`view`, `edit` → the editor URL), and its proof keys (`WopiProof`). Fetched from
 * `OFFICE_INTERNAL_URL` (or `OFFICE_URL`), cached for an hour. The editor URLs are rewritten to
 * the public `OFFICE_URL`: browsers load the editor from there.
 */
export namespace OfficeDiscovery {
	const TTL_MS = 60 * 60 * 1000;
	const RETRY_MS = 60 * 1000;

	export interface Action {
		app: string;
		name: string;
		ext: string;
		urlsrc: string;
	}

	export interface ProofKey {
		modulus: string;
		exponent: string;
	}

	export interface Discovery {
		actions: Action[];
		proofKey: ProofKey | null;
		oldProofKey: ProofKey | null;
	}

	let cache: { discovery: Discovery | null; fetchedAt: number; until: number } | null = null;
	let loading: Promise<Discovery | null> | null = null;
	let override: Discovery | null = null;

	/**
	 * Problems with the office settings (empty when fine). Checked at startup: a wrong address
	 * would only show up when someone opens a document, and the office server on the app's own
	 * host would run its code on the app's origin — the reason for WOPI in the first place.
	 */
	export function validate(config: {
		APP_URL: string;
		OFFICE_URL?: string;
		OFFICE_INTERNAL_URL?: string;
	}): string[] {
		const errors: string[] = [];
		const name = (key: string) => `${AppConstants.APP_ENV_PREFIX}_${key}`;
		const parse = (key: "OFFICE_URL" | "OFFICE_INTERNAL_URL") => {
			const value = config[key];
			if (!value) return null;
			try {
				const url = new URL(value);
				if (url.protocol === "http:" || url.protocol === "https:") return url;
			} catch {}
			errors.push(`${name(key)} must be an http(s) address, e.g. https://office.ivb.example.org`);
			return null;
		};
		if (config.OFFICE_INTERNAL_URL && !config.OFFICE_URL) {
			errors.push(`${name("OFFICE_INTERNAL_URL")} needs ${name("OFFICE_URL")} as well`);
		}
		const publicUrl = parse("OFFICE_URL");
		parse("OFFICE_INTERNAL_URL");
		if (!publicUrl) return errors;
		if (publicUrl.pathname !== "/") {
			errors.push(`${name("OFFICE_URL")} must be a host of its own, without a path`);
		}
		let appHost: string | null = null;
		try {
			appHost = new URL(config.APP_URL).hostname;
		} catch {}
		if (appHost && publicUrl.hostname === appHost) {
			errors.push(
				`${name("OFFICE_URL")} must not be the app's own host name: use a host of its own, e.g. office.ivb.${appHost}`,
			);
		}
		return errors;
	}

	/** Office editing is configured on this installation. */
	export function enabled() {
		return Boolean(ConfigHandler.getConfig()?.OFFICE_URL) || override !== null;
	}

	/** The public origin of the office server (CSP `frame-src` / `form-action`). */
	export function publicOrigin(): string | null {
		const url = ConfigHandler.getConfig()?.OFFICE_URL ?? override?.actions[0]?.urlsrc;
		if (!url) return null;
		try {
			return new URL(url).origin;
		} catch {
			return null;
		}
	}

	export function decodeEntities(text: string) {
		return text
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&amp;/g, "&");
	}

	function attributes(tag: string) {
		const result: Record<string, string> = {};
		for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
			result[match[1] as string] = decodeEntities(match[2] as string);
		}
		return result;
	}

	/** Parse the discovery XML (the few elements we need; no XML library). */
	export function parse(xml: string): Discovery {
		const actions: Action[] = [];
		for (const app of xml.matchAll(/<app\b([^>]*)>([\s\S]*?)<\/app>/g)) {
			const appName = attributes(app[1] as string).name ?? "";
			for (const action of (app[2] as string).matchAll(/<action\b([^>]*?)\/?>/g)) {
				const attrs = attributes(action[1] as string);
				if (attrs.name && attrs.ext && attrs.urlsrc) {
					actions.push({
						app: appName,
						name: attrs.name,
						ext: attrs.ext.toLowerCase(),
						urlsrc: attrs.urlsrc,
					});
				}
			}
		}
		const proof = xml.match(/<proof-key\b([^>]*?)\/?>/);
		const proofAttrs = proof ? attributes(proof[1] as string) : {};
		return {
			actions,
			proofKey:
				proofAttrs.modulus && proofAttrs.exponent
					? { modulus: proofAttrs.modulus, exponent: proofAttrs.exponent }
					: null,
			oldProofKey:
				proofAttrs.oldmodulus && proofAttrs.oldexponent
					? { modulus: proofAttrs.oldmodulus, exponent: proofAttrs.oldexponent }
					: null,
		};
	}

	async function fetchDiscovery(): Promise<Discovery | null> {
		const config = ConfigHandler.getConfig();
		const base = config?.OFFICE_INTERNAL_URL || config?.OFFICE_URL;
		if (!base) return null;
		try {
			const response = await fetch(new URL("/hosting/discovery", base), {
				redirect: "error",
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const discovery = parse(await response.text());
			if (discovery.actions.length === 0) throw new Error("no actions (is WOPI_ENABLED=true set?)");
			if (!discovery.proofKey) {
				Logger.error(
					"Office discovery has no proof key: WOPI calls are refused. Run the office server with WOPI_ENABLED=true.",
				);
			}
			return discovery;
		} catch (error: any) {
			Logger.error(`Office discovery from ${base} failed:`, error?.message ?? error);
			return null;
		}
	}

	/**
	 * The discovery (cached), or null when office editing is off or the server hasn't been reached
	 * since the start.
	 */
	export async function get(now = Date.now()): Promise<Discovery | null> {
		if (override) return override;
		if (!enabled()) return null;
		if (cache && cache.until > now) return cache.discovery;
		return await load(now);
	}

	/**
	 * Fetch the discovery again, e.g. when a proof didn't match: the office server may have new
	 * keys (after an update). At most once per `RETRY_MS`; otherwise the cached one.
	 */
	export async function reload(now = Date.now()): Promise<Discovery | null> {
		if (override) return override;
		if (!enabled()) return null;
		if (cache && now - cache.fetchedAt < RETRY_MS) return cache.discovery;
		return await load(now);
	}

	async function load(now: number) {
		loading ??= fetchDiscovery().finally(() => {
			loading = null;
		});
		const fetched = await loading;
		// A failed fetch (the office server restarting, a timeout) keeps the last good discovery: its
		// keys still check the office server's calls. Try again after RETRY_MS.
		const discovery = fetched ?? cache?.discovery ?? null;
		cache = { discovery, fetchedAt: now, until: now + (fetched ? TTL_MS : RETRY_MS) };
		return discovery;
	}

	/** The action for a file extension: `edit` when wanted and offered, else `view`. */
	export function actionFor(discovery: Discovery, ext: string, wantEdit: boolean) {
		const forExt = discovery.actions.filter((action) => action.ext === ext.toLowerCase());
		const edit = forExt.find((action) => action.name === "edit");
		const view = forExt.find((action) => action.name === "view");
		if (wantEdit && edit) return { action: edit, mode: "edit" as const };
		if (view) return { action: view, mode: "view" as const };
		if (edit) return { action: edit, mode: "view" as const };
		return null;
	}

	/**
	 * The editor URL for a file: the action's `urlsrc` on the public office address, its
	 * placeholders filled (language) or dropped, and `WOPISrc` appended.
	 */
	export function editorUrl(action: Action, wopiSrc: string, language = "de-DE") {
		const values: Record<string, string> = {
			UI_LLCC: language,
			DC_LLCC: language,
			DC_LLCC_FALLBACK: language,
		};
		let url = action.urlsrc.replace(
			/<([^=<>]+)=([^&<>]+)&?>/g,
			(_, key: string, placeholder: string) =>
				values[placeholder] ? `${key}=${encodeURIComponent(values[placeholder] as string)}&` : "",
		);
		const publicUrl = ConfigHandler.getConfig()?.OFFICE_URL;
		if (publicUrl) {
			const parsed = new URL(url);
			const target = new URL(publicUrl);
			parsed.protocol = target.protocol;
			parsed.host = target.host;
			url = parsed.toString();
		}
		if (!url.includes("?")) url += "?";
		else if (!url.endsWith("&") && !url.endsWith("?")) url += "&";
		return `${url}WOPISrc=${encodeURIComponent(wopiSrc)}`;
	}

	/** Tests: use this discovery instead of fetching one (null: back to normal). */
	export function setForTests(discovery: Discovery | null) {
		override = discovery;
		cache = null;
	}
}
