<script setup lang="ts">
/**
 * "Packliste": go through the material when packing and when bringing it back. Optional — the
 * status is only a help, nothing depends on it. Each entry is open, packed or back: "Alles" sets
 * it with a select, the other views have the next step as a button. Grouped by where things are
 * (or come from); the place filter narrows the list and the counters to some places.
 */
import type { PackingStatus } from "~/composables/useEventMaterials";
import type { EventMaterial } from "~/utils/types";

const { items, loading, contribute, setPacking } = useEventMaterials();
const toast = useToast();

const { value: show, items: showItems } = useQueryFilter("show", [
	{ label: "Alles", value: "all" },
	{ label: "Noch einpacken", value: "pack" },
	{ label: "Noch nicht zurück", value: "return" },
]);

const places = ref<string[]>([]);
const placeItems = computed(() =>
	locationOptions(
		items.value.map((item) => item.location),
		"Noch ohne Ort",
	),
);
// Places that are gone (renamed, removed) no longer filter.
watch(placeItems, (options) => {
	const known = places.value.filter((place) => options.some((option) => option.value === place));
	if (known.length !== places.value.length) places.value = known;
});

const inPlaces = computed(() =>
	items.value.filter((item) => matchesLocation(item.location, places.value)),
);

// "Noch nicht zurück": what was packed — what never was is still under "Noch einpacken".
const visible = computed(() =>
	inPlaces.value.filter((item) => {
		const status = packingStatus(item);
		if (show.value === "pack") return status === "open";
		if (show.value === "return") return status === "packed";
		return true;
	}),
);

const statusItems = (Object.keys(PACKING_STATUS_LABELS) as PackingStatus[]).map((status) => ({
	label: PACKING_STATUS_LABELS[status],
	value: status,
	icon: PACKING_STATUS_ICONS[status],
}));

/** The next step in the filtered views; it leaves the view, so it can be taken back. */
async function step(item: EventMaterial, to: PackingStatus) {
	const from = packingStatus(item);
	if (!(await setPacking(item, to))) return;
	toast.add({
		title: `${materialLabel(item)}: ${PACKING_STATUS_LABELS[to]}`,
		icon: PACKING_STATUS_ICONS[to],
		color: "success",
		actions: [
			{
				label: "Rückgängig",
				icon: "i-lucide-undo-2",
				onClick: () => {
					const current = items.value.find((entry) => entry.id === item.id);
					if (current) void setPacking(current, from);
				},
			},
		],
	});
}

const UNPLACED = {
	inventory: "Aus dem Lager",
	purchase: "Wird gekauft",
	own: "Bringen Leute mit",
} as const;

/** Groups by place; what has none, by where it comes from (after the places). */
const groups = computed(() => {
	const map = new Map<
		string,
		{ key: string; title: string; icon: string; place: boolean; entries: EventMaterial[] }
	>();
	for (const item of visible.value) {
		const key = item.location ? `place:${item.location}` : `kind:${item.kind}`;
		const group = map.get(key) ?? {
			key,
			title: item.location ?? UNPLACED[item.kind],
			icon: item.location ? "i-lucide-map-pin" : MATERIAL_KIND_ICONS[item.kind],
			place: !!item.location,
			entries: [],
		};
		group.entries.push(item);
		map.set(key, group);
	}
	return [...map.values()].sort(
		(a, b) => Number(b.place) - Number(a.place) || a.title.localeCompare(b.title, "de"),
	);
});

// By status: what is back counts as packed (also entries ticked "Zurück" alone before).
const packed = computed(
	() => inPlaces.value.filter((item) => packingStatus(item) !== "open").length,
);
const returned = computed(
	() => inPlaces.value.filter((item) => packingStatus(item) === "returned").length,
);

function source(item: EventMaterial) {
	if (item.kind === "own")
		return item.owner ? `bringt ${item.owner.display_name}` : "wird mitgebracht";
	if (item.kind === "purchase") return item.bought_at ? "gekauft" : "noch zu kaufen";
	return item.resource?.location ? `Lager: ${item.resource.location}` : "aus dem Lager";
}
</script>

<template>
	<div class="space-y-4">
		<DashboardFilterBar>
			<template #left>
				<USelect v-model="show" :items="showItems" class="w-full sm:w-52" />
				<USelectMenu
					v-if="placeItems.length > 1 || places.length"
					v-model="places"
					:items="placeItems"
					value-key="value"
					multiple
					placeholder="Alle Orte"
					icon="i-lucide-map-pin"
					class="w-full sm:w-auto sm:min-w-48"
				/>
			</template>
			<template #right>
				<div class="flex flex-wrap gap-4 text-sm text-slate-400">
					<span>
						<span class="font-medium text-white tabular-nums">{{ packed }}</span> von {{ inPlaces.length }} eingepackt
					</span>
					<span>
						<span class="font-medium text-white tabular-nums">{{ returned }}</span> von {{ inPlaces.length }} zurück
					</span>
				</div>
			</template>
		</DashboardFilterBar>

		<div v-if="loading && !items.length" class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
		</div>

		<UEmpty
			v-else-if="!visible.length"
			icon="i-lucide-list-checks"
			:title="items.length ? 'Alles erledigt' : 'Noch kein Material'"
			:description="items.length ? 'In dieser Ansicht ist nichts mehr offen.' : 'Sobald Material auf der Liste steht, hältst du hier fest, was eingepackt und was zurück ist.'"
		/>

		<div v-else class="space-y-4">
			<DashboardSectionCard v-for="group in groups" :key="group.key" :title="group.title" :icon="group.icon">
				<ul class="divide-y divide-slate-800">
					<li v-for="item in group.entries" :key="item.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="font-medium text-white">{{ materialLabel(item) }}</p>
							<p class="text-xs text-slate-400">{{ source(item) }}</p>
						</div>
						<UButton
							v-if="show === 'pack'"
							:label="PACKING_STATUS_LABELS.packed"
							:icon="PACKING_STATUS_ICONS.packed"
							color="neutral"
							variant="subtle"
							size="sm"
							:disabled="!contribute"
							@click="step(item, 'packed')"
						/>
						<UButton
							v-else-if="show === 'return'"
							:label="PACKING_STATUS_LABELS.returned"
							:icon="PACKING_STATUS_ICONS.returned"
							color="neutral"
							variant="subtle"
							size="sm"
							:disabled="!contribute"
							@click="step(item, 'returned')"
						/>
						<USelect
							v-else
							:model-value="packingStatus(item)"
							:items="statusItems"
							:icon="PACKING_STATUS_ICONS[packingStatus(item)]"
							:disabled="!contribute"
							size="sm"
							class="w-36"
							aria-label="Status"
							@update:model-value="(value: PackingStatus) => setPacking(item, value)"
						/>
					</li>
				</ul>
			</DashboardSectionCard>
		</div>
	</div>
</template>
