/**
 * updateAPIClient — point the generated SDK at the API and set (or clear) the bearer token.
 *
 * `ignoreResponseError: true` means the client never throws on non-2xx; the
 * `{ success, code, message, data }` envelope is always returned and callers branch on
 * `result.success`. `baseURL` is `<this page's origin>/api/v1`: each org host serves its own API
 * (multi-org mode), so never the configured base URL.
 * See docs/05-api-contract.md and docs/07-state-and-data.md.
 */
import { client } from "@/api-client/client.gen";
import { useAPIOrigin } from "./useRuntimeAppConfigs";

export function updateAPIClient(token: string | null) {
	const apiURL = `${useAPIOrigin()}/api/v1`;

	client.setConfig({
		baseURL: apiURL,
		// `null` deletes the header; omitting it would keep the previous token
		headers: { Authorization: token ? `Bearer ${token}` : null },
		ignoreResponseError: true,
	});
}
