<script setup lang="ts">
/**
 * Event overview: the event at a glance (dates, status, leaders, description), key numbers,
 * today's and upcoming program, news for the team (managed by leaders), and everything that
 * concerns the caller personally (tasks, responsibilities, room, groups).
 */
import type { NavigationMenuItem } from "@nuxt/ui";
import type {
	GetEventsByEventIdAnnouncementsResponses,
	GetEventsByEventIdOverviewResponses,
} from "~/api-client";
import { zPostEventsByEventIdAnnouncementsBody } from "~/api-client/zod.gen";
import type { EventPermission } from "~/utils/types";

type Overview = GetEventsByEventIdOverviewResponses["200"]["data"];
type Announcement = GetEventsByEventIdAnnouncementsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `${event.value.name}` });

const base = computed(() => `/events/${eventId.value}`);

// --- data ---------------------------------------------------------------------------------

const {
	data: overview,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-overview`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdOverview({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Übersicht konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null as Overview | null;
	}
	return result.data;
});

const { data: announcements, refresh: refreshAnnouncements } = await useAPIAsyncData(
	`event-${eventId.value}-announcements`,
	async () => {
		const result = await useAPI((api) =>
			api.getEventsByEventIdAnnouncements({ path: { eventId: eventId.value } }),
		);
		return result.success ? result.data : ([] as Announcement[]);
	},
);

const showAllAnnouncements = ref(false);
const visibleAnnouncements = computed(() =>
	showAllAnnouncements.value ? (announcements.value ?? []) : (announcements.value ?? []).slice(0, 3),
);

// --- timing -------------------------------------------------------------------------------

function daysBetween(from: string, to: string) {
	return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

const timing = computed(() => {
	const today = overview.value?.today ?? toDayString();
	const { start_date, end_date } = event.value;
	const totalDays = daysBetween(start_date, end_date) + 1;
	if (start_date <= today && today <= end_date) {
		return {
			label: `Tag ${daysBetween(start_date, today) + 1} von ${totalDays}`,
			color: "success" as const,
		};
	}
	if (start_date > today) {
		const days = daysBetween(today, start_date);
		return {
			label: days === 1 ? "Beginnt morgen" : `Beginnt in ${days} Tagen`,
			color: "info" as const,
		};
	}
	return { label: "Vorbei", color: "neutral" as const };
});

// --- quick links --------------------------------------------------------------------------

const quickLinks = computed(() => {
	const links: (NavigationMenuItem & { permission: EventPermission })[] = [
		{
			label: "Programm",
			icon: "i-lucide-calendar-range",
			to: `${base.value}/program`,
			permission: "program:view",
		},
		{
			label: "Teilnehmende",
			icon: "i-lucide-users",
			to: `${base.value}/participants`,
			permission: "participants:view",
		},
		{
			label: "Zimmer",
			icon: "i-lucide-bed-double",
			to: `${base.value}/rooms`,
			permission: "rooms:view",
		},
		{
			label: "Team",
			icon: "i-lucide-contact",
			to: `${base.value}/staff`,
			permission: "members:view",
		},
		{
			label: "Gruppen",
			icon: "i-lucide-users-round",
			to: `${base.value}/groups`,
			permission: "groups:view",
		},
		{
			label: "Zuständigkeiten",
			icon: "i-lucide-badge-check",
			to: `${base.value}/responsibilities`,
			permission: "responsibilities:view",
		},
		{
			label: "Aufgaben",
			icon: "i-lucide-list-todo",
			to: `${base.value}/tasks`,
			permission: "tasks:view",
		},
		{
			label: "Notizen",
			icon: "i-lucide-sticky-note",
			to: `${base.value}/notes`,
			permission: "notes:view",
		},
		{
			label: "Dokumente",
			icon: "i-lucide-folder",
			to: `${base.value}/documents`,
			permission: "files:view",
		},
		{
			label: "Finanzen",
			icon: "i-lucide-receipt-euro",
			to: `${base.value}/finances`,
			permission: "expenses:submit",
		},
		{
			label: "Statistiken",
			icon: "i-lucide-chart-column",
			to: `${base.value}/stats`,
			permission: "stats:view",
		},
		{
			label: "Einstellungen",
			icon: "i-lucide-settings-2",
			to: `${base.value}/settings`,
			permission: "event:edit",
		},
	];
	return links.filter((link) => can(link.permission));
});

// --- announcements ------------------------------------------------------------------------

const announcementSchema = zPostEventsByEventIdAnnouncementsBody;

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

async function submitAnnouncement() {
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
				api.putEventsByEventIdAnnouncementsByAnnouncementId({
					path: { eventId: eventId.value, announcementId: target.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdAnnouncements({ path: { eventId: eventId.value }, body }),
			);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	toast.add({
		title: target ? "Neuigkeit gespeichert" : "Neuigkeit veröffentlicht",
		description: target ? undefined : "Das Team wurde benachrichtigt.",
		color: "success",
		icon: "i-lucide-megaphone",
	});
	formOpen.value = false;
	await Promise.all([refreshAnnouncements(), refresh()]);
}

const deleteTarget = ref<Announcement | null>(null);
const deleteOpen = ref(false);

function openDelete(announcement: Announcement) {
	deleteTarget.value = announcement;
	deleteOpen.value = true;
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdAnnouncementsByAnnouncementId({
			path: { eventId: eventId.value, announcementId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Neuigkeit gelöscht", color: "success" });
	await refreshAnnouncements();
}

function announcementActions(announcement: Announcement) {
	return [
		[{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(announcement) }],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => openDelete(announcement),
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="event-overview">
		<template #header>
			<DashboardPageHeader :title="event.name" :icon="EVENT_TYPE_ICONS[event.type]">
				<template #right>
					<UButton
						:to="`/messages?event=${eventId}`"
						icon="i-lucide-messages-square"
						label="Team-Chat"
						color="neutral"
						variant="subtle"
						:ui="{ label: 'hidden sm:inline' }"
					/>
					<UButton
						v-if="can('event:edit')"
						:to="`${base}/settings`"
						icon="i-lucide-settings-2"
						color="neutral"
						variant="ghost"
						aria-label="Event-Einstellungen"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<!-- Event header -->
				<div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
					<div class="h-1.5" :style="{ backgroundColor: event.color ?? 'var(--ui-primary)' }" />
					<div class="space-y-4 p-5 sm:p-6">
						<div class="flex flex-wrap items-start justify-between gap-4">
							<div class="space-y-2">
								<div class="flex flex-wrap items-center gap-2">
									<UBadge :label="EVENT_TYPE_LABELS[event.type]" color="neutral" variant="outline" size="sm" />
									<UBadge
										:label="EVENT_STATUS_LABELS[event.status]"
										:color="EVENT_STATUS_COLORS[event.status]"
										variant="subtle"
										size="sm"
									/>
									<UBadge :label="timing.label" :color="timing.color" variant="soft" size="sm" />
									<UBadge
										v-if="event.is_member"
										:label="`Deine Rolle: ${getEventRoleLabel(event.my_role)}`"
										:color="getEventRoleColor(event.my_role)"
										variant="subtle"
										size="sm"
									/>
									<UBadge v-else label="Kernteam-Zugriff" color="neutral" variant="subtle" size="sm" />
								</div>
								<h1 class="text-2xl font-bold text-white">{{ event.name }}</h1>
								<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
									<span class="flex items-center gap-1.5">
										<UIcon name="i-lucide-calendar" class="size-4" />
										{{ formatDayRange(event.start_date, event.end_date) }}
									</span>
									<span v-if="event.location" class="flex items-center gap-1.5">
										<UIcon name="i-lucide-map-pin" class="size-4" /> {{ event.location }}
									</span>
								</div>
							</div>

							<div v-if="event.leaders.length" class="space-y-1.5">
								<p class="text-xs font-medium uppercase tracking-wide text-slate-500">Leitung</p>
								<div class="flex flex-wrap gap-2">
									<UUser
										v-for="leader in event.leaders"
										:key="leader.id"
										:name="leader.display_name"
										:description="leader.phone ?? leader.email"
										:avatar="{ text: initials(leader.display_name) }"
										size="sm"
									/>
								</div>
							</div>
						</div>

						<ContentMarkdownView v-if="event.description" :content="event.description" />
					</div>
				</div>

				<div v-if="loading && !overview" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else-if="overview">
					<!-- Key numbers -->
					<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
						<DashboardStatCard
							label="Teilnehmende"
							:value="event.max_participants ? `${overview.counts.participants} / ${event.max_participants}` : overview.counts.participants"
							icon="i-lucide-users"
							:to="can('participants:view') ? `${base}/participants` : undefined"
						/>
						<DashboardStatCard
							label="Team"
							:value="overview.counts.staff"
							icon="i-lucide-contact"
							icon-color="info"
							:to="can('members:view') ? `${base}/staff` : undefined"
						/>
						<DashboardStatCard
							label="Offene Aufgaben"
							:value="overview.counts.open_tasks"
							icon="i-lucide-list-todo"
							icon-color="amber"
							:to="`${base}/tasks`"
						/>
						<DashboardStatCard
							v-if="overview.counts.pending_expenses !== null"
							label="Offene Ausgaben"
							:value="overview.counts.pending_expenses"
							icon="i-lucide-receipt-euro"
							:icon-color="overview.counts.pending_expenses > 0 ? 'error' : 'emerald'"
							hint="warten auf Prüfung"
							:to="`${base}/finances/all`"
						/>
						<DashboardStatCard
							v-else
							label="Meine Aufgaben"
							:value="overview.my_tasks.length"
							icon="i-lucide-user-check"
							icon-color="emerald"
							:to="`${base}/tasks`"
						/>
					</div>

					<div class="grid gap-6 xl:grid-cols-3">
						<div class="space-y-6 xl:col-span-2">
							<!-- Program -->
							<DashboardSectionCard
								:title="overview.is_running ? 'Heute' : 'Programm'"
								:description="overview.is_running ? formatLongDay(overview.today) : 'Die nächsten Programmpunkte'"
								icon="i-lucide-calendar-clock"
							>
								<template #actions>
									<UButton
										:to="`${base}/program`"
										label="Ganzes Programm"
										trailing-icon="i-lucide-arrow-right"
										color="neutral"
										variant="ghost"
										size="sm"
									/>
								</template>

								<div class="space-y-5">
									<div v-if="overview.is_running">
										<div v-if="overview.today_program.length" class="space-y-1">
											<EventProgramTimelineItem
												v-for="item in overview.today_program"
												:key="item.id"
												:item="item"
											/>
										</div>
										<p v-else class="text-sm text-slate-400">Für heute ist kein Programm eingetragen.</p>
									</div>

									<div v-if="overview.next_program.length" class="space-y-1">
										<p
											v-if="overview.is_running"
											class="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
										>
											Als Nächstes
										</p>
										<EventProgramTimelineItem
											v-for="item in overview.next_program"
											:key="item.id"
											:item="item"
											show-day
										/>
									</div>
									<p v-else-if="!overview.is_running" class="text-sm text-slate-400">
										Es sind noch keine kommenden Programmpunkte eingetragen.
									</p>
								</div>
							</DashboardSectionCard>

							<!-- Announcements -->
							<DashboardSectionCard
								title="Neuigkeiten"
								description="Wichtige Infos für das ganze Team"
								icon="i-lucide-megaphone"
							>
								<template v-if="can('announcements:manage')" #actions>
									<UButton label="Neuigkeit" icon="i-lucide-plus" size="sm" @click="openCreate" />
								</template>

								<p v-if="!announcements?.length" class="text-sm text-slate-400">
									Noch keine Neuigkeiten.
								</p>

								<div v-else class="space-y-4">
									<article
										v-for="announcement in visibleAnnouncements"
										:key="announcement.id"
										:class="[
											'rounded-lg border p-4',
											announcement.priority === 'important'
												? 'border-amber-500/40 bg-amber-500/5'
												: 'border-slate-800 bg-slate-950/30',
										]"
									>
										<div class="mb-2 flex items-start justify-between gap-3">
											<div class="min-w-0 space-y-1">
												<div class="flex flex-wrap items-center gap-2">
													<UIcon v-if="announcement.pinned" name="i-lucide-pin" class="size-4 text-primary-400" />
													<h3 class="font-medium text-white">{{ announcement.title }}</h3>
													<UBadge
														v-if="announcement.priority === 'important'"
														label="Wichtig"
														color="warning"
														variant="subtle"
														size="sm"
													/>
												</div>
												<p class="text-xs text-slate-500">
													{{ announcement.creator?.display_name ?? "Unbekannt" }} ·
													{{ formatRelative(announcement.created_at) }}
												</p>
											</div>
											<UDropdownMenu
												v-if="can('announcements:manage')"
												:items="announcementActions(announcement)"
												:ui="{ viewport: 'main-bg-color' }"
											>
												<UButton
													icon="i-lucide-ellipsis-vertical"
													color="neutral"
													variant="ghost"
													size="xs"
													aria-label="Aktionen"
												/>
											</UDropdownMenu>
										</div>
										<ContentMarkdownView v-if="announcement.content" :content="announcement.content" />
									</article>

									<UButton
										v-if="(announcements?.length ?? 0) > 3"
										:label="showAllAnnouncements ? 'Weniger anzeigen' : `Alle ${announcements?.length} anzeigen`"
										color="neutral"
										variant="ghost"
										size="sm"
										block
										@click="showAllAnnouncements = !showAllAnnouncements"
									/>
								</div>
							</DashboardSectionCard>
						</div>

						<!-- Personal column -->
						<div class="space-y-6">
							<DashboardSectionCard title="Für dich" icon="i-lucide-user-check">
								<div class="space-y-5 text-sm">
									<div class="space-y-2">
										<div class="flex items-center justify-between">
											<p class="font-medium text-slate-300">Meine Aufgaben</p>
											<NuxtLink :to="`${base}/tasks`" class="text-xs text-primary-400 hover:underline">Alle</NuxtLink>
										</div>
										<ul v-if="overview.my_tasks.length" class="space-y-1.5">
											<li v-for="task in overview.my_tasks" :key="task.id" class="flex items-start gap-2">
												<UIcon :name="TASK_STATUS_ICONS[task.status]" class="mt-0.5 size-4 shrink-0 text-slate-400" />
												<div class="min-w-0">
													<p class="truncate text-white">{{ task.title }}</p>
													<p
														v-if="task.due_at"
														:class="['text-xs', task.due_at < Date.now() ? 'text-red-400' : 'text-slate-500']"
													>
														fällig {{ formatDate(task.due_at) }}
													</p>
												</div>
												<UBadge
													v-if="task.priority === 'high' || task.priority === 'urgent'"
													:label="TASK_PRIORITY_LABELS[task.priority]"
													:color="TASK_PRIORITY_COLORS[task.priority]"
													variant="subtle"
													size="sm"
													class="ml-auto shrink-0"
												/>
											</li>
										</ul>
										<p v-else class="text-slate-500">Keine offenen Aufgaben für dich.</p>
									</div>

									<div class="space-y-2">
										<p class="font-medium text-slate-300">Meine Zuständigkeiten</p>
										<ul v-if="overview.my_responsibilities.length" class="space-y-1">
											<li
												v-for="responsibility in overview.my_responsibilities"
												:key="responsibility.id"
												class="flex items-center gap-2"
											>
												<UIcon name="i-lucide-badge-check" class="size-4 shrink-0 text-emerald-400" />
												<span class="text-white">{{ responsibility.title }}</span>
												<span v-if="responsibility.location" class="text-xs text-slate-500">
													· {{ responsibility.location }}
												</span>
											</li>
										</ul>
										<p v-else class="text-slate-500">Dir sind keine festen Zuständigkeiten zugeteilt.</p>
									</div>

									<div class="space-y-2">
										<p class="font-medium text-slate-300">Mein Zimmer</p>
										<p v-if="overview.my_room" class="flex items-center gap-2 text-white">
											<UIcon name="i-lucide-bed-double" class="size-4 text-slate-400" />
											{{ overview.my_room.name }}
										</p>
										<p v-else class="text-slate-500">Noch kein Zimmer zugeteilt.</p>
									</div>

									<div class="space-y-2">
										<p class="font-medium text-slate-300">Meine Gruppen</p>
										<ul v-if="overview.my_groups.length" class="space-y-1.5">
											<li v-for="group in overview.my_groups" :key="group.id" class="flex items-center gap-2">
												<span
													class="size-2.5 shrink-0 rounded-full bg-slate-500"
													:style="group.color ? { backgroundColor: group.color } : undefined"
												/>
												<span class="min-w-0 flex-1 truncate text-white">{{ group.name }}</span>
												<UButton
													:to="`/messages?group=${group.id}`"
													icon="i-lucide-message-circle"
													color="neutral"
													variant="ghost"
													size="xs"
													:aria-label="`Chat ${group.name}`"
												/>
												<UButton
													:to="`${base}/notes?group=${group.id}`"
													icon="i-lucide-sticky-note"
													color="neutral"
													variant="ghost"
													size="xs"
													:aria-label="`Notizen ${group.name}`"
												/>
											</li>
										</ul>
										<p v-else class="text-slate-500">Du bist in keiner Gruppe.</p>
									</div>
								</div>
							</DashboardSectionCard>

							<DashboardSectionCard title="Schnellzugriff" icon="i-lucide-compass">
								<div class="grid grid-cols-2 gap-2">
									<UButton
										v-for="link in quickLinks"
										:key="String(link.to)"
										:to="link.to"
										:icon="link.icon"
										:label="link.label"
										color="neutral"
										variant="subtle"
										class="justify-start"
									/>
								</div>
							</DashboardSectionCard>
						</div>
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Neuigkeit bearbeiten' : 'Neuigkeit veröffentlichen'"
		icon="i-lucide-megaphone"
		width="sm:max-w-2xl"
	>
		<UForm :schema="announcementSchema" :state="form" class="space-y-4" @submit="submitAnnouncement">
			<UFormField label="Titel" name="title" required>
				<UInput v-model="form.title" class="w-full" autofocus />
			</UFormField>
			<UFormField label="Inhalt" name="content">
				<FormMarkdownEditor v-model="form.content" placeholder="Was soll das Team wissen?" />
			</UFormField>
			<div class="flex flex-wrap items-center gap-6">
				<UFormField label="Priorität" name="priority">
					<USelect v-model="form.priority" :items="ANNOUNCEMENT_PRIORITY_OPTIONS" class="w-40" />
				</UFormField>
				<USwitch v-model="form.pinned" label="Oben anheften" />
			</div>
			<p v-if="!editing" class="text-xs text-slate-500">
				Alle Mitarbeitenden dieses Events bekommen eine Benachrichtigung.
			</p>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Veröffentlichen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Neuigkeit löschen"
		:warning-text="`„${deleteTarget?.title}“ wird für alle entfernt.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
