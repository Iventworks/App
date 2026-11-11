<script setup lang="ts">
/**
 * Fill the duty roster of the upcoming dates from the people who usually do each responsibility:
 * all of them on every date, or taking turns.
 */
import type { OccurrenceResponsibility } from "~/utils/types";

const props = defineProps<{
	eventId: number;
	responsibilities: OccurrenceResponsibility[];
}>();

const emit = defineEmits<{
	planned: [];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const saving = ref(false);

const MODES = [
	{
		value: "rotate" as const,
		label: "Im Wechsel",
		description: "Eine Person pro Termin, reihum — z. B. wer die Andacht hält.",
	},
	{
		value: "standard" as const,
		label: "Standardbesetzung",
		description: "Alle üblich Zuständigen an jedem Termin — z. B. das feste Technikteam.",
	},
];

const form = reactive({
	mode: "rotate" as "rotate" | "standard",
	responsibilityIds: [] as number[],
	overwrite: false,
});

/** Only responsibilities that have people to draw from. */
const usable = computed(() => props.responsibilities.filter((entry) => entry.assignees.length > 0));
const options = computed(() =>
	usable.value.map((entry) => ({
		label: entry.title,
		value: entry.id,
		description: entry.assignees.map((user) => user.display_name).join(", "),
	})),
);

watch(open, (isOpen) => {
	if (!isOpen) return;
	form.mode = "rotate";
	form.overwrite = false;
	form.responsibilityIds = usable.value.map((entry) => entry.id);
});

async function submit() {
	if (!form.responsibilityIds.length) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdOccurrencesPlan({
			path: { eventId: props.eventId },
			body: {
				mode: form.mode,
				responsibility_ids: form.responsibilityIds,
				overwrite: form.overwrite,
			},
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({
			title: "Dienstplan konnte nicht gefüllt werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	const { occurrences, duties } = result.data;
	toast.add(
		duties > 0
			? {
					title: `${duties} ${duties === 1 ? "Dienst" : "Dienste"} an ${occurrences} ${occurrences === 1 ? "Termin" : "Terminen"} eingeteilt`,
					description: "Die Eingeteilten wurden benachrichtigt.",
					color: "success",
					icon: "i-lucide-wand-sparkles",
				}
			: {
					title: "Nichts zu füllen",
					description: "Alle kommenden Termine sind für diese Zuständigkeiten schon besetzt.",
					color: "neutral",
				},
	);
	open.value = false;
	emit("planned");
}
</script>

<template>
	<DashboardModal v-model:open="open" title="Dienstplan füllen" icon="i-lucide-wand-sparkles">
		<UEmpty
			v-if="!usable.length"
			icon="i-lucide-badge-check"
			title="Noch niemand zuständig"
			description="Trage bei den Zuständigkeiten ein, wer sie üblicherweise übernimmt. Daraus wird der Dienstplan gefüllt."
			variant="naked"
		>
			<template #actions>
				<UButton
					:to="`/events/${eventId}/responsibilities`"
					label="Zu den Zuständigkeiten"
					icon="i-lucide-badge-check"
					color="neutral"
					variant="subtle"
					@click="open = false"
				/>
			</template>
		</UEmpty>

		<form v-else class="space-y-5" @submit.prevent="submit">
			<p class="text-sm text-slate-400">
				Füllt alle kommenden Termine aus den Personen, die für eine Zuständigkeit üblicherweise
				eingetragen sind.
			</p>

			<UFormField label="Wie verteilen?">
				<URadioGroup v-model="form.mode" :items="MODES" value-key="value" variant="card" />
			</UFormField>

			<UFormField label="Für diese Zuständigkeiten">
				<USelectMenu
					v-model="form.responsibilityIds"
					:items="options"
					value-key="value"
					multiple
					placeholder="Zuständigkeiten auswählen"
					class="w-full"
				/>
			</UFormField>

			<USwitch
				v-model="form.overwrite"
				label="Bestehende Einteilungen überschreiben"
				description="Sonst werden nur offene Dienste gefüllt."
			/>

			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton
					type="submit"
					label="Dienstplan füllen"
					icon="i-lucide-wand-sparkles"
					:loading="saving"
					:disabled="!form.responsibilityIds.length"
				/>
			</div>
		</form>
	</DashboardModal>
</template>
