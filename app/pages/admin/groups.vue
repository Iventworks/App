<script setup lang="ts">
/**
 * Administration: groups of people across the organisation ("Technikteam", "Leitungskreis"). The
 * Kernteam can give them access to organisation documents; deleting a group ends that access.
 */
import { zPostAdminGroupsBody } from "~/api-client/zod.gen";
import type { OrgGroup, UserSummary } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Gruppen | Administration" });

const toast = useToast();

const FALLBACK_COLOR = "#64748b";

const {
	data: groups,
	loading,
	refresh,
} = await useAPIAsyncData("admin-org-groups", async () => {
	const result = await useAPI((api) => api.getAdminGroups({}));
	if (!result.success) {
		toast.add({
			title: "Gruppen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as OrgGroup[];
	}
	return result.data;
});

const { data: users } = await useAPIAsyncData("admin-org-groups-users", async () => {
	const result = await useAPI((api) => api.getUsers({}));
	return result.success ? result.data : ([] as UserSummary[]);
});

const search = ref("");
const visibleGroups = computed(() => {
	const term = search.value.trim().toLowerCase();
	const all = groups.value ?? [];
	if (!term) return all;
	return all.filter(
		(group) =>
			group.name.toLowerCase().includes(term) ||
			group.description.toLowerCase().includes(term) ||
			group.members.some((member) => member.display_name.toLowerCase().includes(term)),
	);
});

const userOptions = computed(() =>
	(users.value ?? [])
		.map((user) => ({ label: user.display_name, description: `@${user.username}`, value: user.id }))
		.sort((a, b) => a.label.localeCompare(b.label, "de")),
);

// --- create / edit ------------------------------------------------------------------------

const schema = zPostAdminGroupsBody;

const formOpen = ref(false);
const editing = ref<OrgGroup | null>(null);
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

function openEdit(group: OrgGroup) {
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
		? await useAPI((api) => api.putAdminGroupsByGroupId({ path: { groupId: target.id }, body }))
		: await useAPI((api) => api.postAdminGroups({ body }));
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
	await refresh();
}

// --- delete -------------------------------------------------------------------------------

const deleteTarget = ref<OrgGroup | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteAdminGroupsByGroupId({ path: { groupId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `Gruppe „${target.name}“ gelöscht`, color: "success" });
	await refresh();
}

function groupMenu(group: OrgGroup) {
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
	<UDashboardPanel id="admin-groups">
		<template #header>
			<DashboardPageHeader
				title="Gruppen"
				icon="i-lucide-users-round"
				description="Gruppen der Organisation – für den Zugriff auf Dokumente"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<UInput
							v-model="search"
							icon="i-lucide-search"
							placeholder="Gruppe oder Person suchen …"
							class="w-full sm:w-64"
						/>
					</template>
					<template #right>
						<UButton label="Neue Gruppe" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !groups" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!groups?.length"
					icon="i-lucide-users-round"
					title="Noch keine Gruppen"
					description="Gruppen wie Technikteam oder Leitungskreis kann das Kernteam Zugriff auf Dokumente geben."
				/>

				<UEmpty
					v-else-if="!visibleGroups.length"
					icon="i-lucide-search-x"
					title="Nichts gefunden"
					description="Passe die Suche an."
				/>

				<div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<UCard
						v-for="group in visibleGroups"
						:key="group.id"
						class="overflow-hidden border-slate-800 bg-slate-900/60"
						:ui="{ body: 'space-y-4 p-4 sm:p-4' }"
					>
						<div class="-mx-4 -mt-4 h-1.5" :style="{ backgroundColor: group.color ?? FALLBACK_COLOR }" />

						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="font-medium text-white">{{ group.name }}</p>
								<p v-if="group.description" class="mt-1 whitespace-pre-line text-sm text-slate-400">
									{{ group.description }}
								</p>
							</div>
							<UDropdownMenu :items="groupMenu(group)" :ui="{ viewport: 'main-bg-color' }">
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</div>

						<div>
							<p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
								{{ group.member_count }} Mitglied{{ group.member_count === 1 ? "" : "er" }}
							</p>
							<div v-if="group.members.length" class="flex flex-wrap gap-x-4 gap-y-2">
								<StaffUserChip v-for="member in group.members" :key="member.id" :user="member" size="xs" />
							</div>
							<p v-else class="text-sm text-slate-500">Noch niemand in dieser Gruppe.</p>
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
				<UInput v-model="form.name" placeholder="z. B. Technikteam" class="w-full" autofocus />
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
			<UFormField label="Mitglieder" name="member_ids">
				<USelectMenu
					v-model="form.member_ids"
					:items="userOptions"
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
		:warning-text="`Die Gruppe „${deleteTarget?.name}“ wird gelöscht. Zugriff, den sie auf Dokumente hatte, endet damit.`"
		:on-delete="confirmDelete"
	/>
</template>
