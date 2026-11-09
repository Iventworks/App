import type { SelectItem } from "@nuxt/ui";
import type { LocationQuery } from "vue-router";

export interface QueryFilterOption<T extends string = string> {
	value: T;
	label: string;
	icon?: string;
	/** Number of entries behind this option, shown after the label ("Leitung (3)"). */
	count?: number;
}

/**
 * A list filter that lives in the query string (`?<key>=<value>`, omitted for the first option), so
 * it survives a reload and can be linked. Bind it to a `USelect` in the list's filter area — the
 * `DashboardDataTable` `#header-left` slot or `DashboardFilterBar` `#left` — never in the
 * `UDashboardToolbar`, which only holds sub-navigation (style guide 15, "Sub-navigation"):
 *
 * ```ts
 * const { value: scope, items: scopeItems } = useQueryFilter("scope", [
 * 	{ value: "mine", label: "Meine Events", icon: "i-lucide-user-check" },
 * 	{ value: "all", label: "Alle Events", icon: "i-lucide-tent" },
 * ]);
 * ```
 *
 * ```vue
 * <USelect v-model="scope" :items="scopeItems" class="w-full sm:w-44" />
 * ```
 *
 * `resetKeys` are dropped from the query when the value changes (e.g. a selection that belongs to
 * the old filter). An unknown or no longer allowed value falls back to the first option.
 */
export function useQueryFilter<T extends string>(
	key: string,
	options: MaybeRefOrGetter<QueryFilterOption<T>[]>,
	settings: { resetKeys?: string[] } = {},
) {
	const route = useRoute();
	const router = useRouter();

	const value = computed<T>({
		get: () => {
			const list = toValue(options);
			const requested = route.query[key]?.toString();
			return (list.find((option) => option.value === requested) ?? list[0])?.value as T;
		},
		set: (next) => {
			void router.replace({ path: route.path, query: queryFor(next) });
		},
	});

	function queryFor(next: T): LocationQuery {
		const query: LocationQuery = { ...route.query };
		for (const resetKey of settings.resetKeys ?? []) delete query[resetKey];
		if (next === toValue(options)[0]?.value) delete query[key];
		else query[key] = next;
		return query;
	}

	const items = computed(
		() =>
			toValue(options).map((option) => ({
				value: option.value,
				label: option.count === undefined ? option.label : `${option.label} (${option.count})`,
				icon: option.icon,
			})) satisfies SelectItem[],
	);

	return { value, items };
}
