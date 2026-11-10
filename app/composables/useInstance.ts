/**
 * useInstance / useBrandName — the host's instance info (`useInstanceStore`, loaded by
 * `plugins/instance.ts` before the first navigation) and the name to show for it.
 */
import type { InstanceInfo } from "~/composables/stores/useInstanceStore";

/** The loaded instance info (the plugin guarantees it is set once the app renders). */
export function useInstance() {
	const state = useState<InstanceInfo | null>("instance", () => null);
	return computed(() => state.value);
}

/** Name shown for this host: the org's display name, or the product on the system host. */
export function useBrandName() {
	const instance = useInstance();
	return computed(() => {
		const info = instance.value;
		if (info?.kind === "org" && info.org) return info.org.display_name;
		if (info?.kind === "system") return `${info.app_name} System`;
		return info?.app_name ?? "Iventworks";
	});
}

/**
 * Name of this host's installable app: the product and the org it is for ("Iventworks für
 * Crossover"), so people find it under the product's name and don't take it for the org's own
 * app. Same rule as the manifest's `name` (`routes/instance`).
 */
export function useInstallName() {
	const instance = useInstance();
	const brandName = useBrandName();
	return computed(() => {
		const info = instance.value;
		if (info?.kind !== "org" || !info.org) return brandName.value;
		const org = info.org.display_name;
		// A single org named like the product: not "Iventworks für Iventworks".
		return org.toLowerCase().includes(info.app_name.toLowerCase())
			? org
			: `${info.app_name} für ${org}`;
	});
}
