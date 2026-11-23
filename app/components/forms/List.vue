<script setup lang="ts">
/**
 * The forms of a place (Kernteam, an event) or the templates: status, answers, last change; a
 * row opens the form. Published forms have their link and QR code one click away. An event form
 * kept for the Leitung shows the rest of the team only its title and status.
 */
import type { TableColumn } from "@nuxt/ui";
import type { FormState, FormSummary } from "~/utils/forms";

const props = defineProps<{
	forms: FormSummary[];
	loading: boolean;
	/** The forms' pages are `<basePath>/<id>`. */
	basePath: string;
	templates?: boolean;
	/** Show "Neues Formular" (default: yes). */
	canCreate?: boolean;
}>();

const emit = defineEmits<{ refresh: []; create: [] }>();

type Row = FormSummary & { state: FormState };

const rows = computed<Row[]>(() =>
	props.forms.map((form) => ({ ...form, state: formStateOf(form) })),
);

const counts = computed(() => {
	const result: Record<FormState, number> = { draft: 0, open: 0, expired: 0, full: 0, closed: 0 };
	for (const row of rows.value) result[row.state]++;
	return result;
});

const filters = computed(() => [
	{
		column: "title" as const,
		type: "text" as const,
		placeholder: props.templates ? "Vorlagen suchen …" : "Formulare suchen …",
		icon: "i-lucide-search",
	},
	...(props.templates
		? []
		: [
				{
					column: "state" as const,
					type: "multi-select" as const,
					placeholder: "Alle Status",
					icon: "i-lucide-filter",
					// "Antwortlimit erreicht" only when a form is full: it is rare.
					options: (Object.keys(FORM_STATES) as FormState[])
						.filter((state) => state !== "full" || counts.value.full > 0)
						.map((state) => ({
							label: `${FORM_STATES[state].label} (${counts.value[state]})`,
							value: state,
						})),
				},
			]),
]);

const columns = computed<TableColumn<Row>[]>(() => [
	{ accessorKey: "title", header: "Titel" },
	...(props.templates
		? [{ accessorKey: "question_count", header: "Fragen" } as TableColumn<Row>]
		: [
				{ accessorKey: "state", header: "Status" } as TableColumn<Row>,
				{ accessorKey: "response_count", header: "Antworten" } as TableColumn<Row>,
			]),
	{ accessorKey: "updated_at", header: "Geändert" },
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
]);

const shareTarget = ref<Row | null>(null);
const shareOpen = computed({
	get: () => shareTarget.value !== null,
	set: (value) => {
		if (!value) shareTarget.value = null;
	},
});
</script>

<template>
	<DashboardDataTable
		:data="rows"
		:columns="columns"
		:loading="loading"
		:filters="filters"
		:empty-title="templates ? 'Keine Vorlagen' : 'Noch keine Formulare'"
		:empty-description="
			templates
				? 'Vorlagen geben neuen Formularen ihre Fragen mit, z. B. für Feedback oder Anmeldungen.'
				: 'Lege ein Formular an, etwa für Feedback oder Anmeldungen – leer oder aus einer Vorlage.'
		"
		empty-icon="i-lucide-clipboard-list"
		@refresh="emit('refresh')"
		@row-click="$event.can_open && navigateTo(`${basePath}/${$event.id}`)"
	>
		<template #header-left>
			<slot name="header-left" />
		</template>
		<template #header-right>
			<UButton
				v-if="canCreate !== false"
				:label="templates ? 'Neue Vorlage' : 'Neues Formular'"
				icon="i-lucide-plus"
				@click="emit('create')"
			/>
		</template>
		<template #empty-actions>
			<UButton
				v-if="canCreate !== false"
				:label="templates ? 'Neue Vorlage' : 'Neues Formular'"
				icon="i-lucide-plus"
				@click="emit('create')"
			/>
		</template>

		<template #title-cell="{ row }">
			<component
				:is="row.original.can_open ? 'NuxtLink' : 'div'"
				:to="row.original.can_open ? `${basePath}/${row.original.id}` : undefined"
				class="flex items-center gap-3"
				:class="row.original.can_open ? 'hover:underline' : ''"
				@click.stop
			>
				<UIcon
					:name="
						templates
							? 'i-lucide-layout-template'
							: row.original.can_open
								? 'i-lucide-clipboard-list'
								: 'i-lucide-lock'
					"
					class="size-5 shrink-0"
					:class="row.original.can_open ? 'text-primary-400' : 'text-slate-500'"
				/>
				<span class="flex min-w-0 flex-col leading-tight">
					<span class="flex min-w-0 items-center gap-2">
						<span class="truncate font-medium text-white">{{ row.original.title }}</span>
						<UBadge
							v-if="row.original.leaders_only"
							label="Nur Leitung"
							icon="i-lucide-crown"
							color="neutral"
							variant="subtle"
							size="sm"
							class="shrink-0"
						/>
					</span>
					<span v-if="row.original.created_by" class="truncate text-xs text-slate-500">
						{{ row.original.created_by.display_name }}
					</span>
				</span>
			</component>
		</template>
		<template #state-cell="{ row }">
			<UBadge
				:label="FORM_STATES[row.original.state].label"
				:icon="FORM_STATES[row.original.state].icon"
				:color="FORM_STATES[row.original.state].color"
				variant="subtle"
				size="sm"
			/>
		</template>
		<template #response_count-cell="{ row }">
			<span v-if="!row.original.can_open" class="text-sm text-slate-600">–</span>
			<span v-else class="text-sm tabular-nums">
				{{ row.original.response_count }}
				<span v-if="row.original.last_response_at" class="text-xs text-slate-500">
					· {{ formatRelative(row.original.last_response_at) }}
				</span>
			</span>
		</template>
		<template #question_count-cell="{ row }">
			<span class="text-sm tabular-nums">{{ row.original.question_count }}</span>
		</template>
		<template #updated_at-cell="{ row }">
			<span class="text-sm">{{ formatDate(row.original.updated_at) }}</span>
		</template>
		<template #actions-cell="{ row }">
			<div class="flex justify-end gap-1">
				<UButton
					v-if="row.original.public_url"
					icon="i-lucide-qr-code"
					size="sm"
					color="neutral"
					variant="ghost"
					aria-label="Link & QR-Code"
					@click.stop="shareTarget = row.original"
				/>
				<UButton
					v-if="row.original.can_open"
					icon="i-lucide-chevron-right"
					size="sm"
					color="neutral"
					variant="ghost"
					:aria-label="templates ? 'Vorlage öffnen' : 'Formular öffnen'"
					:to="`${basePath}/${row.original.id}`"
					@click.stop
				/>
			</div>
		</template>
	</DashboardDataTable>

	<FormsShareModal
		v-if="shareTarget?.public_url"
		v-model:open="shareOpen"
		:title="shareTarget.title"
		:url="shareTarget.public_url"
		:accepting="shareTarget.accepting"
	/>
</template>
