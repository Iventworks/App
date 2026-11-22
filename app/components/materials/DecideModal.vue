<script setup lang="ts">
/** The Leitung settles a request ("Erledigt") or rejects it, with a note to who asked. */
const { eventId, decideDialog, refresh } = useEventMaterials();
const toast = useToast();

const answer = ref("");
const saving = ref(false);

watch(
	() => decideDialog.open,
	(open) => {
		if (open) answer.value = "";
	},
);

const rejecting = computed(() => decideDialog.status === "rejected");

async function submit() {
	const request = decideDialog.request;
	if (!request) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.putEventsByEventIdMaterialsRequestsByRequestId({
			path: { eventId: eventId.value, requestId: request.id },
			body: { status: decideDialog.status, answer: answer.value.trim() || null },
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: rejecting.value ? "Anfrage abgelehnt" : "Anfrage erledigt",
		color: "success",
		icon: "i-lucide-check",
	});
	decideDialog.open = false;
	await refresh();
}
</script>

<template>
	<DashboardModal
		v-model:open="decideDialog.open"
		:title="rejecting ? 'Anfrage ablehnen' : 'Anfrage erledigt'"
		:description="decideDialog.request ? materialLabel(decideDialog.request) : undefined"
		:icon="rejecting ? 'i-lucide-x' : 'i-lucide-check'"
		:icon-color="rejecting ? 'error' : 'emerald'"
	>
		<form class="space-y-4" @submit.prevent="submit">
			<UFormField
				:label="rejecting ? 'Warum nicht?' : 'Nachricht'"
				:description="
					rejecting
						? 'Wer gefragt hat, bekommt Bescheid.'
						: 'Z. B. „Haben wir schon“ – wer gefragt hat, bekommt Bescheid.'
				"
			>
				<UTextarea v-model="answer" :rows="2" autoresize :maxlength="2000" class="w-full" autofocus />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="decideDialog.open = false" />
				<UButton
					type="submit"
					:label="rejecting ? 'Ablehnen' : 'Erledigt'"
					:color="rejecting ? 'error' : 'primary'"
					:loading="saving"
				/>
			</div>
		</form>
	</DashboardModal>
</template>
