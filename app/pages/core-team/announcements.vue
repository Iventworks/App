<script setup lang="ts">
/** Kernteam: organisation-wide news. Publishing notifies every activated account. */
import type { GetOrgAnnouncementsResponses } from "~/api-client";
import { zPostOrgAnnouncementsBody } from "~/api-client/zod.gen";

type Announcement = GetOrgAnnouncementsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Neuigkeiten verwalten | Kernteam | CMP" });

const toast = useToast();

const {
	data: announcements,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-org-announcements", async () => {
	const result = await useAPI((api) => api.getOrgAnnouncements({ query: { limit: 100 } }));
	if (!result.success) {
		toast.add({
			title: "Neuigkeiten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Announcement[];
	}
	return result.data;
});

const search = ref("");
const visibleAnnouncements = computed(() => {
	const query = search.value.trim().toLowerCase();
	const all = announcements.value ?? [];
	if (!query) return all;
	return all.filter((announcement) =>
		`${announcement.title} ${announcement.content}`.toLowerCase().includes(query),
	);
});

const schema = zPostOrgAnnouncementsBody;

const formOpen = ref(false);
const editing = ref<Announcement | null>(null);
const saving = ref(false);
const form = reactive({
	title: "",
	content: "",
	priority: "normal" as Announcement["priority"],
	pinned: false,
});

function openCreate() {
	editing.value = null;
	Object.assign(form, { title: "", content: "", priority: "normal", pinned: false });
	formOpen.value = true;
}

function openEdit(announcement: Announcement) {
	editing.value = announcement;
	Object.assign(form, {
		title: announcement.title,
		content: announcement.content,
		priority: announcement.priority,
		pinned: announcement.pinned,
	});
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	const body = {
		title: form.title,
		content: form.content,
		priority: form.priority,
		pinned: form.pinned,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putOrgAnnouncementsByAnnouncementId({ path: { announcementId: target.id }, body }),
			)
		: await useAPI((api) => api.postOrgAnnouncements({ body }));
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: target ? "Neuigkeit gespeichert" : "Neuigkeit veröffentlicht",
		description: target ? undefined : "Alle Mitarbeitenden wurden benachrichtigt.",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await refresh();
}

async function togglePinned(announcement: Announcement) {
	const result = await useAPI((api) =>
		api.putOrgAnnouncementsByAnnouncementId({
			path: { announcementId: announcement.id },
			body: { pinned: !announcement.pinned },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Ändern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	await refresh();
}

const deleteTarget = ref<Announcement | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteOrgAnnouncementsByAnnouncementId({ path: { announcementId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Neuigkeit gelöscht", color: "success" });
	await refresh();
}
</script>

<template>
	<UDashboardPanel id="core-team-announcements">
		<template #header>
			<DashboardPageHeader
				title="Neuigkeiten verwalten"
				icon="i-lucide-megaphone"
				description="Infos an die ganze Organisation"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardFilterBar>
					<template #left>
						<UInput
							v-model="search"
							icon="i-lucide-search"
							placeholder="Neuigkeiten durchsuchen …"
							class="w-full sm:w-64"
						/>
					</template>
					<template #right>
						<UButton label="Neuigkeit verfassen" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</DashboardFilterBar>

				<div v-if="loading && !announcements" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!announcements?.length"
					icon="i-lucide-megaphone"
					title="Noch keine Neuigkeiten"
					description="Neuigkeiten erscheinen auf der Startseite aller Mitarbeitenden und unter „Neuigkeiten“."
				/>

				<UEmpty
					v-else-if="!visibleAnnouncements.length"
					icon="i-lucide-search-x"
					title="Nichts gefunden"
					description="Passe die Suche an."
				/>

				<div v-else class="space-y-4">
					<UCard
						v-for="announcement in visibleAnnouncements"
						:key="announcement.id"
						:class="[
							'bg-slate-900/60',
							announcement.priority === 'important' ? 'border-amber-500/40' : 'border-slate-800',
						]"
					>
						<div class="flex items-start gap-3">
							<div
								:class="[
									'flex size-10 shrink-0 items-center justify-center rounded-lg',
									announcement.priority === 'important' ? 'bg-amber-500/10' : 'bg-primary/10',
								]"
							>
								<UIcon
									:name="announcement.priority === 'important' ? 'i-lucide-triangle-alert' : 'i-lucide-megaphone'"
									:class="['size-5', announcement.priority === 'important' ? 'text-amber-400' : 'text-primary-400']"
								/>
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<h3 class="font-medium text-white">{{ announcement.title }}</h3>
									<UBadge v-if="announcement.pinned" label="Angeheftet" icon="i-lucide-pin" color="primary" variant="subtle" size="sm" />
									<UBadge
										v-if="announcement.priority === 'important'"
										label="Wichtig"
										color="warning"
										variant="subtle"
										size="sm"
									/>
								</div>
								<p class="text-xs text-slate-500">
									{{ announcement.creator?.display_name ?? "Unbekannt" }} · {{ formatDate(announcement.created_at) }}
								</p>
								<div v-if="announcement.content" class="mt-3 text-sm text-slate-300">
									<ContentMarkdownView :content="announcement.content" />
								</div>
							</div>
							<UDropdownMenu
								:ui="{ viewport: 'main-bg-color' }"
								:items="[
									[
										{ label: 'Bearbeiten', icon: 'i-lucide-pencil', onSelect: () => openEdit(announcement) },
										{
											label: announcement.pinned ? 'Lösen' : 'Anheften',
											icon: announcement.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin',
											onSelect: () => togglePinned(announcement),
										},
									],
									[
										{
											label: 'Löschen',
											icon: 'i-lucide-trash-2',
											color: 'error' as const,
											onSelect: () => {
												deleteTarget = announcement;
												deleteOpen = true;
											},
										},
									],
								]"
							>
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</div>
					</UCard>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Neuigkeit bearbeiten' : 'Neuigkeit verfassen'"
		icon="i-lucide-megaphone"
		width="sm:max-w-3xl"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Titel" name="title" required>
				<UInput v-model="form.title" class="w-full" autofocus />
			</UFormField>
			<UFormField label="Inhalt" name="content">
				<FormMarkdownEditor v-model="form.content" placeholder="Was gibt es Neues?" />
			</UFormField>
			<div class="flex flex-wrap items-center gap-6">
				<UFormField label="Priorität" name="priority">
					<USelect v-model="form.priority" :items="ANNOUNCEMENT_PRIORITY_OPTIONS" class="w-40" />
				</UFormField>
				<USwitch v-model="form.pinned" label="Oben anheften" />
			</div>
			<UAlert
				v-if="!editing"
				icon="i-lucide-bell-ring"
				color="neutral"
				variant="subtle"
				description="Beim Veröffentlichen bekommen alle Mitarbeitenden eine Benachrichtigung."
			/>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Veröffentlichen'" :loading="saving" icon="i-lucide-send" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Neuigkeit löschen"
		:warning-text="`„${deleteTarget?.title}“ wird für alle gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
