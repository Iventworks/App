<script setup lang="ts">
/**
 * "Wer ist wofür zuständig?" Layout for the two views — "Nach Bereich" (`/responsibilities`) and
 * "Nach Person" (`/responsibilities/people`, together with the program items each person leads) —
 * as toolbar sub-navigation (style guide 07: useSubrouterPathDynamics). It loads responsibilities
 * and team, owns the filters (`DashboardFilterBar`) and the create/edit/delete modals, and shares
 * them with the views via `provideEventResponsibilitiesView`. Leaders (`responsibilities:manage`)
 * edit; staff see everything read-only.
 */
import type {
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdResponsibilitiesResponses,
} from "~/api-client";
import { zPostEventsByEventIdResponsibilitiesBody } from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";

type Responsibility = GetEventsByEventIdResponsibilitiesResponses["200"]["data"][number];
type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const route = useRoute();
const userInfo = await useUserInfoStore().use();

// --- sub-navigation -----------------------------------------------------------------------

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	[`/events/${eventId.value}/responsibilities`]: {
		isNavLink: true,
		label: "Nach Bereich",
		icon: "i-lucide-layout-grid",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { description: `Zuständigkeiten von ${event.value.name} nach Bereich` },
			breadcrumbItems: [],
		}),
	},
	[`/events/${eventId.value}/responsibilities/people`]: {
		isNavLink: true,
		label: "Nach Person",
		icon: "i-lucide-users",
		getDynamicValues: () => ({
			seoSettings: {
				title: "Nach Person",
				description: `Zuständigkeiten von ${event.value.name} nach Person`,
			},
			breadcrumbItems: [],
		}),
	},
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: `Zuständigkeiten | ${event.value.name} | CMP`,
	routes,
});

await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});

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

// --- filters ------------------------------------------------------------------------------

const search = ref("");
const onlyMine = ref(false);
const term = computed(() => search.value.trim().toLowerCase());
const canManage = computed(() => can("responsibilities:manage"));

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

provideEventResponsibilitiesView({
	responsibilities,
	members,
	term,
	onlyMine,
	userId: computed(() => userInfo.value?.id),
	canManage,
	entryMenu,
});
</script>

<template>
	<UDashboardPanel id="event-responsibilities">
		<template #header>
			<DashboardPageHeader title="Zuständigkeiten" icon="i-lucide-badge-check" :description="event.name" />

			<UDashboardToolbar>
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<UInput
							v-model="search"
							icon="i-lucide-search"
							placeholder="Suchen …"
							class="w-full sm:w-auto sm:min-w-56"
						/>
						<USwitch v-model="onlyMine" label="Nur meine" />
					</template>
					<template v-if="canManage" #right>
						<UButton label="Neue Zuständigkeit" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !responsibilities" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>
				<NuxtPage v-else />
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
