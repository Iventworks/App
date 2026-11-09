export namespace AppConstants {
	export const APP_NAME = "Iventworks";

	export const APP_ENV_PREFIX = "IVENTWORKS";

	/** Env prefix before the rename to Iventworks (`CMP_DB_PATH`, …), read as a fallback. */
	export const LEGACY_ENV_PREFIX = "CMP";

	export const APP_KEYS_PREFIX = "iventworks";

	export const APP_API_DEFAULT_PORT = 31316;

	export const APP_API_DEFAULT_PROD_URL = "https://app.iventworks.de/api";

	export const DEFAULT_EMAIL_FROM_HOST = "iventworks.de";

	export const DEFAULT_SMTP_FROM = `"${AppConstants.APP_NAME}" <noreply@${AppConstants.DEFAULT_EMAIL_FROM_HOST}>`;

	export const BINARY_NAME = "iventworks";

	/** Host header that wins over `X-Forwarded-Host` and `Host` when resolving the org. */
	export const HOST_HEADER = "x-iventworks-host";

	/** TXT record name prefix that proves ownership of a custom domain. */
	export const DOMAIN_CHALLENGE_PREFIX = "_iventworks-challenge";

	/** TXT record value prefix: `iventworks-verification=<token>`. */
	export const DOMAIN_CHALLENGE_VALUE_PREFIX = "iventworks-verification=";
}
