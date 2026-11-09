/** The part of `DashboardDataTable`'s exposed API this composable needs. */
interface DataTableHandle {
	tableApi?: {
		getColumn: (id: string) => { setFilterValue: (value: unknown) => void } | undefined;
	};
}

/**
 * Preset values for a `DashboardDataTable`'s own filters (e.g. hide archived events until
 * "Archiviert" is picked in the status multi-select). The DataTable keeps its filter state
 * internally and exposes TanStack's `tableApi` (style guide 15, Data table); the table only exists
 * once there are rows, so the values are applied as soon as the API appears — once, so the
 * person's later changes stick.
 *
 * ```ts
 * const table = useDataTableInitialFilters({ status: ["pending"] });
 * ```
 *
 * ```vue
 * <DashboardDataTable ref="table" :filters="[{ column: 'status', type: 'multi-select', … }]" … />
 * ```
 */
export function useDataTableInitialFilters(filters: Record<string, unknown>) {
	const table = ref<DataTableHandle | null>(null);
	let applied = false;

	watch(
		() => table.value?.tableApi,
		(api) => {
			if (!api || applied) return;
			applied = true;
			for (const [column, value] of Object.entries(filters)) {
				api.getColumn(column)?.setFilterValue(value);
			}
		},
	);

	return table;
}
