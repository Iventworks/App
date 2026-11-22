<script setup lang="ts">
/**
 * A purchase was bought. The buyer only marks it; the Leitung also decides whether it stays with
 * this event or goes into the organisation's inventory (added to an item or as a new one, and
 * booked for this event). Something bought earlier can still be moved into the inventory.
 */
const { eventId, manage, boughtDialog, catalog, catalogLoading, replaceItem } = useEventMaterials();
const toast = useToast();

const form = reactive({
	target: "event" as "event" | "inventory",
	resource_id: undefined as number | undefined,
	category: "",
});
const saving = ref(false);

const entry = computed(() => boughtDialog.entry);
const alreadyBought = computed(() => !!entry.value?.bought_at);

watch(
	() => boughtDialog.open,
	(open) => {
		if (!open) return;
		Object.assign(form, {
			target: alreadyBought.value ? "inventory" : "event",
			resource_id: undefined,
			category: "",
		});
	},
);

const targetItems = [
	{
		label: "Nur für dieses Event",
		value: "event",
		description: "Verbraucht oder bleibt bei jemandem.",
	},
	{
		label: "Ins Lager übernehmen",
		value: "inventory",
		description: "Kommt ins Inventar der Organisation und ist für dieses Event gebucht.",
	},
];

const resourceOptions = computed(() => [
	{ label: "Neues Material im Lager", value: 0 },
	...(catalog.value ?? []).map((item) => ({
		label: item.name,
		value: item.id,
		description: `${item.category} · Bestand ${item.quantity}`,
	})),
]);

const categories = computed(() => [...new Set((catalog.value ?? []).map((item) => item.category))]);

async function submit() {
	const target = entry.value;
	if (!target) return;
	saving.value = true;
	const toInventory = manage.value && form.target === "inventory";
	const result = await useAPI((api) =>
		api.postEventsByEventIdMaterialsByMaterialIdBought({
			path: { eventId: eventId.value, materialId: target.id },
			body: {
				to_inventory: toInventory,
				resource_id: toInventory && form.resource_id ? form.resource_id : null,
				category:
					toInventory && !form.resource_id && form.category.trim() ? form.category.trim() : null,
			},
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	replaceItem(result.data);
	toast.add({
		title: toInventory ? `„${result.data.name}“ ist jetzt im Lager` : `„${result.data.name}“ gekauft`,
		color: "success",
		icon: "i-lucide-check",
	});
	boughtDialog.open = false;
}
</script>

<template>
	<DashboardModal
		v-model:open="boughtDialog.open"
		:title="alreadyBought ? 'Ins Lager übernehmen' : 'Gekauft'"
		:description="entry ? materialLabel(entry) : undefined"
		icon="i-lucide-shopping-bag"
	>
		<form class="space-y-4" @submit.prevent="submit">
			<URadioGroup v-if="manage && !alreadyBought" v-model="form.target" :items="targetItems" />
			<p v-else-if="!manage" class="text-sm text-slate-300">
				Danach kannst du die Auslage dafür einreichen.
			</p>

			<template v-if="manage && form.target === 'inventory'">
				<UFormField label="Im Lager">
					<USelectMenu
						v-model="form.resource_id"
						:items="resourceOptions"
						value-key="value"
						:loading="catalogLoading"
						placeholder="Neues Material im Lager"
						class="w-full"
					/>
				</UFormField>
				<UFormField v-if="!form.resource_id" label="Kategorie">
					<UInput v-model="form.category" list="material-categories" placeholder="Allgemein" :maxlength="60" class="w-full" />
					<datalist id="material-categories">
						<option v-for="category in categories" :key="category" :value="category" />
					</datalist>
				</UFormField>
			</template>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="boughtDialog.open = false" />
				<UButton
					type="submit"
					:label="manage && form.target === 'inventory' ? 'Ins Lager übernehmen' : 'Als gekauft markieren'"
					:loading="saving"
				/>
			</div>
		</form>
	</DashboardModal>
</template>
