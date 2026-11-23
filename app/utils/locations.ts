/**
 * Location filters for material lists (an event's "Wo", the inventory's "Lagerort"): the places in
 * use, A–Z, and one option for entries without a place.
 */

/** Filter value for "no place". The API trims places, so none is a single space. */
export const NO_LOCATION = " ";

/** Options for a location multi-select; `emptyLabel` only when some entry has no place. */
export function locationOptions(locations: (string | null)[], emptyLabel: string) {
	const places = [...new Set(locations.filter((place): place is string => !!place))].sort((a, b) =>
		a.localeCompare(b, "de"),
	);
	return [
		...places.map((place) => ({ label: place, value: place, icon: "i-lucide-map-pin" })),
		...(locations.some((place) => !place) ? [{ label: emptyLabel, value: NO_LOCATION }] : []),
	];
}

/** Whether a place matches the selected options (nothing selected: everything matches). */
export function matchesLocation(location: string | null, selected: readonly string[] | undefined) {
	if (!selected?.length) return true;
	return selected.includes(location || NO_LOCATION);
}
