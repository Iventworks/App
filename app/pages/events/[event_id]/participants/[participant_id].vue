<script setup lang="ts">
import type {
	GetEventsByEventIdParticipantsByParticipantIdResponses,
	GetEventsByEventIdParticipantsResponses,
	GetEventsByEventIdRoomsResponses,
} from "~/api-client";

type Participant = GetEventsByEventIdParticipantsResponses["200"]["data"][number];
type StaffNote =
	GetEventsByEventIdParticipantsByParticipantIdResponses["200"]["data"]["staff_notes"][number];
type Room = GetEventsByEventIdRoomsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

const participantId = computed(() => Number(route.params.participant_id));

// --- data ---------------------------------------------------------------------------------

// The participant record comes from the list endpoint (shared cache with the list page, so edits
// there show up here); the detail endpoint adds the staff notes (`staff_notes`).
const { data: participants, refresh: refreshParticipants } = await useAPIAsyncData(
	`event-${eventId.value}-participants`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdParticipants({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Participant[]);
	},
);

const {
	data: staffNotes,
	loading: notesLoading,
	refresh: refreshNotes,
} = await useAPIAsyncData(`event-${eventId.value}-participant-${participantId.value}`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdParticipantsByParticipantId({
			path: { eventId: eventId.value, participantId: participantId.value },
		}),
	);
	return result.success ? result.data.staff_notes : ([] as StaffNote[]);
});

const participant = computed(
	() => participants.value?.find((entry) => entry.id === participantId.value) ?? null,
);

if (!participant.value) {
	throw createError({
		statusCode: 404,
		statusMessage: "Teilnehmende:r nicht gefunden",
		fatal: true,
	});
}

const { data: rooms, refresh: refreshRooms } = await useAPIAsyncData(
	`event-${eventId.value}-rooms`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdRooms({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Room[]);
	},
);

const fullName = computed(() =>
	participant.value ? `${participant.value.first_name} ${participant.value.last_name}` : "",
);

useSeoMeta({ title: () => `${fullName.value} | Teilnehmende | ${event.value.name} | CMP` });

const breadcrumb = computed(() => [
	{ label: "Teilnehmende", icon: "i-lucide-users", to: `/events/${eventId.value}/participants` },
	{ label: fullName.value },
]);

const roommates = computed(() => {
	const roomId = participant.value?.room_id;
	if (!roomId) return null;
	const room = rooms.value?.find((entry) => entry.id === roomId);
	if (!room) return null;
	return {
		room,
		participants: room.participants.filter((entry) => entry.id !== participantId.value),
	};
});

const health = computed(() => {
	const p = participant.value;
	if (!p) return [];
	return [
		{
			key: "allergies",
			label: "Allergien",
			icon: "i-lucide-shield-alert",
			value: p.allergies,
			tone: "red",
		},
		{
			key: "medications",
			label: "Medikamente",
			icon: "i-lucide-pill",
			value: p.medications,
			tone: "amber",
		},
		{
			key: "dietary",
			label: "Ernährung",
			icon: "i-lucide-utensils",
			value: p.dietary_requirements,
			tone: "amber",
		},
		{
			key: "medical",
			label: "Medizinische Hinweise",
			icon: "i-lucide-stethoscope",
			value: p.medical_notes,
			tone: "amber",
		},
	] as const;
});

const HEALTH_TONES = {
	red: { box: "border-red-900/60 bg-red-950/40", icon: "text-red-400", label: "text-red-300" },
	amber: {
		box: "border-amber-900/60 bg-amber-950/30",
		icon: "text-amber-400",
		label: "text-amber-300",
	},
	none: { box: "border-slate-800 bg-slate-950/30", icon: "text-slate-500", label: "text-slate-400" },
} as const;

async function refreshAll() {
	await Promise.all([refreshParticipants(), refreshNotes(), refreshRooms()]);
}

// --- staff notes --------------------------------------------------------------------------

const newNote = ref("");
const savingNote = ref(false);

async function addNote() {
	const content = newNote.value.trim();
	if (!content) return;
	savingNote.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdParticipantsByParticipantIdNotes({
			path: { eventId: eventId.value, participantId: participantId.value },
			body: { content },
		}),
	);
	savingNote.value = false;
	if (!result.success) {
		toast.add({
			title: "Notiz konnte nicht gespeichert werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	newNote.value = "";
	await refreshAll();
}

async function deleteNote(note: StaffNote) {
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdParticipantsByParticipantIdNotesByNoteId({
			path: { eventId: eventId.value, participantId: participantId.value, noteId: note.id },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Notiz konnte nicht gelöscht werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	await refreshAll();
}

// --- edit / delete ------------------------------------------------------------------------

const formOpen = ref(false);
const deleteOpen = ref(false);

async function confirmDelete() {
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdParticipantsByParticipantId({
			path: { eventId: eventId.value, participantId: participantId.value },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `${fullName.value} gelöscht`, color: "success" });
	await refreshParticipants();
	await navigateTo(`/events/${eventId.value}/participants`);
}
</script>

<template>
	<UDashboardPanel id="event-participant">
		<template #header>
			<DashboardPageHeader :breadcrumb-items="breadcrumb">
				<template #right>
					<template v-if="can('participants:manage')">
						<UButton label="Bearbeiten" icon="i-lucide-pencil" color="neutral" variant="subtle" @click="formOpen = true" />
						<UButton
							icon="i-lucide-trash-2"
							color="error"
							variant="ghost"
							aria-label="Löschen"
							@click="deleteOpen = true"
						/>
					</template>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody v-if="participant">
				<div class="flex flex-wrap items-center gap-3">
					<UAvatar :text="initials(fullName)" size="lg" />
					<div class="min-w-0">
						<h2 class="text-xl font-semibold text-white">{{ fullName }}</h2>
						<p class="text-sm text-slate-400">
							<template v-if="participant.age !== null">{{ participant.age }} Jahre · </template>
							{{ participant.gender ? GENDER_LABELS[participant.gender] : "Geschlecht unbekannt" }}
						</p>
					</div>
					<div class="flex flex-wrap gap-2 sm:ml-auto">
						<UBadge
							:label="PARTICIPANT_STATUS_LABELS[participant.status]"
							:color="PARTICIPANT_STATUS_COLORS[participant.status]"
							variant="subtle"
						/>
						<UBadge
							:label="participant.fee_paid ? 'Beitrag bezahlt' : 'Beitrag offen'"
							:color="participant.fee_paid ? 'success' : 'warning'"
							variant="outline"
						/>
					</div>
				</div>

				<div class="grid gap-6 lg:grid-cols-3">
					<div class="space-y-6 lg:col-span-2">
						<DashboardSectionCard
							title="Gesundheit"
							description="Nur für das Team dieses Events sichtbar"
							icon="i-lucide-heart-pulse"
						>
							<div class="grid gap-3 sm:grid-cols-2">
								<div
									v-for="entry in health"
									:key="entry.key"
									:class="['rounded-lg border p-3', HEALTH_TONES[entry.value.trim() ? entry.tone : 'none'].box]"
								>
									<p
										:class="[
											'flex items-center gap-2 text-sm font-medium',
											HEALTH_TONES[entry.value.trim() ? entry.tone : 'none'].label,
										]"
									>
										<UIcon
											:name="entry.icon"
											:class="['size-4', HEALTH_TONES[entry.value.trim() ? entry.tone : 'none'].icon]"
										/>
										{{ entry.label }}
									</p>
									<p v-if="entry.value.trim()" class="mt-1 whitespace-pre-line text-sm text-slate-100">
										{{ entry.value }}
									</p>
									<p v-else class="mt-1 text-sm text-slate-500">Keine Angaben</p>
								</div>
							</div>

							<div class="mt-4 flex flex-wrap gap-2">
								<UBadge
									:icon="participant.can_swim === false ? 'i-lucide-life-buoy' : 'i-lucide-waves'"
									:label="
										participant.can_swim === null
											? 'Schwimmen: unbekannt'
											: participant.can_swim
												? 'Kann schwimmen'
												: 'Kann nicht schwimmen'
									"
									:color="participant.can_swim === false ? 'warning' : participant.can_swim ? 'success' : 'neutral'"
									variant="subtle"
								/>
								<UBadge
									:icon="participant.photo_consent ? 'i-lucide-camera' : 'i-lucide-camera-off'"
									:label="participant.photo_consent ? 'Foto-Einwilligung' : 'Keine Foto-Einwilligung'"
									:color="participant.photo_consent ? 'success' : 'neutral'"
									variant="subtle"
								/>
							</div>
						</DashboardSectionCard>

						<DashboardSectionCard v-if="participant.notes.trim()" title="Hinweise" icon="i-lucide-info">
							<p class="whitespace-pre-line text-sm text-slate-200">{{ participant.notes }}</p>
						</DashboardSectionCard>

						<DashboardSectionCard
							title="Notizen des Teams"
							description="Beobachtungen und Absprachen rund um diese Person"
							icon="i-lucide-notebook-pen"
						>
							<form v-if="can('participants:add_note')" class="mb-5 space-y-2" @submit.prevent="addNote">
								<UTextarea
									v-model="newNote"
									:rows="2"
									autoresize
									placeholder="Neue Notiz, z. B. „Hatte heute Heimweh, abends nochmal nachfragen“"
									class="w-full"
								/>
								<div class="flex justify-end">
									<UButton
										type="submit"
										label="Notiz speichern"
										icon="i-lucide-send"
										size="sm"
										:loading="savingNote"
										:disabled="!newNote.trim()"
									/>
								</div>
							</form>

							<div v-if="notesLoading && !staffNotes" class="flex justify-center py-6">
								<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
							</div>
							<p v-else-if="!staffNotes?.length" class="text-sm text-slate-500">Noch keine Notizen.</p>
							<ol v-else class="relative space-y-4 border-l border-slate-800 pl-5">
								<li v-for="note in staffNotes" :key="note.id" class="group relative">
									<span class="absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-primary-400 ring-4 ring-slate-950" />
									<div class="flex items-start justify-between gap-2">
										<p class="text-xs text-slate-500">
											<span class="font-medium text-slate-300">{{ note.author?.display_name ?? "Unbekannt" }}</span>
											· {{ formatDate(note.created_at) }}
										</p>
										<UButton
											v-if="note.can_delete"
											icon="i-lucide-trash-2"
											color="neutral"
											variant="ghost"
											size="xs"
											class="opacity-60 group-hover:opacity-100"
											aria-label="Notiz löschen"
											@click="deleteNote(note)"
										/>
									</div>
									<p class="mt-1 whitespace-pre-line text-sm text-slate-200">{{ note.content }}</p>
								</li>
							</ol>
						</DashboardSectionCard>
					</div>

					<div class="space-y-6">
						<DashboardSectionCard title="Person" icon="i-lucide-id-card">
							<dl class="space-y-3 text-sm">
								<div class="flex justify-between gap-3">
									<dt class="text-slate-400">Geburtsdatum</dt>
									<dd class="text-right text-slate-100">{{ formatDay(participant.birth_date) }}</dd>
								</div>
								<div class="flex justify-between gap-3">
									<dt class="text-slate-400">Alter zum Start</dt>
									<dd class="text-right text-slate-100">{{ participant.age ?? "–" }}</dd>
								</div>
								<div class="flex justify-between gap-3">
									<dt class="text-slate-400">Angemeldet am</dt>
									<dd class="text-right text-slate-100">{{ formatDay(participant.created_at) }}</dd>
								</div>
							</dl>
						</DashboardSectionCard>

						<DashboardSectionCard title="Kontakt" icon="i-lucide-phone">
							<div class="space-y-4 text-sm">
								<div class="space-y-1">
									<a v-if="participant.phone" :href="`tel:${participant.phone}`" class="flex items-center gap-2 text-primary-300 hover:underline">
										<UIcon name="i-lucide-phone" class="size-4" /> {{ participant.phone }}
									</a>
									<a v-if="participant.email" :href="`mailto:${participant.email}`" class="flex items-center gap-2 break-all text-primary-300 hover:underline">
										<UIcon name="i-lucide-mail" class="size-4 shrink-0" /> {{ participant.email }}
									</a>
									<p v-if="participant.address" class="flex items-start gap-2 whitespace-pre-line text-slate-300">
										<UIcon name="i-lucide-map-pin" class="mt-0.5 size-4 shrink-0" /> {{ participant.address }}
									</p>
									<p v-if="!participant.phone && !participant.email && !participant.address" class="text-slate-500">
										Keine eigenen Kontaktdaten.
									</p>
								</div>

								<div class="border-t border-slate-800 pt-3">
									<p class="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Erziehungsberechtigte:r</p>
									<p class="text-slate-100">{{ participant.guardian_name ?? "–" }}</p>
									<a
										v-if="participant.guardian_phone"
										:href="`tel:${participant.guardian_phone}`"
										class="flex items-center gap-2 text-primary-300 hover:underline"
									>
										<UIcon name="i-lucide-phone" class="size-4" /> {{ participant.guardian_phone }}
									</a>
								</div>
							</div>
						</DashboardSectionCard>

						<DashboardSectionCard title="Notfallkontakte" icon="i-lucide-siren">
							<p v-if="!participant.emergency_contacts.length" class="text-sm text-amber-400">
								Kein Notfallkontakt hinterlegt.
							</p>
							<ul v-else class="space-y-3 text-sm">
								<li v-for="contact in participant.emergency_contacts" :key="contact.id">
									<p class="text-slate-100">
										{{ contact.name }}
										<span v-if="contact.relation" class="text-slate-500">({{ contact.relation }})</span>
									</p>
									<a :href="`tel:${contact.phone}`" class="flex items-center gap-2 text-primary-300 hover:underline">
										<UIcon name="i-lucide-phone" class="size-4" /> {{ contact.phone }}
									</a>
								</li>
							</ul>
						</DashboardSectionCard>

						<DashboardSectionCard title="Zimmer" icon="i-lucide-bed-double">
							<template v-if="roommates">
								<NuxtLink :to="`/events/${eventId}/rooms`" class="font-medium text-white hover:text-primary-300">
									{{ roommates.room.name }}
								</NuxtLink>
								<p class="mt-2 text-xs uppercase tracking-wide text-slate-500">Mitbewohner:innen</p>
								<ul v-if="roommates.participants.length" class="mt-1 space-y-1 text-sm">
									<li v-for="mate in roommates.participants" :key="mate.id">
										<NuxtLink :to="`/events/${eventId}/participants/${mate.id}`" class="text-slate-300 hover:text-primary-300">
											{{ mate.first_name }} {{ mate.last_name }}
										</NuxtLink>
									</li>
								</ul>
								<p v-else class="text-sm text-slate-500">Allein im Zimmer.</p>
							</template>
							<p v-else class="text-sm text-slate-500">Noch keinem Zimmer zugeteilt.</p>
						</DashboardSectionCard>
					</div>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<ParticipantsFormModal
		v-model:open="formOpen"
		:event-id="eventId"
		:participant="participant"
		:rooms="rooms ?? []"
		@saved="refreshAll"
	/>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Teilnehmende:n löschen"
		:warning-text="`${fullName} wird mit allen Notfallkontakten und Notizen gelöscht.`"
		:on-delete="confirmDelete"
	/>
</template>
