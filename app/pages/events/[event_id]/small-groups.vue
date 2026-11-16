<script setup lang="ts">
/**
 * "Kleingruppen": small groups of participants, each led by one or more people from the team
 * (e.g. for "Kleingruppenzeit" or activities done in groups). Everyone on the team sees the groups;
 * leaders (`small_groups:manage`) create them and switch to "Einteilen": drag participants between
 * groups (desktop) or pick a group per person (touch/keyboard), then save all changes at once.
 * A participant is in at most one group; one person may lead several.
 */
import type {
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdParticipantsResponses,
	GetEventsByEventIdSmallGroupsResponses,
} from "~/api-client";
import { zPostEventsByEventIdSmallGroupsBody } from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type SmallGroup = GetEventsByEventIdSmallGroupsResponses["200"]["data"][number];
type Participant = GetEventsByEventIdParticipantsResponses["200"]["data"][number];
type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];
type Gender = NonNullable<Participant["gender"]>;

interface Person {
	id: number;
	name: string;
	gender: Gender | null;
	age: number | null;
}

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const user = await useUserInfoStore().use();
const toast = useToast();

useSeoMeta({ title: `Kleingruppen | ${event.value.name}` });

const GENDER_DOT: Record<Gender, string> = {
	female: "bg-pink-400",
	male: "bg-indigo-400",
	diverse: "bg-amber-400",
};
const GENDER_SHORT: Record<Gender, string> = { female: "w", male: "m", diverse: "d" };

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
	data: groups,
	loading,
	refresh: refreshGroups,
} = await useAPIAsyncData(`event-${eventId.value}-small-groups`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdSmallGroups({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Kleingruppen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as SmallGroup[];
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

const { data: members } = await useAPIAsyncData(`event-${eventId.value}-members`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : ([] as Member[]);
});

async function refreshAll() {
	await Promise.all([refreshGroups(), refreshParticipants()]);
}

/** Participants taking part: registered or confirmed (not cancelled / waitlist). */
const activeParticipants = computed(() =>
	(participants.value ?? []).filter(
		(participant) => participant.status === "registered" || participant.status === "confirmed",
	),
);

function toPerson(
	participant: Pick<Participant, "id" | "first_name" | "last_name" | "gender" | "birth_date">,
): Person {
	return {
		id: participant.id,
		name: `${participant.first_name} ${participant.last_name}`,
		gender: participant.gender,
		age: ageOn(participant.birth_date),
	};
}

const unassigned = computed(() =>
	activeParticipants.value
		.filter((participant) => participant.small_group_id === null)
		.map(toPerson),
);

const assignedCount = computed(() => activeParticipants.value.length - unassigned.value.length);

const staffOptions = computed(() =>
	(members.value ?? [])
		.map((member) => ({
			label: member.user.display_name,
			description: member.position ?? undefined,
			value: member.user_id,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, "de")),
);

// --- overview cards -------------------------------------------------------------------------

const search = ref("");

const cards = computed(() =>
	(groups.value ?? []).map((group) => ({
		group,
		people: group.participants.map(toPerson),
		isMine: group.leaders.some((leader) => leader.id === user.value?.id),
	})),
);

const visibleCards = computed(() => {
	const term = search.value.trim().toLowerCase();
	const list = term
		? cards.value.filter(
				(card) =>
					card.group.name.toLowerCase().includes(term) ||
					(card.group.meeting_point ?? "").toLowerCase().includes(term) ||
					card.group.leaders.some((leader) => leader.display_name.toLowerCase().includes(term)) ||
					card.people.some((person) => person.name.toLowerCase().includes(term)),
			)
		: cards.value;
	// Groups the viewer leads first.
	return [...list].sort((a, b) => Number(b.isMine) - Number(a.isMine));
});

// --- assignment mode ----------------------------------------------------------------------

const assigning = ref(false);
const draft = ref<Record<number, number | null>>({});
const savingAssignments = ref(false);

function startAssigning() {
	draft.value = Object.fromEntries(
		activeParticipants.value.map((participant) => [participant.id, participant.small_group_id]),
	);
	assigning.value = true;
}

function draftGroupOf(person: Person) {
	return draft.value[person.id] ?? null;
}

function setDraftGroup(person: Person, groupId: number | null) {
	draft.value[person.id] = groupId;
}

const draftColumns = computed(() => {
	const people = activeParticipants.value.map(toPerson);
	return [
		{
			id: null as number | null,
			name: "Ohne Kleingruppe",
			color: null as string | null,
			leaders: [] as SmallGroup["leaders"],
			people: people.filter((person) => draftGroupOf(person) === null),
		},
		...(groups.value ?? []).map((group) => ({
			id: group.id as number | null,
			name: group.name,
			color: group.color,
			leaders: group.leaders,
			people: people.filter((person) => draftGroupOf(person) === group.id),
		})),
	];
});

const changes = computed(() =>
	activeParticipants.value
		.filter((participant) => (draft.value[participant.id] ?? null) !== participant.small_group_id)
		.map((participant) => ({
			participant_id: participant.id,
			small_group_id: draft.value[participant.id] ?? null,
		})),
);

const groupOptions = computed(() => [
	{ label: "Ohne Kleingruppe", value: null },
	...(groups.value ?? []).map((group) => ({ label: group.name, value: group.id })),
]);

const draggedPerson = ref<Person | null>(null);
const dropTarget = ref<number | "none" | null>(null);

function onDragStart(dragEvent: DragEvent, person: Person) {
	draggedPerson.value = person;
	dragEvent.dataTransfer?.setData("text/plain", String(person.id));
	if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = "move";
}

function onDragOver(dragEvent: DragEvent, groupId: number | null) {
	if (!draggedPerson.value) return;
	dragEvent.preventDefault();
	dropTarget.value = groupId ?? "none";
}

function onDrop(groupId: number | null) {
	if (draggedPerson.value) setDraftGroup(draggedPerson.value, groupId);
	draggedPerson.value = null;
	dropTarget.value = null;
}

function onDragEnd() {
	draggedPerson.value = null;
	dropTarget.value = null;
}

/** Save the draft; true when it was saved (or there was nothing to save). */
async function saveAssignments(): Promise<boolean> {
	if (changes.value.length === 0) {
		assigning.value = false;
		return true;
	}
	savingAssignments.value = true;
	const result = await useAPI((api) =>
		api.putEventsByEventIdSmallGroupsAssignments({
			path: { eventId: eventId.value },
			body: { participants: changes.value },
		}),
	);
	savingAssignments.value = false;
	if (!result.success) {
		toast.add({
			title: "Einteilung konnte nicht gespeichert werden",
			description: result.message,
			color: "error",
		});
		return false;
	}
	toast.add({ title: "Kleingruppen eingeteilt", color: "success", icon: "i-lucide-check" });
	assigning.value = false;
	await refreshAll();
	return true;
}

const askUnsaved = useUnsavedChangesDialog();
onBeforeRouteLeave(async () => {
	if (!assigning.value || changes.value.length === 0) return true;
	const choice = await askUnsaved("Die Einteilung in Kleingruppen ist noch nicht gespeichert.");
	if (choice === "save") return await saveAssignments();
	return choice === "discard";
});

// --- create / edit / delete ---------------------------------------------------------------

const schema = zPostEventsByEventIdSmallGroupsBody;

const formOpen = ref(false);
const editing = ref<SmallGroup | null>(null);
const saving = ref(false);
const form = reactive({
	name: "",
	meeting_point: "",
	description: "",
	color: COLOR_PRESETS[0] as string | null,
	leader_ids: [] as number[],
});

function openCreate() {
	editing.value = null;
	const nextColor = COLOR_PRESETS[(groups.value?.length ?? 0) % COLOR_PRESETS.length] ?? null;
	Object.assign(form, {
		name: "",
		meeting_point: "",
		description: "",
		color: nextColor,
		leader_ids: [],
	});
	formOpen.value = true;
}

function openEdit(group: SmallGroup) {
	editing.value = group;
	Object.assign(form, {
		name: group.name,
		meeting_point: group.meeting_point ?? "",
		description: group.description,
		color: group.color,
		leader_ids: group.leaders.map((leader) => leader.id),
	});
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	const body = {
		name: form.name.trim(),
		meeting_point: form.meeting_point.trim() || null,
		description: form.description.trim(),
		color: form.color,
		leader_ids: form.leader_ids,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdSmallGroupsBySmallGroupId({
					path: { eventId: eventId.value, smallGroupId: target.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdSmallGroups({ path: { eventId: eventId.value }, body }),
			);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: target ? "Kleingruppe gespeichert" : "Kleingruppe angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await refreshGroups();
}

const deleteTarget = ref<SmallGroup | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdSmallGroupsBySmallGroupId({
			path: { eventId: eventId.value, smallGroupId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `Kleingruppe „${target.name}“ gelöscht`, color: "success" });
	await refreshAll();
}

function groupMenu(group: SmallGroup) {
	return [
		[{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(group) }],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => {
					deleteTarget.value = group;
					deleteOpen.value = true;
				},
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="event-small-groups">
		<template #header>
			<DashboardPageHeader title="Kleingruppen" icon="i-lucide-group" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<p v-if="assigning" class="text-sm text-slate-400">
							{{
								changes.length
									? `${changes.length} ungespeicherte Änderung${changes.length === 1 ? "" : "en"}`
									: "Noch keine Änderungen"
							}}
						</p>
						<UInput
							v-else
							v-model="search"
							icon="i-lucide-search"
							placeholder="Gruppe, Leitung oder Person suchen …"
							class="w-full sm:w-72"
						/>
					</template>
					<template v-if="can('small_groups:manage')" #right>
						<template v-if="assigning">
							<UButton label="Abbrechen" color="neutral" variant="ghost" @click="assigning = false" />
							<UButton
								:label="changes.length ? `Speichern (${changes.length})` : 'Fertig'"
								icon="i-lucide-save"
								:loading="savingAssignments"
								@click="saveAssignments"
							/>
						</template>
						<template v-else>
							<UButton
								label="Einteilen"
								icon="i-lucide-move"
								color="neutral"
								variant="subtle"
								:disabled="!groups?.length"
								@click="startAssigning"
							/>
							<UButton label="Kleingruppe anlegen" icon="i-lucide-plus" @click="openCreate" />
						</template>
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !groups" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!groups?.length"
					icon="i-lucide-group"
					title="Noch keine Kleingruppen"
					description="Teile die Teilnehmenden in kleine Gruppen mit festen Ansprechpersonen aus dem Team ein – z. B. für die Kleingruppenzeit."
				>
					<template v-if="can('small_groups:manage')" #actions>
						<UButton label="Kleingruppe anlegen" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</UEmpty>

				<!-- Assignment board -->
				<template v-else-if="assigning">
					<UAlert
						icon="i-lucide-hand"
						color="neutral"
						variant="subtle"
						title="Kleingruppen einteilen"
						description="Ziehe Teilnehmende in eine Gruppe oder wähle die Gruppe direkt an der Person. Änderungen werden erst mit „Speichern“ übernommen."
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
							<div class="mb-3 flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="flex items-center gap-2 font-medium text-white">
										<span
											v-if="column.id !== null"
											class="size-2.5 shrink-0 rounded-full bg-slate-500"
											:style="column.color ? { backgroundColor: column.color } : undefined"
										/>
										<span class="truncate">{{ column.name }}</span>
									</p>
									<p v-if="column.leaders.length" class="truncate text-xs text-slate-500">
										{{ column.leaders.map((leader) => leader.display_name).join(", ") }}
									</p>
								</div>
								<UBadge :label="String(column.people.length)" color="neutral" variant="outline" size="sm" />
							</div>

							<ul class="min-h-12 space-y-1.5">
								<li
									v-for="person in column.people"
									:key="person.id"
									draggable="true"
									:class="[
										'flex cursor-grab items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5 active:cursor-grabbing',
										draggedPerson?.id === person.id ? 'opacity-50' : '',
									]"
									@dragstart="onDragStart($event, person)"
									@dragend="onDragEnd"
								>
									<UIcon name="i-lucide-grip-vertical" class="hidden size-4 shrink-0 text-slate-600 sm:block" />
									<span v-if="person.gender" :class="['size-2 shrink-0 rounded-full', GENDER_DOT[person.gender]]" />
									<span class="min-w-0 flex-1 truncate text-sm text-slate-200">
										{{ person.name }}
										<span v-if="person.age !== null" class="text-slate-500">({{ person.age }})</span>
									</span>
									<USelectMenu
										:model-value="draftGroupOf(person)"
										:items="groupOptions"
										value-key="value"
										size="xs"
										class="w-36 shrink-0"
										:aria-label="`Kleingruppe für ${person.name}`"
										@update:model-value="(value: number | null) => setDraftGroup(person, value)"
									/>
								</li>
								<li
									v-if="!column.people.length"
									class="rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500"
								>
									Hierher ziehen
								</li>
							</ul>
						</div>
					</div>
				</template>

				<!-- Overview -->
				<template v-else>
					<div class="grid gap-4 sm:grid-cols-3">
						<DashboardStatCard label="Kleingruppen" :value="groups.length" icon="i-lucide-group" />
						<DashboardStatCard
							label="Eingeteilt"
							:value="`${assignedCount} / ${activeParticipants.length}`"
							hint="Angemeldete und bestätigte Teilnehmende"
							icon="i-lucide-users"
						/>
						<DashboardStatCard
							label="Ohne Kleingruppe"
							:value="unassigned.length"
							:icon-color="unassigned.length ? 'amber' : 'emerald'"
							icon="i-lucide-user-x"
						/>
					</div>

					<UEmpty
						v-if="!visibleCards.length"
						icon="i-lucide-search-x"
						title="Nichts gefunden"
						description="Keine Kleingruppe und keine Person passt zur Suche."
					/>

					<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<UCard
							v-for="card in visibleCards"
							:key="card.group.id"
							:class="['bg-slate-900/60', card.isMine ? 'border-primary/50' : 'border-slate-800']"
							:ui="{ body: 'space-y-3 p-4 sm:p-4' }"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="flex items-center gap-2 font-medium text-white">
										<span
											class="size-2.5 shrink-0 rounded-full bg-slate-500"
											:style="card.group.color ? { backgroundColor: card.group.color } : undefined"
										/>
										<span class="truncate">{{ card.group.name }}</span>
									</p>
									<p v-if="card.group.meeting_point" class="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
										<UIcon name="i-lucide-map-pin" class="size-3.5 shrink-0" />
										{{ card.group.meeting_point }}
									</p>
								</div>
								<div class="flex items-center gap-1">
									<UBadge v-if="card.isMine" label="Deine Gruppe" color="primary" variant="subtle" size="sm" />
									<UBadge
										v-if="!card.group.leaders.length"
										label="Ohne Leitung"
										color="warning"
										variant="subtle"
										size="sm"
									/>
									<UDropdownMenu
										v-if="can('small_groups:manage')"
										:items="groupMenu(card.group)"
										:ui="{ viewport: 'main-bg-color' }"
									>
										<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
									</UDropdownMenu>
								</div>
							</div>

							<p v-if="card.group.description" class="whitespace-pre-line text-sm text-slate-400">
								{{ card.group.description }}
							</p>

							<p v-if="card.group.leaders.length" class="flex items-start gap-1.5 text-xs text-slate-400">
								<UIcon name="i-lucide-user-check" class="mt-px size-3.5 shrink-0 text-primary-400" />
								<span>
									Leitung:
									<span class="text-slate-200">{{ card.group.leaders.map((leader) => leader.display_name).join(", ") }}</span>
								</span>
							</p>

							<div>
								<p class="mb-1 text-xs uppercase tracking-wide text-slate-500">
									{{ card.people.length }} Teilnehmende
								</p>
								<ul v-if="card.people.length" class="space-y-1">
									<li v-for="person in card.people" :key="person.id" class="flex items-center gap-2 text-sm">
										<span v-if="person.gender" :class="['size-2 shrink-0 rounded-full', GENDER_DOT[person.gender]]" />
										<span v-else class="size-2 shrink-0" />
										<NuxtLink
											:to="`/events/${eventId}/participants/${person.id}`"
											class="truncate text-slate-200 hover:text-primary-300"
										>
											{{ person.name }}
										</NuxtLink>
										<span class="ml-auto shrink-0 text-xs text-slate-500">
											{{ person.gender ? GENDER_SHORT[person.gender] : "" }}{{ person.age !== null ? ` · ${person.age}` : "" }}
										</span>
									</li>
								</ul>
								<p v-else class="text-sm text-slate-500">Noch leer.</p>
							</div>
						</UCard>
					</div>

					<DashboardSectionCard
						v-if="unassigned.length"
						title="Ohne Kleingruppe"
						:description="`${unassigned.length} Teilnehmende`"
						icon="i-lucide-user-x"
					>
						<template v-if="can('small_groups:manage')" #actions>
							<UButton label="Jetzt einteilen" icon="i-lucide-move" size="sm" @click="startAssigning" />
						</template>
						<div class="flex flex-wrap gap-2">
							<UBadge
								v-for="person in unassigned"
								:key="person.id"
								:label="person.name"
								color="neutral"
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
		:title="editing ? 'Kleingruppe bearbeiten' : 'Neue Kleingruppe'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-group'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Name" name="name" required>
				<UInput v-model="form.name" placeholder="z. B. Gruppe 1 / Die Füchse" class="w-full" autofocus />
			</UFormField>
			<UFormField
				label="Leitung"
				name="leader_ids"
				description="Eine oder mehrere Personen aus dem Team, die für die Gruppe verantwortlich sind."
			>
				<USelectMenu
					v-model="form.leader_ids"
					:items="staffOptions"
					value-key="value"
					multiple
					placeholder="Personen aus dem Team auswählen"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Treffpunkt" name="meeting_point" description="Wo sich die Gruppe trifft, z. B. zur Kleingruppenzeit.">
				<UInput v-model="form.meeting_point" placeholder="z. B. Gruppenraum 2, am Lagerfeuer" class="w-full" />
			</UFormField>
			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="form.description" :rows="2" autoresize class="w-full" />
			</UFormField>
			<UFormField label="Farbe" name="color">
				<div class="flex flex-wrap gap-2">
					<button
						v-for="color in COLOR_PRESETS"
						:key="color"
						type="button"
						:aria-label="`Farbe ${color}`"
						:class="[
							'size-7 rounded-full ring-offset-2 ring-offset-slate-900 transition',
							form.color === color ? 'ring-2 ring-white' : 'hover:ring-2 hover:ring-slate-500',
						]"
						:style="{ backgroundColor: color }"
						@click="form.color = color"
					/>
					<button
						type="button"
						aria-label="Keine Farbe"
						:class="[
							'flex size-7 items-center justify-center rounded-full border border-dashed border-slate-600 ring-offset-2 ring-offset-slate-900',
							form.color === null ? 'ring-2 ring-white' : '',
						]"
						@click="form.color = null"
					>
						<UIcon name="i-lucide-ban" class="size-3.5 text-slate-500" />
					</button>
				</div>
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Kleingruppe löschen"
		:warning-text="`Die Kleingruppe „${deleteTarget?.name}“ wird gelöscht. Ihre Teilnehmenden sind danach in keiner Kleingruppe.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
