<script setup lang="ts">
/**
 * Copy an event ("the same camp again next year"): a new name and start, and a choice of what
 * comes along — team, groups, rooms, responsibilities, program, tasks, documents, …
 */
import type { GetEventsByEventIdCopyResponses } from "~/api-client";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import type { EventWithAccess } from "~/utils/types";

type Summary = GetEventsByEventIdCopyResponses["200"]["data"];
type Part = Exclude<keyof Summary, "documents_size">;

const props = defineProps<{
	event: Pick<EventWithAccess, "id" | "name" | "type" | "start_date" | "end_date" | "recurrence">;
}>();

const emit = defineEmits<{
	copied: [event: EventWithAccess];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();

const PARTS: { key: Part; label: string; hint: string; icon: string; default: boolean }[] = [
	{
		key: "team",
		label: "Team",
		hint: "Leitung und Mitarbeitende mit Rolle und Funktion. Sie werden benachrichtigt.",
		icon: "i-lucide-contact",
		default: true,
	},
	{
		key: "groups",
		label: "Gruppen",
		hint: "Mit ihren Mitgliedern, wenn das Team übernommen wird.",
		icon: "i-lucide-users-round",
		default: true,
	},
	{
		key: "rooms",
		label: "Zimmer",
		hint: "Und wer wo schläft, für alle übernommenen Personen.",
		icon: "i-lucide-bed-double",
		default: true,
	},
	{
		key: "responsibilities",
		label: "Zuständigkeiten",
		hint: "Mit den Zuständigen, wenn das Team übernommen wird.",
		icon: "i-lucide-badge-check",
		default: true,
	},
	{
		key: "program",
		label: "Programm",
		hint: "Zur selben Uhrzeit, um den neuen Beginn verschoben.",
		icon: "i-lucide-calendar-range",
		default: true,
	},
	{
		key: "tasks",
		label: "Aufgaben",
		hint: "Wieder offen; Fälligkeiten wandern mit dem neuen Beginn.",
		icon: "i-lucide-list-todo",
		default: true,
	},
	{
		key: "budget",
		label: "Budgetplanung",
		hint: "Die geplanten Posten, keine Ausgaben oder Belege.",
		icon: "i-lucide-wallet",
		default: true,
	},
	{
		key: "notes",
		label: "Notizen",
		hint: "Notizen des Events; die der Gruppen nur mit den Gruppen.",
		icon: "i-lucide-sticky-note",
		default: false,
	},
	{
		key: "announcements",
		label: "Neuigkeiten",
		hint: "Die Ankündigungen an das Team.",
		icon: "i-lucide-megaphone",
		default: false,
	},
	{
		key: "documents",
		label: "Dokumente",
		hint: "Alle Ordner und Dateien als eigene Kopien.",
		icon: "i-lucide-folder",
		default: false,
	},
	{
		key: "resources",
		label: "Ressourcen",
		hint: "Reservierungen, soweit die Ressource am neuen Termin frei ist.",
		icon: "i-lucide-package",
		default: false,
	},
	{
		key: "participants",
		label: "Teilnehmende",
		hint: "Mit allen Angaben (auch zur Gesundheit), neu angemeldet und unbezahlt.",
		icon: "i-lucide-users",
		default: false,
	},
];

const summary = ref<Summary | null>(null);
const loading = ref(false);
const saving = ref(false);

const form = reactive({
	name: "",
	start_date: "",
	end_date: "",
	include: Object.fromEntries(PARTS.map((part) => [part.key, part.default])) as Record<
		Part,
		boolean
	>,
});

function shiftDay(day: string, days: number) {
	const date = parseDay(day);
	date.setDate(date.getDate() + days);
	return toDayString(date);
}

function daysBetween(from: string, to: string) {
	return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

const duration = computed(() => daysBetween(props.event.start_date, props.event.end_date));

/** "Sommercamp 2026" → "Sommercamp 2027"; anything else gets "(Kopie)". */
function suggestName(name: string, startDate: string, newStart: string) {
	const year = startDate.slice(0, 4);
	const nextYear = newStart.slice(0, 4);
	if (year !== nextYear && name.includes(year)) return name.replaceAll(year, nextYear);
	return `${name} (Kopie)`.slice(0, 120);
}

watch(open, async (isOpen) => {
	if (!isOpen) return;
	// The same weekday a year later (52 weeks), so a camp from Monday to Sunday stays one.
	const start = shiftDay(props.event.start_date, 364);
	form.name = suggestName(props.event.name, props.event.start_date, start);
	form.start_date = start;
	form.end_date = shiftDay(start, duration.value);
	for (const part of PARTS) form.include[part.key] = part.default;

	summary.value = null;
	loading.value = true;
	const result = await useAPI((api) =>
		api.getEventsByEventIdCopy({ path: { eventId: props.event.id } }),
	);
	loading.value = false;
	if (!result.success) {
		toast.add({
			title: "Die Vorlage konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		open.value = false;
		return;
	}
	summary.value = result.data;
	// Nothing to copy: nothing to tick.
	for (const part of PARTS) {
		if (result.data[part.key] === 0) form.include[part.key] = false;
	}
});

/** Moving the start keeps the length. */
function setStart(value: string | null) {
	const previous = form.start_date;
	form.start_date = value ?? "";
	if (value && previous && form.end_date) {
		form.end_date = shiftDay(value, daysBetween(previous, form.end_date));
	}
}

const moved = computed(() =>
	form.start_date ? daysBetween(props.event.start_date, form.start_date) : 0,
);

function countLabel(part: Part) {
	const count = summary.value?.[part] ?? 0;
	if (part === "documents" && count > 0) {
		return `${count} · ${formatFileSize(summary.value?.documents_size ?? 0)}`;
	}
	return String(count);
}

const canSubmit = computed(
	() =>
		form.name.trim().length > 0 &&
		Boolean(form.start_date) &&
		Boolean(form.end_date) &&
		form.end_date >= form.start_date,
);

async function submit() {
	if (!canSubmit.value) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdCopy({
			path: { eventId: props.event.id },
			body: {
				name: form.name.trim(),
				start_date: form.start_date,
				end_date: form.end_date,
				include: { ...form.include },
			},
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Kopieren fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	const { event, skipped_bookings, skipped_files } = result.data;
	toast.add({
		title: `„${event.name}“ angelegt`,
		description: "Die Kopie ist in Planung. Prüfe Termine und Team.",
		color: "success",
		icon: "i-lucide-copy-check",
	});
	if (skipped_bookings.length) {
		toast.add({
			title: "Nicht alle Ressourcen waren frei",
			description: `Nicht reserviert: ${skipped_bookings.join(", ")}`,
			color: "warning",
			icon: "i-lucide-package-x",
		});
	}
	if (skipped_files > 0) {
		toast.add({
			title: `${skipped_files} Datei(en) konnten nicht kopiert werden`,
			description: "Ihr Inhalt fehlt auf dem Server.",
			color: "warning",
		});
	}

	open.value = false;
	await useMyEventsStore().refresh();
	emit("copied", event);
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="`„${event.name}“ kopieren`"
		icon="i-lucide-copy"
		width="sm:max-w-2xl"
		:loading="loading"
	>
		<form class="space-y-5" @submit.prevent="submit">
			<UFormField label="Name der Kopie" required>
				<UInput v-model="form.name" class="w-full" maxlength="120" autofocus />
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField :label="event.type === 'recurring' ? 'Erster Termin' : 'Beginn'" required>
					<FormDatePicker :model-value="form.start_date" @update:model-value="setStart" />
				</UFormField>
				<UFormField :label="event.type === 'recurring' ? 'Serie endet am' : 'Ende'" required>
					<FormDatePicker v-model="form.end_date" :min="form.start_date || undefined" />
				</UFormField>
			</div>

			<p class="-mt-2 text-xs text-slate-500">
				<template v-if="event.type === 'recurring' && event.recurrence">
					{{ describeRecurrence(event.recurrence, form.start_date || event.start_date) }} — die Termine
					entstehen neu aus dieser Regel.
				</template>
				<template v-else-if="moved !== 0">
					Programm und Fälligkeiten verschieben sich um {{ Math.abs(moved) }}
					{{ Math.abs(moved) === 1 ? "Tag" : "Tage" }} {{ moved > 0 ? "nach hinten" : "nach vorn" }}.
				</template>
			</p>

			<div class="space-y-2">
				<p class="text-sm font-medium text-slate-200">Was soll übernommen werden?</p>
				<p class="text-xs text-slate-500">
					Die Stammdaten (Beschreibung, Ort, Farbe, Plätze, Beitrag, Budget) kommen immer mit. Ausgaben,
					Chats und das Audit-Log bleiben beim Original.
				</p>
				<ul class="grid gap-2 sm:grid-cols-2">
					<li v-for="part in PARTS" :key="part.key">
						<label
							:class="[
								'flex h-full cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
								form.include[part.key]
									? 'border-primary/50 bg-primary/5'
									: 'border-slate-800 hover:border-slate-700',
								summary?.[part.key] === 0 ? 'cursor-not-allowed opacity-50' : '',
							]"
						>
							<UCheckbox
								v-model="form.include[part.key]"
								:disabled="summary?.[part.key] === 0"
								class="mt-0.5"
							/>
							<span class="min-w-0 flex-1">
								<span class="flex items-center justify-between gap-2">
									<span class="flex items-center gap-1.5 text-sm font-medium text-slate-200">
										<UIcon :name="part.icon" class="size-4 shrink-0 text-slate-400" />
										{{ part.label }}
									</span>
									<UBadge :label="countLabel(part.key)" color="neutral" variant="subtle" size="sm" />
								</span>
								<span class="mt-0.5 block text-xs text-slate-500">{{ part.hint }}</span>
							</span>
						</label>
					</li>
				</ul>
				<p v-if="!form.include.team" class="flex items-start gap-2 text-xs text-amber-400">
					<UIcon name="i-lucide-info" class="mt-0.5 size-3.5 shrink-0" />
					Ohne Team bleiben Gruppen, Zuständigkeiten, Programm und Aufgaben ohne zugeteilte Personen.
				</p>
			</div>

			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton
					type="submit"
					label="Kopie anlegen"
					icon="i-lucide-copy"
					:loading="saving"
					:disabled="!canSubmit"
				/>
			</div>
		</form>
	</DashboardModal>
</template>
