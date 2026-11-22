<script setup lang="ts">
/** Ask for material by name (anyone on the team), or change a request. */
const { eventId, requestDialog, programItems, refresh } = useEventMaterials();
const toast = useToast();

const form = reactive({
	name: "",
	quantity: 1,
	notes: "",
	program_item_id: undefined as number | undefined,
});
const saving = ref(false);

watch(
	() => requestDialog.open,
	(open) => {
		if (!open) return;
		const request = requestDialog.editing;
		Object.assign(form, {
			name: request?.name ?? "",
			quantity: request?.quantity ?? 1,
			notes: request?.notes ?? "",
			program_item_id: request?.program_item?.id ?? requestDialog.programItemId ?? undefined,
		});
	},
);

const programOptions = computed(() =>
	[...(programItems.value ?? [])]
		.sort((a, b) => a.start_at - b.start_at)
		.map((item) => ({
			label: item.title,
			value: item.id,
			description: `${formatShortDay(item.start_at)}, ${formatTimeRange(item.start_at, item.end_at)}`,
		})),
);

async function submit() {
	if (!form.name.trim()) return;
	saving.value = true;
	const body = {
		name: form.name.trim(),
		quantity: form.quantity,
		notes: form.notes,
		program_item_id: form.program_item_id ?? null,
	};
	const editing = requestDialog.editing;
	const result = editing
		? await useAPI((api) =>
				api.putEventsByEventIdMaterialsRequestsByRequestId({
					path: { eventId: eventId.value, requestId: editing.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdMaterialsRequests({ path: { eventId: eventId.value }, body }),
			);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: editing ? "Anfrage gespeichert" : "Anfrage gestellt",
		description: editing ? undefined : "Die Leitung bekommt Bescheid.",
		color: "success",
		icon: "i-lucide-check",
	});
	requestDialog.open = false;
	await refresh();
}
</script>

<template>
	<DashboardModal
		v-model:open="requestDialog.open"
		:title="requestDialog.editing ? 'Anfrage bearbeiten' : 'Etwas anfragen'"
		description="Die Leitung schaut, ob es im Lager ist, gekauft wird oder jemand es mitbringt."
		icon="i-lucide-message-circle-question"
	>
		<form class="space-y-4" @submit.prevent="submit">
			<div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
				<UFormField label="Was brauchst du" required>
					<UInput v-model="form.name" placeholder="z. B. Schwungtuch" :maxlength="120" class="w-full" autofocus />
				</UFormField>
				<UFormField label="Menge">
					<UInputNumber v-model="form.quantity" :min="1" class="w-full" />
				</UFormField>
			</div>
			<UFormField label="Für einen Programmpunkt">
				<USelectMenu
					v-model="form.program_item_id"
					:items="programOptions"
					value-key="value"
					placeholder="Keinen"
					class="w-full"
					clear
				/>
			</UFormField>
			<UFormField label="Wofür / Details">
				<UTextarea v-model="form.notes" :rows="3" autoresize :maxlength="2000" class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="requestDialog.open = false" />
				<UButton
					type="submit"
					:label="requestDialog.editing ? 'Speichern' : 'Anfragen'"
					:loading="saving"
					:disabled="!form.name.trim()"
				/>
			</div>
		</form>
	</DashboardModal>
</template>
