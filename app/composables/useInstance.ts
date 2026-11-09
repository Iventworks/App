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
