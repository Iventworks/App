<script setup lang="ts">
/**
 * One date of a recurring event: its topic and notes, its own time and place (empty = as the
 * series), and whether it takes place. New dates are added by hand — an extra one or the
 * replacement for a cancelled one.
 */
import type { EventOccurrence, EventWithAccess } from "~/utils/types";

const props = defineProps<{
	event: Pick<EventWithAccess, "id" | "name" | "location" | "recurrence">;
	/** The date to edit; null adds a new one. */
	occurrence: EventOccurrence | null;
	/** Open with "fällt aus" switched on (the "Absagen" action). */
	presetCancelled?: boolean;
}>();

const emit = defineEmits<{
	saved: [occurrence: EventOccurrence];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const saving = ref(false);

const form = reactive({
	date: "",
	title: "",
	notes: "",
	/** The date's own time; null = the time of the series. */
	start_time: null as string | null,
	end_time: null as string | null,
	location: "",
	cancelled: false,
	cancel_reason: "",
});

const isNew = computed(() => props.occurrence === null);
/** Dates of the series keep their day: they are cancelled, not moved. */
const canMove = computed(() => isNew.value || props.occurrence?.origin === "manual");
const seriesTime = computed(() =>
	timeRangeLabel(props.event.recurrence?.start_time, props.event.recurrence?.end_time),
);

watch(open, (isOpen) => {
	if (!isOpen) return;
	const occurrence = props.occurrence;
	Object.assign(form, {
		date: occurrence?.date ?? "",
		title: occurrence?.title ?? "",
		notes: occurrence?.notes ?? "",
		start_time: occurrence?.custom_time ? occurrence.start_time : null,
		end_time: occurrence?.custom_time ? occurrence.end_time : null,
		location: occurrence?.custom_location ? (occurrence.location ?? "") : "",
		cancelled: props.presetCancelled || occurrence?.status === "cancelled",
		cancel_reason: occurrence?.cancel_reason ?? "",
	});
});

// A cleared start leaves the end alone: `submit` drops an end without a start anyway, and
// clearing it here would eat the end on the transient empty state while someone corrects the
// time.
function setStartTime(value: string | null) {
	form.start_time = value;
}

const timeError = computed(() =>
	form.start_time && form.end_time && form.end_time <= form.start_time
		? "Das Ende muss nach dem Beginn liegen"
		: undefined,
);
const canSubmit = computed(() => Boolean(form.date) && !timeError.value);

async function submit() {
	if (!canSubmit.value) return;
	saving.value = true;

	const fields = {
		title: form.title.trim() || null,
		notes: form.notes,
		start_time: form.start_time,
		end_time: form.start_time ? form.end_time : null,
		location: form.location.trim() || null,
	};

	const occurrence = props.occurrence;
	const result = occurrence
		? await useAPI((api) =>
				api.putEventsByEventIdOccurrencesByOccurrenceId({
					path: { eventId: props.event.id, occurrenceId: occurrence.id },
					body: {
						...fields,
						...(canMove.value && form.date !== occurrence.date ? { date: form.date } : {}),
						status: form.cancelled ? "cancelled" : "planned",
						cancel_reason: form.cancelled ? form.cancel_reason.trim() || null : null,
					},
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdOccurrences({
					path: { eventId: props.event.id },
					body: { date: form.date, ...fields },
				}),
			);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	const wasCancelled = occurrence?.status === "cancelled";
	toast.add({
		title: isNew.value
			? `Termin am ${formatDay(result.data.date)} hinzugefügt`
			: form.cancelled && !wasCancelled
				? `Termin am ${formatDay(result.data.date)} abgesagt`
				: "Termin gespeichert",
		description:
			form.cancelled && !wasCancelled && result.data.duties.length
				? "Die Eingeteilten wurden benachrichtigt."
				: undefined,
		color: "success",
		icon: "i-lucide-check",
	});
	open.value = false;
	emit("saved", result.data);
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="isNew ? 'Termin hinzufügen' : `Termin am ${formatDay(occurrence?.date)}`"
		icon="i-lucide-calendar-check"
	>
		<form class="space-y-4" @submit.prevent="submit">
			<UFormField
				label="Datum"
				required
				:help="
					canMove
						? isNew
							? 'Ein zusätzlicher Termin oder der Ersatz für einen ausgefallenen.'
							: undefined
						: 'Termine der Serie behalten ihren Tag. Sage ihn ab und füge einen Ersatztermin hinzu.'
				"
			>
				<FormDatePicker v-model="form.date" :disabled="!canMove" />
			</UFormField>

			<UFormField label="Thema">
				<UInput v-model="form.title" placeholder="z. B. Spieleabend" maxlength="200" class="w-full" />
			</UFormField>

			<div class="grid gap-3 sm:grid-cols-2">
				<UFormField label="Beginn" :help="form.start_time ? undefined : seriesTime ? `Wie die Serie: ${seriesTime}` : 'Ohne Uhrzeit'">
					<FormTimePicker :model-value="form.start_time" clearable @update:model-value="setStartTime" />
				</UFormField>
				<UFormField label="Ende" :error="timeError">
					<FormTimePicker v-model="form.end_time" clearable :disabled="!form.start_time" />
				</UFormField>
			</div>

			<UFormField label="Ort" :help="form.location ? undefined : event.location ? `Wie sonst: ${event.location}` : undefined">
				<UInput
					v-model="form.location"
					:placeholder="event.location ?? 'Ort für diesen Termin'"
					maxlength="200"
					class="w-full"
				/>
			</UFormField>

			<UFormField label="Notizen">
				<UTextarea
					v-model="form.notes"
					:rows="3"
					autoresize
					placeholder="Was ist für diesen Termin wichtig?"
					class="w-full"
				/>
			</UFormField>

			<div v-if="!isNew" class="space-y-3 rounded-lg border border-slate-800 p-3">
				<USwitch
					v-model="form.cancelled"
					label="Termin fällt aus"
					description="Er bleibt in der Liste stehen; wer eingeteilt ist, wird benachrichtigt."
				/>
				<UFormField v-if="form.cancelled" label="Grund">
					<UInput v-model="form.cancel_reason" placeholder="z. B. Ferien" maxlength="500" class="w-full" />
				</UFormField>
			</div>

			<div class="flex justify-end gap-2 pt-1">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton
					type="submit"
					:label="isNew ? 'Hinzufügen' : 'Speichern'"
					icon="i-lucide-check"
					:loading="saving"
					:disabled="!canSubmit"
				/>
			</div>
		</form>
	</DashboardModal>
</template>
