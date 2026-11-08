export namespace AppConstants {
	export const APP_NAME = "CMP";

	export const APP_ENV_PREFIX = "CMP";

	/** Env prefix of the pre-merge standalone CMP-API (`CMP_API_DB_PATH`, …), read as a fallback. */
	export const LEGACY_API_ENV_PREFIX = "CMP_API";

	export const APP_KEYS_PREFIX = "cmp";

	export const APP_API_DEFAULT_PORT = 31316;

	export const APP_API_DEFAULT_PROD_URL = "https://cmp.crossover.is-on.net/api";

	export const DEFAULT_EMAIL_FROM_HOST = "crossover.info";

	export const DEFAULT_SMTP_FROM = `"${AppConstants.APP_NAME}" <noreply@${AppConstants.DEFAULT_EMAIL_FROM_HOST}>`;

	export const BINARY_NAME = "cmp";
}
