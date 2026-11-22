<script setup lang="ts">
/**
 * "Packliste": go through the material when packing and when bringing it back. Optional — ticks
 * are only a help, nothing depends on them. Grouped by where things are (or come from).
 */
import type { EventMaterial } from "~/utils/types";

const { items, loading, contribute, tick } = useEventMaterials();

const { value: show, items: showItems } = useQueryFilter("show", [
	{ label: "Alles", value: "all" },
	{ label: "Noch einpacken", value: "pack" },
	{ label: "Noch nicht zurück", value: "return" },
]);

const visible = computed(() =>
	items.value.filter((item) =>
		show.value === "pack" ? !item.packed_at : show.value === "return" ? !item.returned_at : true,
	),
);

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

const packed = computed(() => items.value.filter((item) => item.packed_at).length);
const returned = computed(() => items.value.filter((item) => item.returned_at).length);

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
			</template>
			<template #right>
				<div class="flex flex-wrap gap-4 text-sm text-slate-400">
					<span>
						<span class="font-medium text-white tabular-nums">{{ packed }}</span> von {{ items.length }} eingepackt
					</span>
					<span>
						<span class="font-medium text-white tabular-nums">{{ returned }}</span> von {{ items.length }} zurück
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
			:description="items.length ? 'In dieser Ansicht ist nichts mehr offen.' : 'Sobald Material auf der Liste steht, kannst du es hier abhaken.'"
		/>

		<div v-else class="space-y-4">
			<DashboardSectionCard v-for="group in groups" :key="group.key" :title="group.title" :icon="group.icon">
				<ul class="divide-y divide-slate-800">
					<li v-for="item in group.entries" :key="item.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="font-medium text-white">{{ materialLabel(item) }}</p>
							<p class="text-xs text-slate-400">{{ source(item) }}</p>
						</div>
						<UCheckbox
							:model-value="!!item.packed_at"
							label="Eingepackt"
							:disabled="!contribute"
							@update:model-value="(value: boolean | 'indeterminate') => tick(item, 'packed', value === true)"
						/>
						<UCheckbox
							:model-value="!!item.returned_at"
							label="Zurück"
							:disabled="!contribute"
							@update:model-value="(value: boolean | 'indeterminate') => tick(item, 'returned', value === true)"
						/>
					</li>
				</ul>
			</DashboardSectionCard>
		</div>
	</div>
</template>
