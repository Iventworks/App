<script setup lang="ts">
/**
 * Where an entry is used: program items, or the dates of a recurring event, each with an optional
 * quantity. Warns (doesn't block) when program items at the same time need more than there is.
 */
import type { MaterialLink } from "~/utils/types";

const {
	recurring,
	linksDialog,
	linksEntry,
	programItems,
	occurrences,
	addLink,
	removeLink,
	linkWarnings,
} = useEventMaterials();

const target = ref<number | undefined>(undefined);
const quantity = ref<number | null>(null);
const saving = ref(false);

watch(
	() => linksDialog.open,
	(open) => {
		if (!open) return;
		target.value = undefined;
		quantity.value = null;
	},
);

const linkedIds = computed(
	() =>
		new Set(
			(linksEntry.value?.links ?? []).map((link) =>
				recurring.value ? link.occurrence_id : link.program_item_id,
			),
		),
);

const options = computed(() =>
	recurring.value
		? (occurrences.value ?? [])
				.filter((date) => date.status === "planned" && date.date >= toDayString())
				.map((date) => ({
					label: formatShortDay(date.date),
					value: date.id,
					description: date.title ?? undefined,
					disabled: linkedIds.value.has(date.id),
				}))
		: [...(programItems.value ?? [])]
				.sort((a, b) => a.start_at - b.start_at)
				.map((item) => ({
					label: item.title,
					value: item.id,
					description: `${formatShortDay(item.start_at)}, ${formatTimeRange(item.start_at, item.end_at)}`,
					disabled: linkedIds.value.has(item.id),
				})),
);

function label(link: MaterialLink) {
	if (link.start_at && link.end_at) {
		return `${link.title} · ${formatShortDay(link.start_at)}, ${formatTimeRange(link.start_at, link.end_at)}`;
	}
	return `${link.date ? formatShortDay(link.date) : "Termin"}${link.title ? ` · ${link.title}` : ""}`;
}

async function add() {
	const entry = linksEntry.value;
	if (!entry || !target.value) return;
	saving.value = true;
	const saved = await addLink(
		entry,
		recurring.value ? { occurrence_id: target.value } : { program_item_id: target.value },
		quantity.value,
	);
	saving.value = false;
	if (saved) {
		target.value = undefined;
		quantity.value = null;
	}
}

async function changeQuantity(link: MaterialLink, value: number | null) {
	const entry = linksEntry.value;
	if (!entry) return;
	await addLink(
		entry,
		link.program_item_id
			? { program_item_id: link.program_item_id }
			: { occurrence_id: link.occurrence_id! },
		value,
	);
}
</script>

<template>
	<DashboardModal
		v-model:open="linksDialog.open"
		:title="recurring ? 'Für Termine einplanen' : 'Im Programm einplanen'"
		:description="linksEntry ? materialLabel(linksEntry) : undefined"
		icon="i-lucide-calendar-plus"
	>
		<div v-if="linksEntry" class="space-y-4">
			<UAlert
				v-for="warning in linkWarnings(linksEntry)"
				:key="warning.text"
				icon="i-lucide-triangle-alert"
				color="warning"
				variant="subtle"
				:description="warning.text"
			/>

			<ul v-if="linksEntry.links.length" class="space-y-2">
				<li
					v-for="link in linksEntry.links"
					:key="link.id"
					class="flex items-center gap-2 rounded-md bg-slate-800/40 px-3 py-2 text-sm"
				>
					<span class="min-w-0 flex-1 truncate text-slate-200">{{ label(link) }}</span>
					<UInputNumber
						:model-value="link.quantity ?? undefined"
						:min="1"
						placeholder="Anzahl"
						size="xs"
						class="w-24"
						@update:model-value="(value: number | null | undefined) => changeQuantity(link, value ?? null)"
					/>
					<UButton
						icon="i-lucide-x"
						color="neutral"
						variant="ghost"
						size="xs"
						aria-label="Nicht mehr einplanen"
						@click="removeLink(linksEntry, link)"
					/>
				</li>
			</ul>
			<p v-else class="text-sm text-slate-500">
				{{ recurring ? "Noch für keinen Termin eingeplant." : "Noch für keinen Programmpunkt eingeplant." }}
			</p>

			<form class="flex flex-col gap-2 rounded-lg border border-slate-800 p-3 sm:flex-row sm:items-end" @submit.prevent="add">
				<UFormField :label="recurring ? 'Termin' : 'Programmpunkt'" class="flex-1">
					<USelectMenu
						v-model="target"
						:items="options"
						value-key="value"
						:placeholder="recurring ? 'Termin wählen' : 'Programmpunkt wählen'"
						class="w-full"
					/>
				</UFormField>
				<UFormField label="Anzahl" class="sm:w-28">
					<UInputNumber v-model="quantity" :min="1" placeholder="–" class="w-full" />
				</UFormField>
				<UButton type="submit" label="Einplanen" icon="i-lucide-plus" :loading="saving" :disabled="!target" />
			</form>
		</div>

		<template #footer>
			<UButton label="Fertig" color="neutral" variant="subtle" @click="linksDialog.open = false" />
		</template>
	</DashboardModal>
</template>
