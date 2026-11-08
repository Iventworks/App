<script setup lang="ts">
/**
 * Staff sub-groups of the event ("Leitungsteam", "Küchenteam", "Musikteam" …). Each group has its
 * own chat channel and group notes; leaders (`groups:manage`) create and edit groups.
 */
import type {
	GetEventsByEventIdGroupsResponses,
	GetEventsByEventIdMembersResponses,
} from "~/api-client";
import { zPostEventsByEventIdGroupsBody } from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Group = GetEventsByEventIdGroupsResponses["200"]["data"][number];
type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const userInfo = await useUserInfoStore().use();

useSeoMeta({ title: `Gruppen | ${event.value.name} | CMP` });

const FALLBACK_COLOR = "#64748b";

// --- data ---------------------------------------------------------------------------------

const {
	data: groups,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-groups`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdGroups({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Gruppen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Group[];
	}
	return result.data;
});

const { data: members, refresh: refreshMembers } = await useAPIAsyncData(
	`event-${eventId.value}-members`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Member[]);
	},
);

const sortedGroups = computed(() =>
	[...(groups.value ?? [])].sort((a, b) => a.name.localeCompare(b.name, "de")),
);

function isMyGroup(group: Group) {
	return group.members.some((member) => member.id === userInfo.value?.id);
}

const memberOptions = computed(() =>
	(members.value ?? [])
		.map((member) => ({
			label: member.user.display_name,
			description: member.position ?? undefined,
			value: member.user_id,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, "de")),
);

// --- create / edit ------------------------------------------------------------------------

const schema = zPostEventsByEventIdGroupsBody;

const formOpen = ref(false);
const editing = ref<Group | null>(null);
const saving = ref(false);
const form = reactive({
	name: "",
	description: "",
	color: COLOR_PRESETS[0] as string | null,
	member_ids: [] as number[],
});

function openCreate() {
	editing.value = null;
	Object.assign(form, { name: "", description: "", color: COLOR_PRESETS[0], member_ids: [] });
	formOpen.value = true;
}

function openEdit(group: Group) {
	editing.value = group;
	Object.assign(form, {
		name: group.name,
		description: group.description,
		color: group.color,
		member_ids: group.members.map((member) => member.id),
	});
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	const body = {
		name: form.name.trim(),
		description: form.description.trim(),
		color: form.color,
		member_ids: form.member_ids,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdGroupsByGroupId({
					path: { eventId: eventId.value, groupId: target.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdGroups({ path: { eventId: eventId.value }, body }),
			);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: target ? "Gruppe gespeichert" : "Gruppe angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await Promise.all([refresh(), refreshMembers()]);
}

// --- delete -------------------------------------------------------------------------------

const deleteTarget = ref<Group | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdGroupsByGroupId({
			path: { eventId: eventId.value, groupId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `Gruppe „${target.name}“ gelöscht`, color: "success" });
	await Promise.all([refresh(), refreshMembers()]);
}

function groupMenu(group: Group) {
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
	<UDashboardPanel id="event-groups">
		<template #header>
			<DashboardPageHeader title="Gruppen" icon="i-lucide-users-round" :description="event.name">
				<template v-if="can('groups:manage')" #right>
					<UButton label="Neue Gruppe" icon="i-lucide-plus" @click="openCreate" />
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !groups" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!sortedGroups.length"
					icon="i-lucide-users-round"
					title="Noch keine Gruppen"
					description="Gruppen wie Leitungsteam, Küchenteam oder Musikteam bekommen einen eigenen Chat und eigene Notizen."
				>
					<template v-if="can('groups:manage')" #actions>
						<UButton label="Gruppe anlegen" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</UEmpty>

				<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<UCard
						v-for="group in sortedGroups"
						:key="group.id"
						class="overflow-hidden border-slate-800 bg-slate-900/60"
						:ui="{ body: 'space-y-4 p-4 sm:p-4' }"
					>
						<div class="-mx-4 -mt-4 h-1.5" :style="{ backgroundColor: group.color ?? FALLBACK_COLOR }" />

						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="flex items-center gap-2 font-medium text-white">
									{{ group.name }}
									<UBadge v-if="isMyGroup(group)" label="Du bist dabei" color="primary" variant="subtle" size="sm" />
								</p>
								<p v-if="group.description" class="mt-1 whitespace-pre-line text-sm text-slate-400">
									{{ group.description }}
								</p>
							</div>
							<UDropdownMenu v-if="can('groups:manage')" :items="groupMenu(group)" :ui="{ viewport: 'main-bg-color' }">
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</div>

						<div>
							<p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
								{{ group.member_count }} Mitglied{{ group.member_count === 1 ? "" : "er" }}
							</p>
							<div v-if="group.members.length" class="flex flex-wrap gap-x-4 gap-y-2">
								<StaffUserChip
									v-for="member in group.members"
									:key="member.id"
									:user="member"
									size="xs"
									:highlight="member.id === userInfo?.id"
								/>
							</div>
							<p v-else class="text-sm text-slate-500">Noch niemand in dieser Gruppe.</p>
						</div>

						<div class="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
							<UButton
								label="Gruppenchat"
								icon="i-lucide-messages-square"
								size="sm"
								color="neutral"
								variant="subtle"
								:to="`/messages?group=${group.id}`"
							/>
							<UButton
								label="Gruppennotizen"
								icon="i-lucide-sticky-note"
								size="sm"
								color="neutral"
								variant="ghost"
								:to="`/events/${eventId}/notes?group=${group.id}`"
							/>
						</div>
					</UCard>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Gruppe bearbeiten' : 'Neue Gruppe'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-users-round'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Name" name="name" required>
				<UInput v-model="form.name" placeholder="z. B. Küchenteam" class="w-full" autofocus />
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
			<UFormField label="Mitglieder" name="member_ids" description="Nur Personen aus dem Team des Events.">
				<USelectMenu
					v-model="form.member_ids"
					:items="memberOptions"
					value-key="value"
					multiple
					placeholder="Personen auswählen"
					class="w-full"
				/>
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Gruppe löschen"
		:warning-text="`Die Gruppe „${deleteTarget?.name}“ wird gelöscht – mit ihrem Gruppenchat und ihren Gruppennotizen. Aufgaben der Gruppe bleiben ohne Gruppe erhalten.`"
		:on-delete="confirmDelete"
	/>
</template>
