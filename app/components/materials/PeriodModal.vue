<script setup lang="ts">
/**
 * How many days before and after the event its inventory bookings hold the material (fetching,
 * packing, bringing back). The API refuses days on which the inventory isn't free.
 */
const { event, eventId, period, periodDialog, refresh } = useEventMaterials();
const toast = useToast();

const MAX_DAYS = 14;
const form = reactive({ days_before: 0, days_after: 0 });
const saving = ref(false);

watch(
	() => periodDialog.open,
	(open) => {
		if (!open) return;
		form.days_before = period.value?.days_before ?? 0;
		form.days_after = period.value?.days_after ?? 0;
	},
);

function shift(date: string, days: number) {
	const day = parseDay(date);
	day.setDate(day.getDate() + days);
	return toDayString(day);
}

const preview = computed(
	() =>
		`${formatDay(shift(event.value.start_date, -form.days_before))} – ${formatDay(shift(event.value.end_date, form.days_after))}`,
);

async function submit() {
	saving.value = true;
	const result = await useAPI((api) =>
		api.putEventsByEventIdMaterialsPeriod({
			path: { eventId: eventId.value },
			body: { days_before: form.days_before, days_after: form.days_after },
		}),
	);
	saving.value = false;
	if (!result.success) {
		const conflict = (result.code as number) === 409;
		toast.add({
			title: conflict ? "Nicht genug frei" : "Speichern fehlgeschlagen",
			description: conflict
				? `An den zusätzlichen Tagen ist nicht genug frei: ${result.message.split(": ").slice(1).join(": ")}`
				: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Materialzeitraum gespeichert", color: "success", icon: "i-lucide-check" });
	periodDialog.open = false;
	await refresh();
}
</script>

<template>
	<DashboardModal
		v-model:open="periodDialog.open"
		title="Materialzeitraum"
		description="Material wird oft vorher abgeholt und danach zurückgebracht. So lange bleibt es für dieses Event reserviert."
		icon="i-lucide-calendar-range"
	>
		<form class="space-y-4" @submit.prevent="submit">
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Tage vorher">
					<UInputNumber v-model="form.days_before" :min="0" :max="MAX_DAYS" class="w-full" />
				</UFormField>
				<UFormField label="Tage danach">
					<UInputNumber v-model="form.days_after" :min="0" :max="MAX_DAYS" class="w-full" />
				</UFormField>
			</div>
			<p class="text-sm text-slate-300">
				Reserviert: <span class="font-medium text-white">{{ preview }}</span>
			</p>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="periodDialog.open = false" />
				<UButton type="submit" label="Speichern" :loading="saving" />
			</div>
		</form>
	</DashboardModal>
</template>
