<script setup lang="ts">
/**
 * Add or edit an entry of the event's material list. Adding: from the inventory (Leitung, with
 * what is free on the event's days), to buy (Leitung) or something someone brings. With a request
 * the entry answers it. Editing shows only what the person may change: everyone on the team the
 * place, the Leitung and who brings it the rest, the Leitung also what a consumable used.
 */
const {
	eventId,
	manage,
	contribute,
	userId,
	entryDialog,
	catalog,
	catalogLoading,
	loadCatalog,
	memberOptions,
	locationSuggestions,
	replaceItem,
	refresh,
	updateEntry,
} = useEventMaterials();
const toast = useToast();

const form = reactive({
	resource_id: undefined as number | undefined,
	name: "",
	quantity: 1,
	location: "",
	notes: "",
	estimate: "",
	buyer_id: undefined as number | undefined,
	owner_id: undefined as number | undefined,
	used_quantity: null as number | null,
});
const saving = ref(false);

const editing = computed(() => entryDialog.editing);
const request = computed(() => entryDialog.request);
const kind = computed(() => entryDialog.kind);
/** Name, quantity, notes (and purchase details): the Leitung, or who brings it. */
const fullEdit = computed(() => !editing.value || editing.value.can_edit);

watch(
	() => entryDialog.open,
	(open) => {
		if (!open) return;
		const entry = editing.value;
		const asked = request.value;
		Object.assign(form, {
			resource_id: entry?.resource?.id,
			name: entry?.kind === "inventory" ? "" : (entry?.name ?? asked?.name ?? ""),
			quantity: entry?.quantity ?? (asked ? Math.max(1, asked.quantity - asked.covered) : 1),
			location: entry?.location ?? "",
			notes: entry?.notes ?? "",
			estimate: centsToInput(entry?.estimated_cents ?? null),
			buyer_id: entry?.buyer?.id,
			owner_id: entry ? entry.owner?.id : manage.value && asked ? undefined : userId(),
			used_quantity: entry?.used_quantity ?? null,
		});
	},
);

const title = computed(() => {
	if (editing.value)
		return fullEdit.value ? `„${editing.value.name}“ bearbeiten` : `Wo ist „${editing.value.name}“?`;
	if (kind.value === "inventory") return "Aus dem Lager buchen";
	if (kind.value === "purchase") return "Zum Kaufen vormerken";
	return manage.value && request.value ? "Jemand bringt es mit" : "Bringe ich mit";
});

const icon = computed(() => (editing.value ? "i-lucide-pencil" : MATERIAL_KIND_ICONS[kind.value]));

const catalogOptions = computed(() =>
	(catalog.value ?? []).map((item) => ({
		label: item.name,
		value: item.id,
		description: [
			item.category,
			item.free ? `${item.free} frei` : "nichts frei",
			item.booked_here ? `${item.booked_here} schon gebucht` : null,
			item.on_order ? `${item.on_order} bestellt` : null,
			resourceDetails(item) || null,
		]
			.filter(Boolean)
			.join(" · "),
		disabled: item.free === 0,
	})),
);

const selectedResource = computed(
	() => (catalog.value ?? []).find((item) => item.id === form.resource_id) ?? null,
);

const maxQuantity = computed(() => {
	if (kind.value !== "inventory") return undefined;
	if (editing.value) {
		const item = (catalog.value ?? []).find((entry) => entry.id === editing.value?.resource?.id);
		return item ? item.free + editing.value.quantity : undefined;
	}
	return selectedResource.value?.free || undefined;
});

const consumable = computed(() => editing.value?.resource?.consumable && manage.value);

const canSubmit = computed(() => {
	if (editing.value) return true;
	if (kind.value === "inventory") return !!form.resource_id && form.quantity >= 1;
	return form.name.trim().length > 0 && form.quantity >= 1;
});

watch(
	() => entryDialog.open && editing.value?.kind === "inventory" && manage.value,
	(load) => {
		// Fresh each time: what is free changes with every booking.
		if (load) void loadCatalog();
	},
);

async function submit() {
	if (!canSubmit.value) return;
	saving.value = true;
	const location = form.location.trim() || null;
	const estimated_cents = form.estimate.trim() ? inputToCents(form.estimate) : null;

	const entry = editing.value;
	if (entry) {
		const body: Record<string, unknown> = {};
		if (contribute.value && location !== entry.location) body.location = location;
		if (fullEdit.value) {
			if (entry.kind !== "inventory" && form.name.trim() !== entry.name) body.name = form.name.trim();
			if (form.quantity !== entry.quantity) body.quantity = form.quantity;
			if (form.notes !== entry.notes) body.notes = form.notes;
		}
		if (manage.value && entry.kind === "purchase") {
			if (estimated_cents !== entry.estimated_cents) body.estimated_cents = estimated_cents;
			if ((form.buyer_id ?? null) !== (entry.buyer?.id ?? null)) body.buyer_id = form.buyer_id ?? null;
		}
		if (consumable.value && form.used_quantity !== entry.used_quantity)
			body.used_quantity = form.used_quantity;
		if (!Object.keys(body).length) {
			saving.value = false;
			entryDialog.open = false;
			return;
		}
		const saved = await updateEntry(entry, body, "Gespeichert");
		saving.value = false;
		if (saved) entryDialog.open = false;
		return;
	}

	const result = await useAPI((api) =>
		api.postEventsByEventIdMaterials({
			path: { eventId: eventId.value },
			body: {
				kind: kind.value,
				resource_id: kind.value === "inventory" ? (form.resource_id ?? null) : null,
				name: kind.value === "inventory" ? null : form.name.trim(),
				quantity: form.quantity,
				location,
				notes: form.notes,
				owner_id: kind.value === "own" ? (form.owner_id ?? null) : null,
				estimated_cents: kind.value === "purchase" ? estimated_cents : null,
				buyer_id: kind.value === "purchase" ? (form.buyer_id ?? null) : null,
				request_id: request.value?.id ?? null,
			},
		}),
	);
	saving.value = false;
	if (!result.success) {
		const conflict = (result.code as number) === 409;
		toast.add({
			title: conflict ? "Nicht genug frei" : "Speichern fehlgeschlagen",
			description: conflict ? "An diesen Tagen ist nicht mehr davon im Lager frei." : result.message,
			color: "error",
		});
		return;
	}
	toast.add({
		title: `„${result.data.name}“ eingetragen`,
		color: "success",
		icon: "i-lucide-check",
	});
	entryDialog.open = false;
	if (request.value) await refresh();
	else replaceItem(result.data);
}
</script>

<template>
	<DashboardModal v-model:open="entryDialog.open" :title="title" :icon="icon">
		<form class="space-y-4" @submit.prevent="submit">
			<UAlert
				v-if="request"
				icon="i-lucide-message-circle-question"
				color="info"
				variant="subtle"
				:title="`Anfrage: ${materialLabel(request)}`"
				:description="request.notes || `von ${request.requested_by?.display_name ?? 'jemandem'}`"
			/>

			<UFormField v-if="kind === 'inventory' && !editing" label="Aus dem Lager" required>
				<USelectMenu
					v-model="form.resource_id"
					:items="catalogOptions"
					value-key="value"
					:loading="catalogLoading"
					placeholder="Material wählen"
					:search-input="{ placeholder: 'Suchen …' }"
					class="w-full"
				/>
			</UFormField>
			<p v-if="selectedResource?.notes" class="-mt-2 text-xs text-slate-400">{{ selectedResource.notes }}</p>
			<p v-if="selectedResource?.location" class="-mt-2 text-xs text-slate-400">
				Lagerort: {{ selectedResource.location }}
			</p>

			<UFormField v-if="kind !== 'inventory'" label="Was" required>
				<UInput
					v-model="form.name"
					:disabled="!fullEdit"
					placeholder="z. B. Schwungtuch, Beamer, Wasserbomben"
					class="w-full"
					:maxlength="120"
					autofocus
				/>
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField
					label="Menge"
					:hint="maxQuantity !== undefined ? `höchstens ${maxQuantity}` : undefined"
				>
					<UInputNumber v-model="form.quantity" :min="1" :max="maxQuantity" :disabled="!fullEdit" class="w-full" />
				</UFormField>
				<UFormField label="Wo" hint="beim Event">
					<!-- Free text with suggestions: what is typed counts, no need to pick it. -->
					<UInput
						v-model="form.location"
						list="material-locations"
						:disabled="!contribute"
						placeholder="z. B. Materialzelt"
						icon="i-lucide-map-pin"
						:maxlength="200"
						class="w-full"
					/>
					<datalist id="material-locations">
						<option v-for="place in locationSuggestions" :key="place" :value="place" />
					</datalist>
				</UFormField>
			</div>

			<UFormField v-if="consumable" label="Verbraucht" description="Wird vom Bestand im Lager abgezogen.">
				<UInputNumber v-model="form.used_quantity" :min="0" :max="form.quantity" class="w-full" />
			</UFormField>

			<template v-if="kind === 'purchase' && manage">
				<div class="grid gap-4 sm:grid-cols-2">
					<UFormField label="Geschätzter Preis">
						<UInput v-model="form.estimate" inputmode="decimal" placeholder="0,00" class="w-full">
							<template #trailing><span class="text-xs text-slate-500">€</span></template>
						</UInput>
					</UFormField>
					<UFormField label="Wer kauft es">
						<USelectMenu
							v-model="form.buyer_id"
							:items="memberOptions"
							value-key="value"
							placeholder="Noch offen"
							class="w-full"
						/>
					</UFormField>
				</div>
			</template>

			<UFormField v-if="kind === 'own' && manage && !editing" label="Wer bringt es mit">
				<USelectMenu
					v-model="form.owner_id"
					:items="memberOptions"
					value-key="value"
					placeholder="Ich"
					class="w-full"
				/>
			</UFormField>

			<UFormField v-if="fullEdit" label="Notizen">
				<UTextarea v-model="form.notes" :rows="2" autoresize :maxlength="2000" class="w-full" />
			</UFormField>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="entryDialog.open = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Eintragen'" :loading="saving" :disabled="!canSubmit" />
			</div>
		</form>
	</DashboardModal>
</template>
