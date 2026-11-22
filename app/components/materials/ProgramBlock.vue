<script setup lang="ts">
/**
 * The material planned for one program item, shown in the program item dialog. Anyone on the team
 * plans entries of the event's material list for it (changes apply at once, not with the item's
 * "Speichern"); what isn't on the list yet is added or asked for on the material page.
 */
import type { EventMaterial } from "~/utils/types";

const props = defineProps<{
	eventId: number;
	programItemId: number;
	materials: EventMaterial[];
	canPlan: boolean;
}>();

const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const adding = ref<number | undefined>(undefined);
const quantity = ref<number | null>(null);
const saving = ref(false);

const planned = computed(() =>
	props.materials.flatMap((entry) =>
		entry.links
			.filter((link) => link.program_item_id === props.programItemId)
			.map((link) => ({ entry, link })),
	),
);

const options = computed(() => {
	const plannedIds = new Set(planned.value.map(({ entry }) => entry.id));
	return props.materials
		.filter((entry) => !plannedIds.has(entry.id))
		.map((entry) => ({
			label: entry.name,
			value: entry.id,
			description: `${entry.quantity}× · ${materialOrigin(entry).label}${entry.location ? ` · ${entry.location}` : ""}`,
		}));
});

async function add() {
	const materialId = adding.value;
	if (!materialId) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdMaterialsByMaterialIdLinks({
			path: { eventId: props.eventId, materialId },
			body: { program_item_id: props.programItemId, occurrence_id: null, quantity: quantity.value },
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Einplanen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	adding.value = undefined;
	quantity.value = null;
	emit("changed");
}

async function remove(entry: EventMaterial, linkId: number) {
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdMaterialsByMaterialIdLinksByLinkId({
			path: { eventId: props.eventId, materialId: entry.id, linkId },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Entfernen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	emit("changed");
}
</script>

<template>
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<p class="text-sm font-medium text-slate-300">Material</p>
			<UButton
				:to="`/events/${eventId}/materials`"
				label="Materialliste"
				icon="i-lucide-package"
				color="neutral"
				variant="ghost"
				size="xs"
			/>
		</div>
		<p v-if="!planned.length" class="text-sm text-slate-500">Noch kein Material eingeplant.</p>
		<ul v-else class="space-y-1">
			<li
				v-for="{ entry, link } in planned"
				:key="link.id"
				class="flex items-center gap-2 rounded-md bg-slate-800/40 px-2 py-1.5 text-sm"
			>
				<UIcon :name="materialOrigin(entry).icon" class="size-4 text-slate-400" />
				<span class="min-w-0 flex-1 truncate">
					{{ link.quantity ? `${link.quantity}× ` : "" }}{{ entry.name }}
					<span v-if="entry.location" class="text-slate-500">· {{ entry.location }}</span>
				</span>
				<UButton
					v-if="canPlan"
					icon="i-lucide-x"
					color="neutral"
					variant="ghost"
					size="xs"
					aria-label="Nicht mehr einplanen"
					@click="remove(entry, link.id)"
				/>
			</li>
		</ul>
		<div v-if="canPlan && options.length" class="flex flex-col gap-2 sm:flex-row">
			<USelectMenu
				v-model="adding"
				:items="options"
				value-key="value"
				placeholder="Material von der Liste einplanen"
				class="flex-1"
			/>
			<UInputNumber v-model="quantity" :min="1" placeholder="Anzahl" class="sm:w-28" />
			<UButton label="Einplanen" icon="i-lucide-plus" color="neutral" variant="subtle" :loading="saving" :disabled="!adding" @click="add" />
		</div>
	</div>
</template>
