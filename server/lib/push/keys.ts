import webpush from "web-push";
import { RuntimeMetadata } from "../api/utils/metadata";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";

/**
 * The VAPID key pair that identifies this server to the browsers' push services. Configured
 * (`IVENTWORKS_WEB_PUSH_PUBLIC_KEY` / `…_PRIVATE_KEY`) or generated once and kept in the database
 * — changing it would invalidate every subscription, so it must stay stable (and backups carry it).
 * One pair for the whole installation: every org's domain is its own push origin anyway.
 */
export class WebPushKeys extends RuntimeMetadata {
	private static cached: WebPushKeys.Keys | null = null;
	/** The first call in flight: concurrent callers share one generation, one write. */
	private static generating: Promise<WebPushKeys.Keys> | null = null;

	static get(): Promise<WebPushKeys.Keys> {
		if (WebPushKeys.cached) return Promise.resolve(WebPushKeys.cached);
		WebPushKeys.generating ??= WebPushKeys.generate().finally(() => {
			WebPushKeys.generating = null;
		});
		return WebPushKeys.generating;
	}

	private static async generate(): Promise<WebPushKeys.Keys> {
		const config = ConfigHandler.getConfig();
		const subject = WebPushKeys.subject();

		if (config?.WEB_PUSH_PUBLIC_KEY && config.WEB_PUSH_PRIVATE_KEY) {
			WebPushKeys.cached = {
				publicKey: config.WEB_PUSH_PUBLIC_KEY,
				privateKey: config.WEB_PUSH_PRIVATE_KEY,
				subject,
			};
			return WebPushKeys.cached;
		}

		const stored = await WebPushKeys.getMetadata("web_push_vapid");
		if (stored.public_key && stored.private_key) {
			WebPushKeys.cached = { publicKey: stored.public_key, privateKey: stored.private_key, subject };
			return WebPushKeys.cached;
		}

		const generated = webpush.generateVAPIDKeys();
		await WebPushKeys.setMetadata("web_push_vapid", {
			public_key: generated.publicKey,
			private_key: generated.privateKey,
		});
		Logger.info("Generated the Web Push (VAPID) key pair; it is kept in the database.");
		WebPushKeys.cached = {
			publicKey: generated.publicKey,
			privateKey: generated.privateKey,
			subject,
		};
		return WebPushKeys.cached;
	}

	/** The contact the push services see: configured, else APP_URL (https), else a placeholder. */
	static subject() {
		const config = ConfigHandler.getConfig();
		if (config?.WEB_PUSH_SUBJECT) return config.WEB_PUSH_SUBJECT;
		const appUrl = config?.APP_URL ?? "";
		return appUrl.startsWith("https://") ? appUrl : "mailto:push@iventworks.invalid";
	}

	/** Tests only. */
	static reset() {
		WebPushKeys.cached = null;
	}
}

export namespace WebPushKeys {
	export interface Keys {
		/** Base64url, uncompressed P-256 point: the browser's `applicationServerKey`. */
		publicKey: string;
		privateKey: string;
		subject: string;
	}
}
