<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import type {
	GetEventsByEventIdParticipantsResponses,
	GetEventsByEventIdRoomsResponses,
} from "~/api-client";

type Participant = GetEventsByEventIdParticipantsResponses["200"]["data"][number];
type Room = GetEventsByEventIdRoomsResponses["200"]["data"][number];

/** Table row: the participant plus derived columns used for filtering. */
type Row = Participant & {
	full_name: string;
	/** Room id, or -1 for "ohne Zimmer" (select filters can't hold 0/null). */
	room_key: number;
	care_flags: string[];
};

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Teilnehmende | ${event.value.name} | CMP` });

const NO_ROOM = -1;

// --- data ---------------------------------------------------------------------------------

const {
	data: participants,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-participants`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdParticipants({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Teilnehmende konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Participant[];
	}
	return result.data;
});

const { data: rooms, refresh: refreshRooms } = await useAPIAsyncData(
	`event-${eventId.value}-rooms`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdRooms({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Room[]);
	},
);

const rows = computed<Row[]>(() =>
	(participants.value ?? []).map((participant) => ({
		...participant,
		full_name: `${participant.last_name}, ${participant.first_name}`,
		room_key: participant.room_id ?? NO_ROOM,
		care_flags: [
			participant.allergies.trim() ? "allergies" : "",
			participant.medications.trim() ? "medications" : "",
			participant.dietary_requirements.trim() ? "dietary" : "",
			participant.medical_notes.trim() ? "medical" : "",
			participant.can_swim === false ? "no_swim" : "",
		].filter(Boolean),
	})),
);

const active = computed(() => rows.value.filter((row) => row.status !== "cancelled"));

const stats = computed(() => ({
	total: active.value.filter((row) => row.status !== "waitlist").length,
	confirmed: active.value.filter((row) => row.status === "confirmed").length,
	waitlist: active.value.filter((row) => row.status === "waitlist").length,
	withoutRoom: active.value.filter((row) => row.status !== "waitlist" && row.room_id === null)
		.length,
}));

const capacityHint = computed(() =>
	event.value.max_participants ? `von max. ${event.value.max_participants}` : undefined,
);

// --- table --------------------------------------------------------------------------------

const columns = computed<TableColumn<Row>[]>(() => [
	{ accessorKey: "full_name", header: "Name" },
	{ accessorKey: "age", header: "Alter" },
	{ accessorKey: "gender", header: "Geschlecht" },
	{ accessorKey: "room_key", header: "Zimmer" },
	{ accessorKey: "status", header: "Status" },
	{ accessorKey: "care_flags", header: "Hinweise", enableSorting: false },
	{ accessorKey: "guardian_phone", header: "Notfall-Telefon", enableSorting: false },
	{ accessorKey: "fee_paid", header: "Bezahlt" },
	...(can("participants:manage") ? [{ id: "actions", header: "", enableSorting: false }] : []),
]);

const filters = computed(() => [
	{ column: "full_name" as const, type: "text" as const, placeholder: "Name suchen …" },
	{
		column: "status" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		icon: "i-lucide-filter",
		options: PARTICIPANT_STATUS_OPTIONS,
	},
	{
		column: "room_key" as const,
		type: "multi-select" as const,
		placeholder: "Alle Zimmer",
		icon: "i-lucide-bed-double",
		options: [
			{ label: "Ohne Zimmer", value: NO_ROOM },
			...(rooms.value ?? []).map((room) => ({ label: room.name, value: room.id })),
		],
	},
	{
		column: "care_flags" as const,
		type: "multi-select" as const,
		placeholder: "Alle Hinweise",
		icon: "i-lucide-heart-pulse",
		options: [
			{ label: "Mit Allergien", value: "allergies" },
			{ label: "Mit Medikamenten", value: "medications" },
			{ label: "Mit Ernährungshinweisen", value: "dietary" },
			{ label: "Mit med. Hinweisen", value: "medical" },
			{ label: "Nichtschwimmer:innen", value: "no_swim" },
		],
		// Rows with any of the picked notes.
		filterFn: (row: { original: Row }, _columnId: string, value: string[] | undefined) =>
			!value?.length || value.some((flag) => row.original.care_flags.includes(flag)),
	},
]);

function emergencyPhone(row: Row) {
	return row.guardian_phone ?? row.emergency_contacts[0]?.phone ?? null;
}

function rowActions(row: Row): DropdownMenuItem[][] {
	return [
		[
			{
				label: "Details",
				icon: "i-lucide-eye",
				to: `/events/${eventId.value}/participants/${row.id}`,
			},
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(row) },
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => {
					deleteTarget.value = row;
					deleteOpen.value = true;
				},
			},
		],
	];
}

// --- create / edit ------------------------------------------------------------------------

const formOpen = ref(false);
const editing = ref<Participant | null>(null);

function openCreate() {
	editing.value = null;
	formOpen.value = true;
}

function openEdit(participant: Participant) {
	editing.value = participant;
	formOpen.value = true;
}

async function onSaved() {
	await Promise.all([refresh(), refreshRooms()]);
}

// --- delete -------------------------------------------------------------------------------

const deleteTarget = ref<Participant | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdParticipantsByParticipantId({
			path: { eventId: eventId.value, participantId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `${target.first_name} ${target.last_name} gelöscht`, color: "success" });
	await onSaved();
}

// --- CSV export ---------------------------------------------------------------------------

const exporting = ref(false);

async function exportCsv() {
	exporting.value = true;
	const result = (await useAPI((api) =>
		api.getEventsByEventIdParticipantsExport({
			path: { eventId: eventId.value },
			responseType: "blob",
		}),
	)) as unknown;
	exporting.value = false;

	if (!(result instanceof Blob)) {
		toast.add({
			title: "Export fehlgeschlagen",
			description: (result as { message?: string } | null)?.message,
			color: "error",
		});
		return;
	}

	const slug =
		event.value.name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "event";
	const url = URL.createObjectURL(result);
	const link = document.createElement("a");
	link.href = url;
	link.download = `teilnehmende-${slug}.csv`;
	link.click();
	URL.revokeObjectURL(url);
}
</script>

<template>
	<UDashboardPanel id="event-participants">
		<template #header>
			<DashboardPageHeader title="Teilnehmende" icon="i-lucide-users" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<UAlert
					v-if="!can('participants:view_medical')"
					icon="i-lucide-lock"
					color="neutral"
					variant="subtle"
					title="Gesundheitsangaben ausgeblendet"
					description="Allergien, Medikamente, medizinische Hinweise und Notizen des Teams sehen nur die Mitarbeitenden dieser Freizeit. Leere Felder heißen hier also nicht „keine Angaben“."
				/>

				<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<DashboardStatCard
						label="Teilnehmende"
						:value="stats.total"
						:hint="capacityHint"
						icon="i-lucide-users"
						:loading="loading && !participants"
					/>
					<DashboardStatCard
						label="Bestätigt"
						:value="stats.confirmed"
						icon="i-lucide-badge-check"
						icon-color="emerald"
						:loading="loading && !participants"
					/>
					<DashboardStatCard
						label="Warteliste"
						:value="stats.waitlist"
						icon="i-lucide-hourglass"
						icon-color="amber"
						:loading="loading && !participants"
					/>
					<DashboardStatCard
						label="Ohne Zimmer"
						:value="stats.withoutRoom"
						icon="i-lucide-bed-double"
						:icon-color="stats.withoutRoom > 0 ? 'error' : 'neutral'"
						:to="`/events/${eventId}/rooms`"
						:loading="loading && !participants"
					/>
				</div>

				<DashboardDataTable
					:data="rows"
					:columns="columns"
					:loading="loading && !participants"
					:filters="filters"
					:default-page-size="25"
					empty-title="Keine Teilnehmenden"
					empty-description="Für dieses Event ist noch niemand angemeldet."
					empty-icon="i-lucide-users"
					@refresh="refresh"
				>
					<template #header-right>
						<UButton
							label="CSV-Export"
							icon="i-lucide-file-down"
							color="neutral"
							variant="subtle"
							:loading="exporting"
							class="hidden sm:inline-flex"
							@click="exportCsv"
						/>
						<UButton
							icon="i-lucide-file-down"
							color="neutral"
							variant="subtle"
							:loading="exporting"
							aria-label="CSV-Export"
							class="sm:hidden"
							@click="exportCsv"
						/>
						<UButton
							v-if="can('participants:manage')"
							label="Anmelden"
							icon="i-lucide-user-plus"
							@click="openCreate"
						/>
					</template>

					<template #full_name-cell="{ row }">
						<NuxtLink
							:to="`/events/${eventId}/participants/${row.original.id}`"
							class="font-medium text-white hover:text-primary-300"
						>
							{{ row.original.first_name }} {{ row.original.last_name }}
						</NuxtLink>
						<p v-if="row.original.note_count" class="text-xs text-slate-500">
							{{ row.original.note_count }} Notiz{{ row.original.note_count === 1 ? "" : "en" }}
						</p>
					</template>

					<template #age-cell="{ row }">
						<span class="text-slate-300">{{ row.original.age ?? "–" }}</span>
					</template>

					<template #gender-cell="{ row }">
						<span class="text-slate-400">
							{{ row.original.gender ? GENDER_LABELS[row.original.gender] : "–" }}
						</span>
					</template>

					<template #room_key-cell="{ row }">
						<span v-if="row.original.room" class="text-slate-300">{{ row.original.room.name }}</span>
						<span
							v-else-if="row.original.status !== 'cancelled' && row.original.status !== 'waitlist'"
							class="text-xs text-amber-400"
						>
							kein Zimmer
						</span>
						<span v-else class="text-slate-600">–</span>
					</template>

					<template #status-cell="{ row }">
						<UBadge
							:label="PARTICIPANT_STATUS_LABELS[row.original.status]"
							:color="PARTICIPANT_STATUS_COLORS[row.original.status]"
							variant="subtle"
							size="sm"
						/>
					</template>

					<template #care_flags-cell="{ row }">
						<ParticipantsCareIcons :participant="row.original" />
					</template>

					<template #guardian_phone-cell="{ row }">
						<a
							v-if="emergencyPhone(row.original)"
							:href="`tel:${emergencyPhone(row.original)}`"
							class="whitespace-nowrap text-primary-300 hover:underline"
						>
							{{ emergencyPhone(row.original) }}
						</a>
						<span v-else class="text-slate-600">–</span>
					</template>

					<template #fee_paid-cell="{ row }">
						<UIcon
							:name="row.original.fee_paid ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
							:class="row.original.fee_paid ? 'size-5 text-emerald-400' : 'size-5 text-slate-600'"
						/>
					</template>

					<template #actions-cell="{ row }">
						<UDropdownMenu :items="rowActions(row.original)" :ui="{ viewport: 'main-bg-color' }">
							<UButton
								icon="i-lucide-ellipsis-vertical"
								color="neutral"
								variant="ghost"
								size="xs"
								aria-label="Aktionen"
							/>
						</UDropdownMenu>
					</template>

				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<ParticipantsFormModal
		v-model:open="formOpen"
		:event-id="eventId"
		:participant="editing"
		:rooms="rooms ?? []"
		@saved="onSaved"
	/>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Teilnehmende:n löschen"
		:warning-text="`${deleteTarget?.first_name} ${deleteTarget?.last_name} wird mit allen Notfallkontakten und Notizen gelöscht. Für eine Abmeldung setze stattdessen den Status auf „Abgemeldet“.`"
		:on-delete="confirmDelete"
	/>
</template>
