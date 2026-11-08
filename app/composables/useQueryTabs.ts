import type { NavigationMenuItem } from "@nuxt/ui";
import type { LocationQuery } from "vue-router";

export interface QueryTab<T extends string = string> {
	value: T;
	label: string;
	icon?: string;
	/** Count or short text next to the label (e.g. the number of entries in a filter). */
	badge?: string | number;
}

/**
 * Views of one page as toolbar sub-navigation — the style guide's `UDashboardToolbar` + highlighted
 * `UNavigationMenu` (15-design-system, "Sub-navigation"). The active view lives in the query string
 * (`?<key>=<value>`, omitted for the first tab), so it survives a reload and can be linked:
 *
 * ```ts
 * const { active: view, links: viewLinks } = useQueryTabs("view", [
 * 	{ value: "area", label: "Nach Bereich", icon: "i-lucide-layout-grid" },
 * 	{ value: "person", label: "Nach Person", icon: "i-lucide-users" },
 * ]);
 * ```
 *
 * ```vue
 * <UDashboardToolbar>
 * 	<UNavigationMenu :items="viewLinks" highlight class="-mx-1 flex-1" />
 * </UDashboardToolbar>
 * ```
 *
 * `resetKeys` are dropped from the query when the view changes (e.g. a selection that belongs to
 * the old view). An unknown or no longer allowed value falls back to the first tab.
 */
export function useQueryTabs<T extends string>(
	key: string,
	tabs: MaybeRefOrGetter<QueryTab<T>[]>,
	options: { resetKeys?: string[] } = {},
) {
	const route = useRoute();
	const router = useRouter();

	const active = computed<T>({
		get: () => {
			const list = toValue(tabs);
			const requested = route.query[key]?.toString();
			return (list.find((tab) => tab.value === requested) ?? list[0])?.value as T;
		},
		set: (value) => {
			void router.replace({ path: route.path, query: queryFor(value) });
		},
	});

	function queryFor(value: T): LocationQuery {
		const query: LocationQuery = { ...route.query };
		for (const resetKey of options.resetKeys ?? []) delete query[resetKey];
		if (value === toValue(tabs)[0]?.value) delete query[key];
		else query[key] = value;
		return query;
	}

	const links = computed<NavigationMenuItem[]>(() =>
		toValue(tabs).map((tab) => ({
			label: tab.label,
			icon: tab.icon,
			badge: tab.badge,
			to: { path: route.path, query: queryFor(tab.value) },
			replace: true,
			active: tab.value === active.value,
		})),
	);

	return { active, links };
}
