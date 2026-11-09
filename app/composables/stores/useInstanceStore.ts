/**
 * useInstanceStore — which org this host belongs to and its branding (`GET /instance`, public).
 *
 * Loaded once by `plugins/instance.ts` before the first navigation. `kind` decides what the app
 * shows: an org's dashboard (`org`), the system admin dashboard on the multi-org base domain
 * (`system`), or the "no organisation here" page (`unknown`).
 */
import type { GetInstanceResponses } from "~/api-client";
import { BasicAbstractStore } from "~/utils/abstractStore";

export type InstanceInfo = GetInstanceResponses[200]["data"];
export type InstanceOrg = NonNullable<InstanceInfo["org"]>;

/** Default Iventworks assets (public/static/brand), used while an org has none uploaded. */
export const DEFAULT_BRAND = {
	logo: "/static/brand/logo-on-dark.svg",
	icon: "/static/brand/icon.svg",
} as const;

class InstanceStore extends BasicAbstractStore<InstanceInfo> {
	constructor() {
		super("instance");
	}

	protected override async fetchData() {
		const response = await useAPI((api) => api.getInstance({}), true);
		return response.success ? response.data : null;
	}

	/** Replace the org part after its admins changed name, colour or images. */
	setOrg(org: InstanceOrg) {
		const current = this.useRaw();
		if (current.value) current.value = { ...current.value, org };
	}
}

export function useInstanceStore() {
	return new InstanceStore();
}
