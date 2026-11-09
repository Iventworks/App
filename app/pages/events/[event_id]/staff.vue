<script setup lang="ts">
/**
 * The event's team: leaders ("Leitung") first, then staff. Everyone sees contacts, groups and
 * rooms; leaders (`members:manage`) add, edit and remove people. Leader-only notes are shown with
 * `members:view_leader_notes`.
 */
import type {
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdRoomsResponses,
} from "~/api-client";
import {
	zPostEventsByEventIdMembersBody,
	zPutEventsByEventIdMembersByMemberIdBody,
} from "~/api-client/zod.gen";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { EventRole } from "~/utils/roles";
import type { UserSummary } from "~/utils/types";

type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];
type Room = GetEventsByEventIdRoomsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const userInfo = await useUserInfoStore().use();

useSeoMeta({ title: `Team | ${event.value.name}` });

// --- data ---------------------------------------------------------------------------------

const {
	data: members,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-members`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Team konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Member[];
	}
	return result.data;
});

const { data: rooms } = await useAPIAsyncData(`event-${eventId.value}-rooms`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdRooms({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : ([] as Room[]);
});

const search = ref("");

const sortedMembers = computed(() =>
	[...(members.value ?? [])].sort((a, b) => {
		if (a.role !== b.role) return a.role === "leader" ? -1 : 1;
		return a.user.display_name.localeCompare(b.user.display_name, "de");
	}),
);

const visibleMembers = computed(() => {
	const term = search.value.trim().toLowerCase();
	return sortedMembers.value.filter((member) => {
		if (roleFilter.value !== "all" && member.role !== roleFilter.value) return false;
		if (!term) return true;
		return [
			member.user.display_name,
			member.user.username,
			member.position ?? "",
			...member.groups.map((g) => g.name),
		]
			.join(" ")
			.toLowerCase()
			.includes(term);
	});
});

const counts = computed(() => ({
	all: members.value?.length ?? 0,
	leader: members.value?.filter((member) => member.role === "leader").length ?? 0,
	staff: members.value?.filter((member) => member.role === "staff").length ?? 0,
}));

const { value: roleFilter, items: roleItems } = useQueryFilter<"all" | EventRole>("role", () => [
	{ value: "all", label: "Alle", icon: "i-lucide-users", count: counts.value.all },
	{ value: "leader", label: "Leitung", icon: "i-lucide-crown", count: counts.value.leader },
	{ value: "staff", label: "Mitarbeitende", icon: "i-lucide-user", count: counts.value.staff },
]);

const roomOptions = computed(() => [
	{ label: "Kein Zimmer", value: null },
	...(rooms.value ?? []).map((room) => ({ label: room.name, value: room.id })),
]);

/** Membership changes of the caller change their own access: reload event + switcher. */
async function afterChange(affectedUserId: number) {
	await refresh();
	if (affectedUserId !== userInfo.value?.id) return;
	await useMyEventsStore().refresh();
	const { event: reloaded } = await loadEventDetails(eventId.value, true);
	if (!reloaded) await navigateTo("/events");
}

// --- add member ---------------------------------------------------------------------------

const addOpen = ref(false);
const adding = ref(false);
const users = ref<UserSummary[]>([]);
const addForm = reactive({
	user_id: undefined as number | undefined,
	role: "staff" as EventRole,
	position: "",
});
const addSchema = zPostEventsByEventIdMembersBody.omit({ position: true });

async function openAdd() {
	Object.assign(addForm, { user_id: undefined, role: "staff", position: "" });
	addOpen.value = true;
	const result = await useAPI((api) => api.getUsers({}));
	if (result.success) {
		users.value = result.data;
	} else {
		toast.add({
			title: "Benutzer konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
	}
}

const userOptions = computed(() => {
	const existing = new Set((members.value ?? []).map((member) => member.user_id));
	return users.value
		.filter((user) => !existing.has(user.id))
		.map((user) => ({ label: user.display_name, description: `@${user.username}`, value: user.id }));
});

async function submitAdd() {
	if (!addForm.user_id) return;
	adding.value = true;
	const userId = addForm.user_id;
	const result = await useAPI((api) =>
		api.postEventsByEventIdMembers({
			path: { eventId: eventId.value },
			body: { user_id: userId, role: addForm.role, position: addForm.position.trim() || null },
		}),
	);
	adding.value = false;
	if (!result.success) {
		toast.add({ title: "Hinzufügen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: `${result.data.user.display_name} ist jetzt im Team`,
		color: "success",
		icon: "i-lucide-check",
	});
	addOpen.value = false;
	await afterChange(userId);
}

// --- edit member --------------------------------------------------------------------------

const editOpen = ref(false);
const saving = ref(false);
const editing = ref<Member | null>(null);
const editForm = reactive({
	role: "staff" as EventRole,
	position: "",
	room_id: null as number | null,
	leader_notes: "",
});
const editSchema = zPutEventsByEventIdMembersByMemberIdBody.omit({ position: true });

function openEdit(member: Member) {
	editing.value = member;
	Object.assign(editForm, {
		role: member.role,
		position: member.position ?? "",
		room_id: member.room_id,
		leader_notes: member.leader_notes,
	});
	editOpen.value = true;
}

async function submitEdit() {
	const target = editing.value;
	if (!target) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.putEventsByEventIdMembersByMemberId({
			path: { eventId: eventId.value, memberId: target.id },
			body: {
				role: editForm.role,
				position: editForm.position.trim() || null,
				room_id: editForm.room_id,
				...(can("members:view_leader_notes") ? { leader_notes: editForm.leader_notes } : {}),
			},
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Gespeichert", color: "success", icon: "i-lucide-check" });
	editOpen.value = false;
	await afterChange(target.user_id);
}

// --- remove -------------------------------------------------------------------------------

const removeTarget = ref<Member | null>(null);
const removeOpen = ref(false);

async function confirmRemove() {
	const target = removeTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdMembersByMemberId({
			path: { eventId: eventId.value, memberId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Entfernen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `${target.user.display_name} wurde entfernt`, color: "success" });
	await afterChange(target.user_id);
}

function memberMenu(member: Member) {
	return [
		[{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(member) }],
		[
			{
				label: "Aus dem Team entfernen",
				icon: "i-lucide-user-minus",
				color: "error" as const,
				onSelect: () => {
					removeTarget.value = member;
					removeOpen.value = true;
				},
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="event-staff">
		<template #header>
			<DashboardPageHeader title="Team" icon="i-lucide-contact" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<UInput v-model="search" icon="i-lucide-search" placeholder="Name, Gruppe, Funktion …" class="w-full sm:w-64" />
						<USelect
							v-model="roleFilter"
							:items="roleItems"
							:icon="roleItems.find((item) => item.value === roleFilter)?.icon"
							class="w-full sm:w-52"
							aria-label="Nach Rolle filtern"
						/>
					</template>
					<template v-if="can('members:manage')" #right>
						<UButton label="Hinzufügen" icon="i-lucide-user-plus" @click="openAdd" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !members" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!visibleMembers.length"
					icon="i-lucide-contact"
					:title="members?.length ? 'Niemand gefunden' : 'Noch kein Team'"
					:description="members?.length ? 'Passe Suche oder Filter an.' : 'Füge Leitung und Mitarbeitende hinzu.'"
				/>

				<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<UCard
						v-for="member in visibleMembers"
						:key="member.id"
						:class="[
							'border-slate-800 bg-slate-900/60',
							member.user_id === userInfo?.id ? 'ring-1 ring-primary/40' : '',
						]"
						:ui="{ body: 'space-y-3 p-4 sm:p-4' }"
					>
						<div class="flex items-start gap-3">
							<UAvatar :text="initials(member.user.display_name)" size="md" />
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium text-white">
									{{ member.user.display_name }}
									<span v-if="member.user_id === userInfo?.id" class="text-xs font-normal text-primary-300">(du)</span>
								</p>
								<p class="truncate text-sm text-slate-400">{{ member.position || `@${member.user.username}` }}</p>
							</div>
							<UBadge
								:label="EVENT_ROLE_LABELS[member.role]"
								:color="getEventRoleColor(member.role)"
								variant="subtle"
								size="sm"
							/>
							<UDropdownMenu v-if="can('members:manage')" :items="memberMenu(member)" :ui="{ viewport: 'main-bg-color' }">
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</div>

						<div class="space-y-1 text-sm">
							<a v-if="member.user.phone" :href="`tel:${member.user.phone}`" class="flex items-center gap-2 text-primary-300 hover:underline">
								<UIcon name="i-lucide-phone" class="size-4 shrink-0" /> {{ member.user.phone }}
							</a>
							<a :href="`mailto:${member.user.email}`" class="flex items-center gap-2 break-all text-slate-300 hover:text-primary-300">
								<UIcon name="i-lucide-mail" class="size-4 shrink-0" /> {{ member.user.email }}
							</a>
							<p class="flex items-center gap-2 text-slate-400">
								<UIcon name="i-lucide-bed-double" class="size-4 shrink-0" />
								{{ member.room?.name ?? "Kein Zimmer" }}
							</p>
						</div>

						<div v-if="member.groups.length" class="flex flex-wrap gap-1.5">
							<NuxtLink v-for="group in member.groups" :key="group.id" :to="`/events/${eventId}/groups`">
								<UBadge color="neutral" variant="outline" size="sm">
									<span class="size-2 rounded-full" :style="{ backgroundColor: group.color ?? '#64748b' }" />
									{{ group.name }}
								</UBadge>
							</NuxtLink>
						</div>

						<div
							v-if="can('members:view_leader_notes') && member.leader_notes"
							class="rounded-lg border border-amber-900/50 bg-amber-950/30 p-2 text-xs text-amber-200"
						>
							<p class="mb-0.5 flex items-center gap-1 font-medium text-amber-300">
								<UIcon name="i-lucide-lock" class="size-3" /> Notiz der Leitung
							</p>
							<p class="whitespace-pre-line">{{ member.leader_notes }}</p>
						</div>
					</UCard>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal v-model:open="addOpen" title="Ins Team aufnehmen" icon="i-lucide-user-plus">
		<UForm :schema="addSchema" :state="addForm" class="space-y-4" @submit="submitAdd">
			<UFormField label="Person" name="user_id" required>
				<USelectMenu
					v-model="addForm.user_id"
					:items="userOptions"
					value-key="value"
					placeholder="Person suchen …"
					class="w-full"
				/>
			</UFormField>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Rolle" name="role">
					<USelect v-model="addForm.role" :items="EVENT_ROLE_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Funktion" name="position">
					<UInput v-model="addForm.position" placeholder="z. B. Küche, Erste Hilfe" class="w-full" />
				</UFormField>
			</div>
			<p class="text-xs text-slate-500">Die Person wird benachrichtigt und sieht das Event danach in ihrer Übersicht.</p>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="addOpen = false" />
				<UButton type="submit" label="Hinzufügen" :loading="adding" :disabled="!addForm.user_id" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardModal
		v-model:open="editOpen"
		:title="`${editing?.user.display_name ?? ''} bearbeiten`"
		icon="i-lucide-user-pen"
	>
		<UForm :schema="editSchema" :state="editForm" class="space-y-4" @submit="submitEdit">
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Rolle" name="role">
					<USelect v-model="editForm.role" :items="EVENT_ROLE_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Funktion" name="position">
					<UInput v-model="editForm.position" class="w-full" />
				</UFormField>
				<UFormField label="Zimmer" name="room_id" class="sm:col-span-2">
					<USelectMenu v-model="editForm.room_id" :items="roomOptions" value-key="value" class="w-full" />
				</UFormField>
			</div>
			<UFormField
				v-if="can('members:view_leader_notes')"
				label="Notiz der Leitung"
				name="leader_notes"
				description="Nur für die Leitung sichtbar."
			>
				<UTextarea v-model="editForm.leader_notes" :rows="3" autoresize class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="editOpen = false" />
				<UButton type="submit" label="Speichern" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="removeOpen"
		title="Aus dem Team entfernen"
		:warning-text="`${removeTarget?.user.display_name} wird aus dem Event entfernt. Gruppen-, Programmpunkt- und Zuständigkeitszuteilungen in diesem Event werden aufgehoben, zugewiesene Aufgaben werden wieder frei.`"
		:require-confirm-text="false"
		:on-delete="confirmRemove"
	/>
</template>
