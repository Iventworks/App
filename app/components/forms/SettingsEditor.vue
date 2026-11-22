<script setup lang="ts">
/** "Einstellungen": the text after sending and, for forms, until when it takes answers. */
const detail = useFormDetail();
const { form, isTemplate } = detail;
const toast = useToast();
const askUnsaved = useUnsavedChangesDialog();

const DEFAULT_CONFIRMATION = "Danke! Deine Antwort wurde gespeichert.";

const confirmation = ref(form.value.confirmation_message);
const closesAt = ref(toDateTimeInput(form.value.closes_at));

const dirty = computed(
	() =>
		confirmation.value.trim() !== form.value.confirmation_message ||
		fromDateTimeInput(closesAt.value) !== form.value.closes_at,
);
watch(dirty, (value) => (detail.dirty.value = value), { immediate: true });
onUnmounted(() => {
	detail.dirty.value = false;
});

const closesInPast = computed(() => {
	const value = fromDateTimeInput(closesAt.value);
	return value !== null && value <= Date.now();
});

const saving = ref(false);

async function save() {
	saving.value = true;
	const ok = await detail.save({
		confirmation_message: confirmation.value.trim(),
		...(isTemplate.value ? {} : { closes_at: fromDateTimeInput(closesAt.value) }),
	});
	saving.value = false;
	if (ok) toast.add({ title: "Gespeichert", icon: "i-lucide-check", color: "success" });
	return ok;
}

onBeforeRouteLeave(async () => {
	if (!dirty.value) return true;
	const choice = await askUnsaved("Die Einstellungen haben ungespeicherte Änderungen.");
	if (choice === "save") return await save();
	return choice === "discard";
});
</script>

<template>
	<div class="mx-auto w-full max-w-3xl space-y-6">
		<DashboardSectionCard
			title="Nach dem Absenden"
			description="Diesen Text sieht, wer das Formular abgeschickt hat."
			icon="i-lucide-message-circle-heart"
		>
			<UTextarea v-model="confirmation" :placeholder="DEFAULT_CONFIRMATION" :rows="3" :maxlength="2000" autoresize class="w-full" />
		</DashboardSectionCard>

		<DashboardSectionCard
			v-if="!isTemplate"
			title="Antworten annehmen bis"
			description="Danach nimmt das Formular keine Antworten mehr an. Leer: bis du es schließt."
			icon="i-lucide-timer"
		>
			<div class="space-y-3">
				<FormDateTimePicker v-model="closesAt" clearable default-time="23:59" />
				<p v-if="closesInPast" class="flex items-center gap-1.5 text-sm text-amber-400">
					<UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
					Der Zeitpunkt liegt in der Vergangenheit: Das Formular nimmt dann keine Antworten an.
				</p>
			</div>
		</DashboardSectionCard>

		<div class="flex justify-end gap-2">
			<UButton
				v-if="dirty"
				label="Verwerfen"
				color="neutral"
				variant="ghost"
				@click="
					confirmation = form.confirmation_message;
					closesAt = toDateTimeInput(form.closes_at);
				"
			/>
			<UButton label="Speichern" icon="i-lucide-save" :disabled="!dirty" :loading="saving" @click="save" />
		</div>
	</div>
</template>
