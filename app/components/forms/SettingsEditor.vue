<script setup lang="ts">
/**
 * "Einstellungen": the text after sending, for forms until when it takes answers, and for an
 * event's Leitung who works on the form.
 */
import type { FormManagers } from "~/utils/forms";

const detail = useFormDetail();
const { form, isTemplate } = detail;
const toast = useToast();
const askUnsaved = useUnsavedChangesDialog();

const DEFAULT_CONFIRMATION = "Danke! Deine Antwort wurde gespeichert.";

const confirmation = ref(form.value.confirmation_message);
const closesAt = ref(toDateTimeInput(form.value.closes_at));
const managersOf = (leadersOnly: boolean): FormManagers => (leadersOnly ? "leaders" : "team");
const managers = ref<FormManagers>(managersOf(form.value.leaders_only));

/** Closing times compare by the minute, as the picker shows them (the API takes any time). */
function sameClosingTime(input: string, ts: number | null) {
	return toDateTimeInput(fromDateTimeInput(input)) === toDateTimeInput(ts);
}

const dirty = computed(
	() =>
		confirmation.value.trim() !== form.value.confirmation_message ||
		!sameClosingTime(closesAt.value, form.value.closes_at) ||
		managers.value !== managersOf(form.value.leaders_only),
);
watch(dirty, (value) => (detail.dirty.value = value), { immediate: true });
onUnmounted(() => {
	detail.dirty.value = false;
});

// The header changes these too (reopening drops a closing time that has passed): what wasn't
// edited here follows the server.
watch(
	() => form.value.confirmation_message,
	(now, before) => {
		if (confirmation.value.trim() === before) confirmation.value = now;
	},
);
watch(
	() => form.value.closes_at,
	(now, before) => {
		if (sameClosingTime(closesAt.value, before)) closesAt.value = toDateTimeInput(now);
	},
);

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
		...(form.value.can_restrict && managers.value !== managersOf(form.value.leaders_only)
			? { leaders_only: managers.value === "leaders" }
			: {}),
	});
	saving.value = false;
	if (ok) toast.add({ title: "Gespeichert", icon: "i-lucide-check", color: "success" });
	return ok;
}

onBeforeRouteLeave(async () => {
	if (!dirty.value || detail.deleted.value) return true;
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

		<DashboardSectionCard
			v-if="form.can_restrict"
			title="Wer arbeitet daran?"
			description="Formulare im Event bearbeitet das ganze Team, wenn die Leitung sie nicht für sich behält."
			icon="i-lucide-users"
		>
			<URadioGroup v-model="managers" :items="[...FORM_MANAGERS]" value-key="value" variant="card" />
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
					managers = managersOf(form.leaders_only);
				"
			/>
			<UButton label="Speichern" icon="i-lucide-save" :disabled="!dirty" :loading="saving" @click="save" />
		</div>
	</div>
</template>
