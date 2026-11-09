import { defineNitroPlugin } from "nitropack/runtime";
import { ConfigHandler } from "../lib/utils/config";
import { SecurityHeaders } from "../lib/utils/securityHeaders";

/**
 * Content-Security-Policy for the app's pages, built per response: the page's own inline scripts
 * are allowed by hash, nothing else inline. Not in development (Vite's dev client injects scripts
 * and needs a websocket).
 */
export default defineNitroPlugin((nitroApp) => {
	if (import.meta.dev) return;

	nitroApp.hooks.hook("render:response", (response) => {
		if (typeof response.body !== "string") return;
		const https = (ConfigHandler.getConfig()?.APP_URL ?? "").startsWith("https://");
		response.headers = {
			...response.headers,
			"content-security-policy": SecurityHeaders.pageCsp(response.body, https),
		};
	});
});
