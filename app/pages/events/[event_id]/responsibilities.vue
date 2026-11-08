<script setup lang="ts">
/**
 * "Wer ist wofür zuständig?" — standing responsibilities by area, and per person together with
 * the program items they are responsible for. Leaders (`responsibilities:manage`) edit; staff
 * see everything read-only.
 */
import type {
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdProgramResponses,
	GetEventsByEventIdResponsibilitiesResponses,
} from "~/api-client";
import { zPostEventsByEventIdResponsibilitiesBody } from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Responsibility = GetEventsByEventIdResponsibilitiesResponses["200"]["data"][number];
type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];
type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const userInfo = await useUserInfoStore().use();

useSeoMeta({ title: `Zuständigkeiten | ${event.value.name} | CMP` });

const { active: view, links: viewLinks } = useQueryTabs("view", [
	{ value: "area", label: "Nach Bereich", icon: "i-lucide-layout-grid" },
	{ value: "person", label: "Nach Person", icon: "i-lucide-users" },
]);
const search = ref("");
const onlyMine = ref(false);

// --- data ---------------------------------------------------------------------------------

const {
	data: responsibilities,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-responsibilities`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdResponsibilities({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Zuständigkeiten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Responsibility[];
	}
	return result.data;
});

const { data: members } = await useAPIAsyncData(`event-${eventId.value}-members`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
	);
	return result.success ? result.data : ([] as Member[]);
});

const { data: program } = await useAPIAsyncData(
	`event-${eventId.value}-program-by-person`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdProgram({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as ProgramItem[]);
	},
);

const term = computed(() => search.value.trim().toLowerCase());

const areaCards = computed(() =>
	[...(responsibilities.value ?? [])]
		.filter(
			(entry) => !onlyMine.value || entry.assignees.some((user) => user.id === userInfo.value?.id),
		)
		.filter(
			(entry) =>
				!term.value ||
				[
					entry.title,
					entry.location ?? "",
					entry.description,
					...entry.assignees.map((user) => user.display_name),
				]
					.join(" ")
					.toLowerCase()
					.includes(term.value),
		)
		.sort((a, b) => a.title.localeCompare(b.title, "de")),
);

const unassignedCount = computed(
	() => (responsibilities.value ?? []).filter((entry) => !entry.assignees.length).length,
);

const people = computed(() => {
	const list = [...(members.value ?? [])]
		.sort((a, b) => {
			if (a.user_id === userInfo.value?.id) return -1;
			if (b.user_id === userInfo.value?.id) return 1;
			if (a.role !== b.role) return a.role === "leader" ? -1 : 1;
			return a.user.display_name.localeCompare(b.user.display_name, "de");
		})
		.map((member) => ({
			member,
			responsibilities: (responsibilities.value ?? []).filter((entry) =>
				entry.assignees.some((user) => user.id === member.user_id),
			),
			programItems: (program.value ?? [])
				.filter((item) => item.responsible.some((user) => user.id === member.user_id))
				.sort((a, b) => a.start_at - b.start_at),
		}));

	return list.filter((entry) => {
		if (onlyMine.value && entry.member.user_id !== userInfo.value?.id) return false;
		if (!term.value) return true;
		return [
			entry.member.user.display_name,
			entry.member.position ?? "",
			...entry.responsibilities.map((r) => r.title),
			...entry.programItems.map((p) => p.title),
		]
			.join(" ")
			.toLowerCase()
			.includes(term.value);
	});
});

function isPast(item: ProgramItem) {
	return item.end_at < Date.now();
}

// --- create / edit ------------------------------------------------------------------------

const schema = zPostEventsByEventIdResponsibilitiesBody;

const formOpen = ref(false);
const editing = ref<Responsibility | null>(null);
const saving = ref(false);
const form = reactive({ title: "", location: "", description: "", assignee_ids: [] as number[] });

const memberOptions = computed(() =>
	(members.value ?? [])
		.map((member) => ({
			label: member.user.display_name,
			description: member.position ?? undefined,
			value: member.user_id,
		}))
		.sort((a, b) => a.label.localeCompare(b.label, "de")),
);

function openCreate() {
	editing.value = null;
	Object.assign(form, { title: "", location: "", description: "", assignee_ids: [] });
	formOpen.value = true;
}

function openEdit(entry: Responsibility) {
	editing.value = entry;
	Object.assign(form, {
		title: entry.title,
		location: entry.location ?? "",
		description: entry.description,
		assignee_ids: entry.assignees.map((user) => user.id),
	});
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	const body = {
		title: form.title.trim(),
		location: form.location.trim() || null,
		description: form.description.trim(),
		assignee_ids: form.assignee_ids,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putEventsByEventIdResponsibilitiesByResponsibilityId({
					path: { eventId: eventId.value, responsibilityId: target.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdResponsibilities({ path: { eventId: eventId.value }, body }),
			);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: target ? "Zuständigkeit gespeichert" : "Zuständigkeit angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await refresh();
}

// --- delete -------------------------------------------------------------------------------

const deleteTarget = ref<Responsibility | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdResponsibilitiesByResponsibilityId({
			path: { eventId: eventId.value, responsibilityId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `„${target.title}“ gelöscht`, color: "success" });
	await refresh();
}

function entryMenu(entry: Responsibility) {
	return [
		[{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(entry) }],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => {
					deleteTarget.value = entry;
					deleteOpen.value = true;
				},
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="event-responsibilities">
		<template #header>
			<DashboardPageHeader title="Zuständigkeiten" icon="i-lucide-badge-check" :description="event.name">
				<template v-if="can('responsibilities:manage')" #right>
					<UButton label="Neue Zuständigkeit" icon="i-lucide-plus" @click="openCreate" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<template #left>
					<UNavigationMenu :items="viewLinks" highlight class="-mx-1 flex-1" />
				</template>
				<template #right>
					<USwitch v-model="onlyMine" label="Nur meine" size="sm" />
					<UInput v-model="search" icon="i-lucide-search" placeholder="Suchen …" size="sm" class="w-40 sm:w-56" />
				</template>
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !responsibilities" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else-if="view === 'area'">
					<UAlert
						v-if="unassignedCount && can('responsibilities:manage')"
						icon="i-lucide-triangle-alert"
						color="warning"
						variant="subtle"
						:title="`${unassignedCount} Zuständigkeit${unassignedCount === 1 ? '' : 'en'} ohne verantwortliche Person`"
					/>

					<UEmpty
						v-if="!areaCards.length"
						icon="i-lucide-badge-check"
						:title="responsibilities?.length ? 'Nichts gefunden' : 'Noch keine Zuständigkeiten'"
						:description="
							responsibilities?.length
								? 'Passe Suche oder Filter an.'
								: 'Lege fest, wer sich um Erste Hilfe, Getränke, Material, Haus 2 … kümmert.'
						"
					>
						<template v-if="can('responsibilities:manage') && !responsibilities?.length" #actions>
							<UButton label="Zuständigkeit anlegen" icon="i-lucide-plus" @click="openCreate" />
						</template>
					</UEmpty>

					<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
						<UCard
							v-for="entry in areaCards"
							:key="entry.id"
							class="border-slate-800 bg-slate-900/60"
							:ui="{ body: 'space-y-3 p-4 sm:p-4' }"
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="font-medium text-white">{{ entry.title }}</p>
									<p v-if="entry.location" class="flex items-center gap-1 text-sm text-slate-400">
										<UIcon name="i-lucide-map-pin" class="size-3.5" /> {{ entry.location }}
									</p>
								</div>
								<UDropdownMenu
									v-if="can('responsibilities:manage')"
									:items="entryMenu(entry)"
									:ui="{ viewport: 'main-bg-color' }"
								>
									<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
								</UDropdownMenu>
							</div>
							<p v-if="entry.description" class="whitespace-pre-line text-sm text-slate-300">{{ entry.description }}</p>
							<div v-if="entry.assignees.length" class="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-800 pt-3">
								<StaffUserChip
									v-for="user in entry.assignees"
									:key="user.id"
									:user="user"
									size="xs"
									:highlight="user.id === userInfo?.id"
								/>
							</div>
							<UBadge v-else label="Niemand zuständig" color="warning" variant="subtle" size="sm" />
						</UCard>
					</div>
				</template>

				<template v-else>
					<UEmpty
						v-if="!people.length"
						icon="i-lucide-users"
						title="Niemand gefunden"
						description="Passe Suche oder Filter an."
					/>

					<div v-else class="grid gap-4 lg:grid-cols-2">
						<DashboardSectionCard
							v-for="entry in people"
							:key="entry.member.id"
							:title="entry.member.user_id === userInfo?.id ? `${entry.member.user.display_name} (du)` : entry.member.user.display_name"
							:description="entry.member.position ?? EVENT_ROLE_LABELS[entry.member.role]"
							:icon="entry.member.role === 'leader' ? 'i-lucide-crown' : 'i-lucide-user'"
						>
							<div class="space-y-4">
								<div>
									<p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Zuständigkeiten</p>
									<ul v-if="entry.responsibilities.length" class="space-y-1 text-sm">
										<li v-for="responsibility in entry.responsibilities" :key="responsibility.id" class="flex items-center gap-2">
											<UIcon name="i-lucide-badge-check" class="size-4 shrink-0 text-primary-400" />
											<span class="text-slate-200">{{ responsibility.title }}</span>
											<span v-if="responsibility.location" class="truncate text-slate-500">· {{ responsibility.location }}</span>
										</li>
									</ul>
									<p v-else class="text-sm text-slate-500">Keine festen Zuständigkeiten.</p>
								</div>

								<div>
									<p class="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Programmpunkte</p>
									<ul v-if="entry.programItems.length" class="space-y-1.5 text-sm">
										<li
											v-for="item in entry.programItems"
											:key="item.id"
											:class="['flex items-start gap-2', isPast(item) ? 'opacity-50' : '']"
										>
											<span class="mt-1.5 size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.color ?? '#64748b' }" />
											<span class="min-w-0">
												<NuxtLink :to="`/events/${eventId}/program`" class="text-slate-200 hover:text-primary-300">
													{{ item.title }}
												</NuxtLink>
												<span class="block text-xs text-slate-500">
													{{ formatShortDay(item.start_at) }}, {{ formatTimeRange(item.start_at, item.end_at) }}
													<template v-if="item.location"> · {{ item.location }}</template>
												</span>
											</span>
										</li>
									</ul>
									<p v-else class="text-sm text-slate-500">Für keinen Programmpunkt eingeteilt.</p>
								</div>
							</div>
						</DashboardSectionCard>
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Zuständigkeit bearbeiten' : 'Neue Zuständigkeit'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-badge-plus'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Bereich / Aufgabe" name="title" required>
				<UInput v-model="form.title" placeholder="z. B. Erste Hilfe, Getränke, Haus 2" class="w-full" autofocus />
			</UFormField>
			<UFormField label="Ort" name="location">
				<UInput v-model="form.location" placeholder="z. B. Sanitätsraum" class="w-full" />
			</UFormField>
			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="form.description" :rows="3" autoresize class="w-full" />
			</UFormField>
			<UFormField label="Verantwortlich" name="assignee_ids">
				<USelectMenu
					v-model="form.assignee_ids"
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
		title="Zuständigkeit löschen"
		:warning-text="`„${deleteTarget?.title}“ wird gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
