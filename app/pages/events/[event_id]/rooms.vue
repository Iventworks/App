<script setup lang="ts">
/**
 * Rooms ("Wer schläft wo?"). Everyone sees the room cards; leaders (`rooms:manage`) manage rooms
 * and switch to "Zimmer einteilen": drag people between rooms (desktop) or pick a room per
 * person (touch/keyboard), then save all changes at once.
 */
import * as z from "zod";
import type {
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdParticipantsResponses,
	GetEventsByEventIdRoomsResponses,
} from "~/api-client";
import { zPostEventsByEventIdRoomsBody } from "~/api-client/zod.gen";

type Room = GetEventsByEventIdRoomsResponses["200"]["data"][number];
type Participant = GetEventsByEventIdParticipantsResponses["200"]["data"][number];
type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];
type Gender = NonNullable<Participant["gender"]>;

/** A person in the assignment board: a participant or a staff member (keyed by user id). */
interface Person {
	key: string;
	kind: "participant" | "staff";
	id: number;
	name: string;
	gender: Gender | null;
	age: number | null;
}

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Zimmer | ${event.value.name}` });

const GENDER_SHORT: Record<Gender, string> = { female: "w", male: "m", diverse: "d" };
const GENDER_DOT: Record<Gender, string> = {
	female: "bg-pink-400",
	male: "bg-indigo-400",
	diverse: "bg-amber-400",
};

function ageOn(birthDate: string | null) {
	if (!birthDate) return null;
	const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
	const [y, m, d] = event.value.start_date.split("-").map(Number) as [number, number, number];
	let age = y - by;
	if (m < bm || (m === bm && d < bd)) age--;
	return age;
}

// --- data ---------------------------------------------------------------------------------

const {
	data: rooms,
	loading,
	refresh: refreshRooms,
} = await useAPIAsyncData(`event-${eventId.value}-rooms`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdRooms({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Zimmer konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Room[];
	}
	return result.data;
});

const { data: participants, refresh: refreshParticipants } = await useAPIAsyncData(
	`event-${eventId.value}-participants`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdParticipants({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Participant[]);
	},
);

const { data: members, refresh: refreshMembers } = await useAPIAsyncData(
	`event-${eventId.value}-members`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Member[]);
	},
);

async function refreshAll() {
	await Promise.all([refreshRooms(), refreshParticipants(), refreshMembers()]);
}

/** Participants who need a bed: registered or confirmed (not cancelled / waitlist). */
const housedParticipants = computed(() =>
	(participants.value ?? []).filter(
		(participant) => participant.status === "registered" || participant.status === "confirmed",
	),
);

function participantPerson(
	participant: Pick<Participant, "id" | "first_name" | "last_name" | "gender" | "birth_date">,
): Person {
	return {
		key: `p-${participant.id}`,
		kind: "participant",
		id: participant.id,
		name: `${participant.first_name} ${participant.last_name}`,
		gender: participant.gender,
		age: ageOn(participant.birth_date),
	};
}

function staffPerson(member: Member): Person {
	return {
		key: `s-${member.user_id}`,
		kind: "staff",
		id: member.user_id,
		name: member.user.display_name,
		gender: null,
		age: null,
	};
}

const totalCapacity = computed(() =>
	(rooms.value ?? []).reduce((sum, room) => sum + (room.capacity ?? 0), 0),
);

const unassignedParticipantsView = computed(() =>
	housedParticipants.value
		.filter((participant) => participant.room_id === null)
		.map(participantPerson),
);
const unassignedStaffView = computed(() =>
	(members.value ?? []).filter((member) => member.room_id === null).map(staffPerson),
);

function roomWarnings(capacity: number | null, people: Person[]) {
	const warnings: { key: string; label: string; color: "error" | "warning" }[] = [];
	if (capacity !== null && people.length > capacity) {
		warnings.push({
			key: "over",
			label: `Überbelegt (${people.length}/${capacity})`,
			color: "error",
		});
	}
	const genders = new Set(
		people
			.filter((person) => person.kind === "participant" && person.gender)
			.map((person) => person.gender),
	);
	if (genders.size > 1) {
		warnings.push({ key: "mixed", label: "Gemischt", color: "warning" });
	}
	return warnings;
}

function progressColor(capacity: number | null, occupancy: number) {
	if (!capacity) return "neutral" as const;
	if (occupancy > capacity) return "error" as const;
	if (occupancy === capacity) return "warning" as const;
	return "primary" as const;
}

// --- view-mode room cards -----------------------------------------------------------------

const roomCards = computed(() =>
	(rooms.value ?? []).map((room) => {
		const people = [
			...room.participants.map(participantPerson),
			...room.staff.map((user) => ({
				key: `s-${user.id}`,
				kind: "staff" as const,
				id: user.id,
				name: user.display_name,
				gender: null,
				age: null,
			})),
		];
		return { room, people, warnings: roomWarnings(room.capacity, people) };
	}),
);

const search = ref("");
const visibleRoomCards = computed(() => {
	const term = search.value.trim().toLowerCase();
	if (!term) return roomCards.value;
	return roomCards.value.filter(
		(card) =>
			card.room.name.toLowerCase().includes(term) ||
			card.people.some((person) => person.name.toLowerCase().includes(term)),
	);
});

// --- assignment mode ----------------------------------------------------------------------

const assigning = ref(false);
const draftParticipants = ref<Record<number, number | null>>({});
const draftStaff = ref<Record<number, number | null>>({});
const savingAssignments = ref(false);

function startAssigning() {
	draftParticipants.value = Object.fromEntries(
		housedParticipants.value.map((participant) => [participant.id, participant.room_id]),
	);
	draftStaff.value = Object.fromEntries(
		(members.value ?? []).map((member) => [member.user_id, member.room_id]),
	);
	assigning.value = true;
}

function draftRoomOf(person: Person) {
	return (
		(person.kind === "participant"
			? draftParticipants.value[person.id]
			: draftStaff.value[person.id]) ?? null
	);
}

function setDraftRoom(person: Person, roomId: number | null) {
	if (person.kind === "participant") draftParticipants.value[person.id] = roomId;
	else draftStaff.value[person.id] = roomId;
}

const allPeople = computed<Person[]>(() => [
	...housedParticipants.value.map(participantPerson),
	...(members.value ?? []).map(staffPerson),
]);

const draftColumns = computed(() => {
	const columns = (rooms.value ?? []).map((room) => {
		const people = allPeople.value.filter((person) => draftRoomOf(person) === room.id);
		return {
			id: room.id as number | null,
			name: room.name,
			capacity: room.capacity,
			people,
			warnings: roomWarnings(room.capacity, people),
		};
	});
	return [
		{
			id: null as number | null,
			name: "Ohne Zimmer",
			capacity: null as number | null,
			people: allPeople.value.filter((person) => draftRoomOf(person) === null),
			warnings: [] as ReturnType<typeof roomWarnings>,
		},
		...columns,
	];
});

const changes = computed(() => {
	const participantChanges = housedParticipants.value
		.filter(
			(participant) => (draftParticipants.value[participant.id] ?? null) !== participant.room_id,
		)
		.map((participant) => ({
			participant_id: participant.id,
			room_id: draftParticipants.value[participant.id] ?? null,
		}));
	const staffChanges = (members.value ?? [])
		.filter((member) => (draftStaff.value[member.user_id] ?? null) !== member.room_id)
		.map((member) => ({
			user_id: member.user_id,
			room_id: draftStaff.value[member.user_id] ?? null,
		}));
	return { participants: participantChanges, staff: staffChanges };
});

const changeCount = computed(() => changes.value.participants.length + changes.value.staff.length);

const roomOptions = computed(() => [
	{ label: "Ohne Zimmer", value: null },
	...(rooms.value ?? []).map((room) => ({ label: room.name, value: room.id })),
]);

const draggedPerson = ref<Person | null>(null);
const dropTarget = ref<number | "none" | null>(null);

function onDragStart(event: DragEvent, person: Person) {
	draggedPerson.value = person;
	event.dataTransfer?.setData("text/plain", person.key);
	if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(event: DragEvent, roomId: number | null) {
	if (!draggedPerson.value) return;
	event.preventDefault();
	dropTarget.value = roomId ?? "none";
}

function onDrop(roomId: number | null) {
	if (draggedPerson.value) setDraftRoom(draggedPerson.value, roomId);
	draggedPerson.value = null;
	dropTarget.value = null;
}

function onDragEnd() {
	draggedPerson.value = null;
	dropTarget.value = null;
}

function cancelAssigning() {
	assigning.value = false;
}

async function saveAssignments() {
	if (changeCount.value === 0) {
		assigning.value = false;
		return;
	}
	savingAssignments.value = true;
	const result = await useAPI((api) =>
		api.putEventsByEventIdRoomsAssignments({ path: { eventId: eventId.value }, body: changes.value }),
	);
	savingAssignments.value = false;
	if (!result.success) {
		toast.add({
			title: "Einteilung konnte nicht gespeichert werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Zimmereinteilung gespeichert", color: "success", icon: "i-lucide-check" });
	assigning.value = false;
	await refreshAll();
}

onBeforeRouteLeave(() => {
	if (assigning.value && changeCount.value > 0) {
		return window.confirm(
			"Die Zimmereinteilung ist noch nicht gespeichert. Seite trotzdem verlassen?",
		);
	}
});

// --- create / edit / delete rooms ---------------------------------------------------------

const schema = zPostEventsByEventIdRoomsBody.omit({ capacity: true }).extend({
	capacity: z.string().regex(/^\d*$/, "Bitte eine ganze Zahl angeben"),
});

const formOpen = ref(false);
const editing = ref<Room | null>(null);
const saving = ref(false);
const form = reactive({ name: "", capacity: "", notes: "" });

function openCreate() {
	editing.value = null;
	Object.assign(form, { name: "", capacity: "", notes: "" });
	formOpen.value = true;
}

function openEdit(room: Room) {
	editing.value = room;
	Object.assign(form, {
		name: room.name,
		capacity: room.capacity === null ? "" : String(room.capacity),
		notes: room.notes,
	});
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	const body = {
		name: form.name.trim(),
		capacity: form.capacity === "" ? null : Number(form.capacity),
		notes: form.notes.trim(),
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdRoomsByRoomId({
					path: { eventId: eventId.value, roomId: target.id },
					body,
				}),
			)
		: await useAPI((api) => api.postEventsByEventIdRooms({ path: { eventId: eventId.value }, body }));
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: target ? "Zimmer gespeichert" : "Zimmer angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await refreshRooms();
}

const deleteTarget = ref<Room | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdRoomsByRoomId({ path: { eventId: eventId.value, roomId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `Zimmer „${target.name}“ gelöscht`, color: "success" });
	await refreshAll();
}

function roomMenu(room: Room) {
	return [
		[{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(room) }],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => {
					deleteTarget.value = room;
					deleteOpen.value = true;
				},
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="event-rooms">
		<template #header>
			<DashboardPageHeader title="Zimmer" icon="i-lucide-bed-double" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<p v-if="assigning" class="text-sm text-slate-400">
							{{
								changeCount
									? `${changeCount} ungespeicherte Änderung${changeCount === 1 ? "" : "en"}`
									: "Noch keine Änderungen"
							}}
						</p>
						<UInput
							v-else
							v-model="search"
							icon="i-lucide-search"
							placeholder="Zimmer oder Person suchen …"
							class="w-full sm:w-64"
						/>
					</template>
					<template v-if="can('rooms:manage')" #right>
						<template v-if="assigning">
							<UButton label="Abbrechen" color="neutral" variant="ghost" @click="cancelAssigning" />
							<UButton
								:label="changeCount ? `Speichern (${changeCount})` : 'Fertig'"
								icon="i-lucide-save"
								:loading="savingAssignments"
								@click="saveAssignments"
							/>
						</template>
						<template v-else>
							<UButton
								label="Zimmer einteilen"
								icon="i-lucide-move"
								color="neutral"
								variant="subtle"
								:disabled="!rooms?.length"
								@click="startAssigning"
							/>
							<UButton label="Zimmer anlegen" icon="i-lucide-plus" @click="openCreate" />
						</template>
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !rooms" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!rooms?.length"
					icon="i-lucide-bed-double"
					title="Noch keine Zimmer"
					description="Lege die Zimmer der Unterkunft an, um Teilnehmende und Team einzuteilen."
				/>

				<!-- Assignment board -->
				<template v-else-if="assigning">
					<UAlert
						icon="i-lucide-hand"
						color="neutral"
						variant="subtle"
						title="Zimmer einteilen"
						description="Ziehe Personen in ein Zimmer oder wähle das Zimmer direkt an der Person. Änderungen werden erst mit „Speichern“ übernommen."
					/>

					<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<div
							v-for="column in draftColumns"
							:key="column.id ?? 'none'"
							:class="[
								'rounded-xl border p-4 transition',
								column.id === null ? 'border-dashed border-slate-700 bg-slate-950/40' : 'border-slate-800 bg-slate-900/60',
								dropTarget === (column.id ?? 'none') ? 'ring-2 ring-primary' : '',
							]"
							@dragover="onDragOver($event, column.id)"
							@dragleave="dropTarget = null"
							@drop.prevent="onDrop(column.id)"
						>
							<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
								<p class="font-medium text-white">{{ column.name }}</p>
								<div class="flex flex-wrap items-center gap-1.5">
									<UBadge
										v-for="warning in column.warnings"
										:key="warning.key"
										:label="warning.label"
										:color="warning.color"
										variant="subtle"
										size="sm"
									/>
									<UBadge
										:label="column.capacity !== null ? `${column.people.length}/${column.capacity}` : String(column.people.length)"
										color="neutral"
										variant="outline"
										size="sm"
									/>
								</div>
							</div>

							<ul class="min-h-12 space-y-1.5">
								<li
									v-for="person in column.people"
									:key="person.key"
									draggable="true"
									:class="[
										'flex cursor-grab items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5 active:cursor-grabbing',
										draggedPerson?.key === person.key ? 'opacity-50' : '',
									]"
									@dragstart="onDragStart($event, person)"
									@dragend="onDragEnd"
								>
									<UIcon name="i-lucide-grip-vertical" class="hidden size-4 shrink-0 text-slate-600 sm:block" />
									<span
										v-if="person.gender"
										:class="['size-2 shrink-0 rounded-full', GENDER_DOT[person.gender]]"
									/>
									<UIcon v-else-if="person.kind === 'staff'" name="i-lucide-shield-user" class="size-4 shrink-0 text-primary-400" />
									<span class="min-w-0 flex-1 truncate text-sm text-slate-200">
										{{ person.name }}
										<span v-if="person.age !== null" class="text-slate-500">({{ person.age }})</span>
										<span v-if="person.kind === 'staff'" class="text-xs text-primary-300"> · Team</span>
									</span>
									<USelectMenu
										:model-value="draftRoomOf(person)"
										:items="roomOptions"
										value-key="value"
										size="xs"
										class="w-32 shrink-0"
										:aria-label="`Zimmer für ${person.name}`"
										@update:model-value="(value: number | null) => setDraftRoom(person, value)"
									/>
								</li>
								<li v-if="!column.people.length" class="rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500">
									Hierher ziehen
								</li>
							</ul>
						</div>
					</div>
				</template>

				<!-- Overview -->
				<template v-else>
					<div class="grid gap-4 sm:grid-cols-3">
						<DashboardStatCard label="Zimmer" :value="rooms.length" icon="i-lucide-door-open" />
						<DashboardStatCard
							label="Betten"
							:value="totalCapacity || '–'"
							:hint="`${housedParticipants.length} Teilnehmende + ${members?.length ?? 0} Team`"
							icon="i-lucide-bed"
						/>
						<DashboardStatCard
							label="Ohne Zimmer"
							:value="unassignedParticipantsView.length + unassignedStaffView.length"
							:icon-color="unassignedParticipantsView.length + unassignedStaffView.length ? 'amber' : 'emerald'"
							icon="i-lucide-user-x"
						/>
					</div>

					<UEmpty
						v-if="!visibleRoomCards.length"
						icon="i-lucide-search-x"
						title="Nichts gefunden"
						description="Kein Zimmer und keine Person passt zur Suche."
					/>

					<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<UCard
							v-for="card in visibleRoomCards"
							:key="card.room.id"
							class="border-slate-800 bg-slate-900/60"
							:ui="{ body: 'space-y-3 p-4 sm:p-4' }"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="font-medium text-white">{{ card.room.name }}</p>
									<p v-if="card.room.notes" class="text-xs text-slate-500">{{ card.room.notes }}</p>
								</div>
								<div class="flex items-center gap-1">
									<UBadge
										v-for="warning in card.warnings"
										:key="warning.key"
										:label="warning.label"
										:color="warning.color"
										variant="subtle"
										size="sm"
									/>
									<UDropdownMenu v-if="can('rooms:manage')" :items="roomMenu(card.room)" :ui="{ viewport: 'main-bg-color' }">
										<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
									</UDropdownMenu>
								</div>
							</div>

							<div class="space-y-1">
								<div class="flex justify-between text-xs text-slate-400">
									<span>Belegung</span>
									<span>{{ card.room.occupancy }}{{ card.room.capacity !== null ? ` / ${card.room.capacity}` : "" }}</span>
								</div>
								<UProgress
									v-if="card.room.capacity"
									:model-value="Math.min(card.room.occupancy, card.room.capacity)"
									:max="card.room.capacity"
									:color="progressColor(card.room.capacity, card.room.occupancy)"
									size="sm"
								/>
							</div>

							<ul v-if="card.people.length" class="space-y-1">
								<li v-for="person in card.people" :key="person.key" class="flex items-center gap-2 text-sm">
									<span v-if="person.gender" :class="['size-2 shrink-0 rounded-full', GENDER_DOT[person.gender]]" />
									<UIcon v-else-if="person.kind === 'staff'" name="i-lucide-shield-user" class="size-4 shrink-0 text-primary-400" />
									<NuxtLink
										v-if="person.kind === 'participant'"
										:to="`/events/${eventId}/participants/${person.id}`"
										class="truncate text-slate-200 hover:text-primary-300"
									>
										{{ person.name }}
									</NuxtLink>
									<span v-else class="truncate text-slate-200">{{ person.name }}</span>
									<span class="ml-auto shrink-0 text-xs text-slate-500">
										<template v-if="person.kind === 'staff'">Team</template>
										<template v-else>
											{{ person.gender ? GENDER_SHORT[person.gender] : "" }}{{ person.age !== null ? ` · ${person.age}` : "" }}
										</template>
									</span>
								</li>
							</ul>
							<p v-else class="text-sm text-slate-500">Noch leer.</p>
						</UCard>
					</div>

					<DashboardSectionCard
						v-if="unassignedParticipantsView.length || unassignedStaffView.length"
						title="Ohne Zimmer"
						:description="`${unassignedParticipantsView.length} Teilnehmende, ${unassignedStaffView.length} aus dem Team`"
						icon="i-lucide-user-x"
					>
						<template v-if="can('rooms:manage')" #actions>
							<UButton label="Jetzt einteilen" icon="i-lucide-move" size="sm" @click="startAssigning" />
						</template>
						<div class="flex flex-wrap gap-2">
							<UBadge
								v-for="person in [...unassignedParticipantsView, ...unassignedStaffView]"
								:key="person.key"
								:label="person.kind === 'staff' ? `${person.name} (Team)` : person.name"
								:color="person.kind === 'staff' ? 'primary' : 'neutral'"
								variant="subtle"
							/>
						</div>
					</DashboardSectionCard>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Zimmer bearbeiten' : 'Neues Zimmer'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-door-open'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Name" name="name" required>
				<UInput v-model="form.name" placeholder="z. B. Zimmer 3 / Zelt Blau" class="w-full" autofocus />
			</UFormField>
			<UFormField label="Betten" name="capacity" description="Leer lassen, wenn unbegrenzt.">
				<UInput v-model="form.capacity" inputmode="numeric" class="w-full" />
			</UFormField>
			<UFormField label="Notizen" name="notes">
				<UTextarea v-model="form.notes" :rows="2" autoresize placeholder="z. B. Erdgeschoss, barrierefrei" class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Zimmer löschen"
		:warning-text="`Das Zimmer „${deleteTarget?.name}“ wird gelöscht. Alle Personen darin sind danach ohne Zimmer.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
