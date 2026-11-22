<script setup lang="ts">
/**
 * Export the program as a PDF — to download or to print right away. Two layouts: "Liste" (A4
 * portrait, day by day) and "Wochenraster" (A4 landscape, like the Wochenplan). The PDF is built
 * in the browser (`buildProgramPdf`), from the items the page already has.
 */
import type {
	GetEventsByEventIdProgramResponses,
	GetEventsByEventIdSmallGroupsResponses,
} from "~/api-client";
import type { ProgramPdfLayout } from "~/utils/programPdf";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];
type SmallGroup = GetEventsByEventIdSmallGroupsResponses["200"]["data"][number];

const props = defineProps<{
	eventName: string;
	/** Every day of the event (`YYYY-MM-DD`). */
	days: string[];
	items: ProgramItem[];
	smallGroups: SmallGroup[];
	/** The page's "Nur meine" filter, taken over when the dialog opens. */
	onlyMine: boolean;
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const brandName = useBrandName();

const LAYOUTS = [
	{
		value: "list",
		label: "Liste",
		description: "A4 hoch · Tag für Tag mit Ort, Verantwortlichen und Beschreibung.",
	},
	{
		value: "grid",
		label: "Wochenraster",
		description: "A4 quer · bis zu 7 Tage pro Seite, wie der Wochenplan.",
	},
];

const form = reactive({
	layout: "list" as ProgramPdfLayout,
	from: "",
	to: "",
	onlyMine: false,
	descriptions: true,
	responsibles: true,
	smallGroupAppendix: true,
});

watch(
	open,
	(value) => {
		if (!value) return;
		form.from = props.days[0] ?? "";
		form.to = props.days[props.days.length - 1] ?? "";
		form.onlyMine = props.onlyMine;
	},
	{ immediate: true },
);

const dayOptions = computed(() =>
	props.days.map((day) => ({ label: formatShortDay(day), value: day })),
);
const toOptions = computed(() => dayOptions.value.filter((option) => option.value >= form.from));

watch(
	() => form.from,
	(from) => {
		if (form.to < from) form.to = from;
	},
);

const selectedDays = computed(() => props.days.filter((day) => day >= form.from && day <= form.to));

const selectedItems = computed(() => {
	const first = selectedDays.value[0];
	const last = selectedDays.value[selectedDays.value.length - 1];
	if (!first || !last) return [];
	const start = parseDay(first).getTime();
	const end = parseDay(last);
	end.setDate(end.getDate() + 1);
	return props.items.filter(
		(item) =>
			(!form.onlyMine || item.is_mine) && item.end_at > start && item.start_at < end.getTime(),
	);
});

const canAppendSmallGroups = computed(
	() => props.smallGroups.length > 0 && selectedItems.value.some((item) => item.in_small_groups),
);

const summary = computed(() => {
	const count = selectedItems.value.length;
	const dayCount = selectedDays.value.length;
	const days = `${dayCount} ${dayCount === 1 ? "Tag" : "Tagen"}`;
	if (count === 0) return `Keine Programmpunkte an ${days} – das PDF zeigt einen leeren Plan.`;
	return `${count} ${count === 1 ? "Programmpunkt" : "Programmpunkte"} an ${days}.`;
});

const busy = ref<"download" | "print" | null>(null);

function build(autoPrint: boolean) {
	return buildProgramPdf({
		layout: form.layout,
		eventName: props.eventName,
		eventStart: props.days[0] ?? form.from,
		orgName: brandName.value,
		days: selectedDays.value,
		items: selectedItems.value,
		smallGroups: props.smallGroups,
		descriptions: form.descriptions,
		responsibles: form.responsibles,
		smallGroupAppendix: form.smallGroupAppendix && canAppendSmallGroups.value,
		onlyMine: form.onlyMine,
		autoPrint,
	});
}

function fileName() {
	return programPdfFileName(props.eventName, form.layout);
}

function failed(error: unknown) {
	console.error("Program PDF failed", error);
	toast.add({
		title: "PDF konnte nicht erstellt werden",
		description: "Bitte versuche es erneut.",
		icon: "i-lucide-alert-circle",
		color: "error",
	});
}

async function download() {
	if (busy.value) return;
	busy.value = "download";
	try {
		const blob = await build(false);
		downloadBlob(blob, fileName());
		open.value = false;
	} catch (error) {
		failed(error);
	} finally {
		busy.value = null;
	}
}

async function print() {
	if (busy.value) return;
	busy.value = "print";

	// A new tab has to be opened while the click still counts (before the PDF is built).
	const target = pdfPrintTarget();
	const tab = target === "tab" ? window.open("", "_blank") : null;
	try {
		if (tab) tab.document.title = "PDF wird erstellt …";
	} catch {
		// Only a courtesy title for the empty tab.
	}

	try {
		const blob = await build(target === "tab");
		open.value = false;

		const downloadInstead = () => {
			downloadBlob(blob, fileName());
			toast.add({
				title: "Drucken nicht möglich",
				description: "Das PDF wurde stattdessen heruntergeladen – öffne und drucke es von dort.",
				icon: "i-lucide-file-down",
				color: "warning",
			});
		};

		if (target === "frame") {
			printPdfBlobInFrame(blob, downloadInstead);
		} else if (tab && !tab.closed) {
			const url = URL.createObjectURL(blob);
			tab.location.href = url;
			setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
		} else {
			downloadInstead();
		}
	} catch (error) {
		tab?.close();
		failed(error);
	} finally {
		busy.value = null;
	}
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		title="Programm exportieren"
		description="Als PDF herunterladen oder direkt drucken."
		icon="i-lucide-file-down"
	>
		<div class="space-y-5">
			<UFormField label="Layout" name="layout">
				<URadioGroup
					v-model="form.layout"
					:items="LAYOUTS"
					value-key="value"
					variant="card"
					:ui="{ fieldset: 'grid gap-2 sm:grid-cols-2' }"
				/>
			</UFormField>

			<div v-if="days.length > 1" class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Von" name="from">
					<USelect v-model="form.from" :items="dayOptions" class="w-full" />
				</UFormField>
				<UFormField label="Bis" name="to">
					<USelect v-model="form.to" :items="toOptions" class="w-full" />
				</UFormField>
			</div>

			<div class="space-y-3">
				<USwitch v-model="form.onlyMine" label="Nur meine Programmpunkte" />
				<USwitch v-model="form.responsibles" label="Verantwortliche zeigen" />
				<USwitch
					v-if="form.layout === 'list'"
					v-model="form.descriptions"
					label="Beschreibungen zeigen"
					description="Ablauf und Hinweise unter jedem Programmpunkt."
				/>
				<USwitch
					v-if="canAppendSmallGroups"
					v-model="form.smallGroupAppendix"
					label="Kleingruppen-Übersicht anhängen"
					description="Treffpunkt und Leitung jeder Kleingruppe auf einer eigenen Seite."
				/>
			</div>

			<p class="text-sm text-slate-400">{{ summary }}</p>
		</div>

		<template #footer>
			<UButton
				label="Drucken"
				icon="i-lucide-printer"
				color="neutral"
				variant="subtle"
				:loading="busy === 'print'"
				:disabled="busy !== null || !selectedDays.length"
				@click="print"
			/>
			<UButton
				label="PDF herunterladen"
				icon="i-lucide-file-down"
				:loading="busy === 'download'"
				:disabled="busy !== null || !selectedDays.length"
				@click="download"
			/>
		</template>
	</DashboardModal>
</template>
