<script setup lang="ts">
/**
 * Personal dashboard: what is happening today (running camps with today's program), overdue and
 * due tasks across everything, unread messages, upcoming events, org news and today's calendar.
 */
import type { GetDashboardResponses } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Dashboard = GetDashboardResponses["200"]["data"];
type DashboardTask = Dashboard["tasks"]["overdue"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Übersicht", description: "Deine persönliche Übersicht" });

const toast = useToast();
// The notifications card opens them like the sidebar does: slideover or page by screen size.
const { openNotifications } = useDashboard();
const user = await useUserInfoStore().use();

const {
	data: dashboard,
	loading,
	refresh,
} = await useAPIAsyncData("personal-dashboard", async () => {
	const result = await useAPI((api) => api.getDashboard({}));
	if (!result.success) {
		toast.add({
			title: "Übersicht konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data;
});

const firstName = computed(() => user.value?.display_name.split(" ")[0] ?? "");

const greeting = computed(() => {
	const hour = new Date().getHours();
	if (hour < 11) return "Guten Morgen";
	if (hour < 18) return "Hallo";
	return "Guten Abend";
});

const nextEvent = computed(() => dashboard.value?.upcoming_events[0] ?? null);
const hasAnyEvent = computed(
	() =>
		Boolean(dashboard.value?.current_events.length) ||
		Boolean(dashboard.value?.upcoming_events.length),
);

// --- quick task completion ------------------------------------------------------------------

const completing = ref<Set<number>>(new Set());

async function completeTask(task: DashboardTask) {
	completing.value = new Set([...completing.value, task.id]);
	const event = task.event;
	const result = event
		? await useAPI((api) =>
				api.putEventsByEventIdTasksByTaskId({
					path: { eventId: event.id, taskId: task.id },
					body: { status: "done" },
				}),
			)
		: await useAPI((api) =>
				api.putTasksByTaskId({ path: { taskId: task.id }, body: { status: "done" } }),
			);

	const next = new Set(completing.value);
	next.delete(task.id);
	completing.value = next;

	if (!result.success) {
		toast.add({
			title: "Aufgabe konnte nicht abgehakt werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: `„${task.title}“ erledigt`, color: "success", icon: "i-lucide-check" });
	await refresh();
}

function taskLink(task: DashboardTask) {
	return task.event ? `/events/${task.event.id}/tasks` : "/tasks";
}

function isCurrentProgramItem(item: { start_at: number; end_at: number }) {
	const now = Date.now();
	return item.start_at <= now && now < item.end_at;
}

const CONVERSATION_ICONS: Record<Dashboard["recent_conversations"][number]["type"], string> = {
	direct: "i-lucide-user",
	group: "i-lucide-users",
	event: "i-lucide-tent",
	event_group: "i-lucide-users-round",
	core_team: "i-lucide-building-2",
};
</script>

<template>
	<UDashboardPanel id="dashboard">
		<template #header>
			<DashboardPageHeader title="Übersicht" icon="i-lucide-layout-dashboard" />
		</template>

		<template #body>
			<DashboardPageBody>
				<div>
					<h2 class="text-2xl font-semibold text-white">{{ greeting }}, {{ firstName }}!</h2>
					<p class="mt-1 text-sm text-slate-400">
						{{ formatLongDay(dashboard?.today ?? toDayString()) }}
					</p>
				</div>

				<div v-if="loading && !dashboard" class="flex justify-center py-16">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else-if="dashboard">
					<!-- Overdue tasks: shout it out. -->
					<div
						v-if="dashboard.tasks.overdue.length"
						class="overflow-hidden rounded-xl border border-red-900/60 bg-red-950/30"
					>
						<div class="flex flex-wrap items-center justify-between gap-3 border-b border-red-900/50 px-5 py-3">
							<div class="flex items-center gap-3">
								<div class="flex size-10 items-center justify-center rounded-lg bg-red-500/15">
									<UIcon name="i-lucide-alarm-clock" class="size-5 text-red-400" />
								</div>
								<div>
									<h3 class="font-semibold text-red-300">
										{{ dashboard.tasks.overdue.length }}
										{{ dashboard.tasks.overdue.length === 1 ? "Aufgabe ist" : "Aufgaben sind" }} überfällig!
									</h3>
									<p class="text-sm text-red-300/70">Kümmere dich am besten gleich darum.</p>
								</div>
							</div>
							<UButton label="Alle Aufgaben" color="error" variant="subtle" size="sm" to="/tasks" />
						</div>
						<ul class="divide-y divide-red-900/40">
							<li
								v-for="task in dashboard.tasks.overdue"
								:key="task.id"
								class="flex items-center gap-3 px-5 py-2.5"
							>
								<UButton
									icon="i-lucide-circle"
									color="error"
									variant="ghost"
									size="sm"
									:loading="completing.has(task.id)"
									aria-label="Als erledigt markieren"
									@click="completeTask(task)"
								/>
								<NuxtLink :to="taskLink(task)" class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium text-white">{{ task.title }}</p>
									<p class="text-xs text-red-300/80">
										fällig {{ formatRelative(task.due_at) }}
										<template v-if="task.event"> · {{ task.event.name }}</template>
									</p>
								</NuxtLink>
								<UBadge
									v-if="task.priority === 'high' || task.priority === 'urgent'"
									:label="TASK_PRIORITY_LABELS[task.priority]"
									:color="TASK_PRIORITY_COLORS[task.priority]"
									variant="subtle"
									size="sm"
								/>
							</li>
						</ul>
					</div>

					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<DashboardStatCard
							label="Offene Aufgaben"
							:value="dashboard.tasks.open_count"
							icon="i-lucide-list-checks"
							:icon-color="dashboard.tasks.overdue.length ? 'error' : 'primary'"
							:hint="dashboard.tasks.overdue.length ? `${dashboard.tasks.overdue.length} überfällig` : undefined"
							to="/tasks"
						/>
						<DashboardStatCard
							label="Ungelesene Nachrichten"
							:value="dashboard.unread_messages"
							icon="i-lucide-messages-square"
							icon-color="info"
							to="/messages"
						/>
						<DashboardStatCard
							label="Benachrichtigungen"
							:value="dashboard.unread_notifications"
							icon="i-lucide-bell"
							icon-color="amber"
							hint="ungelesen"
							@click="openNotifications"
						/>
						<DashboardStatCard
							label="Nächste Freizeit / Event"
							:value="
								dashboard.current_events.length
									? 'Läuft!'
									: nextEvent
										? nextEvent.days_until === 1
											? 'Morgen'
											: `in ${nextEvent.days_until} Tagen`
										: '–'
							"
							icon="i-lucide-tent"
							icon-color="emerald"
							:hint="dashboard.current_events[0]?.name ?? nextEvent?.name"
							:to="
								dashboard.current_events[0]
									? `/events/${dashboard.current_events[0].id}`
									: nextEvent
										? `/events/${nextEvent.id}`
										: undefined
							"
						/>
					</div>

					<!-- Running camps / events: today's program and news. -->
					<div v-for="event in dashboard.current_events" :key="event.id" class="overflow-hidden rounded-xl border border-primary/40 bg-linear-to-br from-primary/10 via-slate-900/60 to-slate-900/60">
						<div class="flex flex-wrap items-center justify-between gap-3 border-b border-primary/20 px-5 py-4">
							<div class="flex min-w-0 items-center gap-3">
								<div class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/15">
									<UIcon :name="EVENT_TYPE_ICONS[event.type]" class="size-6 text-primary-400" />
								</div>
								<div class="min-w-0">
									<p class="text-xs font-medium uppercase tracking-wide text-primary-300">
										{{
											event.type === "recurring"
												? "Heute ist Termin"
												: `Heute auf ${event.type === "camp" ? "der Freizeit" : "dem Event"}`
										}}
									</p>
									<h3 class="truncate text-lg font-semibold text-white">{{ event.name }}</h3>
									<p v-if="event.type === 'recurring' && event.occurrence" class="text-sm text-slate-400">
										<template v-if="event.occurrence.title">{{ event.occurrence.title }} · </template>
										{{ timeRangeLabel(event.occurrence.start_time, event.occurrence.end_time) || "Ganztägig" }}
										<template v-if="event.occurrence.location"> · {{ event.occurrence.location }}</template>
										· {{ getEventRoleLabel(event.my_role) }}
									</p>
									<p v-else class="text-sm text-slate-400">
										Tag {{ event.day_number }} von {{ event.total_days }}
										<template v-if="event.location"> · {{ event.location }}</template>
										· {{ getEventRoleLabel(event.my_role) }}
									</p>
								</div>
							</div>
							<div v-if="event.type === 'recurring'">
								<UButton
									:to="`/events/${event.id}/occurrences`"
									label="Termine & Dienste"
									icon="i-lucide-calendar-check"
									color="neutral"
									variant="subtle"
									size="sm"
								/>
							</div>
							<div v-else class="w-full sm:w-48">
								<UProgress :model-value="event.day_number" :max="event.total_days" size="sm" />
							</div>
						</div>

						<div class="grid gap-6 p-5 lg:grid-cols-3">
							<div class="lg:col-span-2">
								<h4 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
									<UIcon name="i-lucide-calendar-clock" class="size-4" /> Heutiges Programm
								</h4>
								<p v-if="!event.today_program.length" class="text-sm text-slate-500">
									Für heute ist kein Programm eingetragen.
								</p>
								<ol v-else class="relative space-y-2 border-l border-slate-800 pl-4">
									<li
										v-for="item in event.today_program"
										:key="item.id"
										:class="[
											'relative rounded-lg px-3 py-2',
											item.is_mine ? 'bg-primary/10 ring-1 ring-primary/40' : 'bg-slate-900/60',
											item.end_at < Date.now() ? 'opacity-50' : '',
										]"
									>
										<span
											class="absolute top-3.5 -left-[21px] size-2.5 rounded-full ring-4 ring-slate-950"
											:style="{ backgroundColor: item.color ?? 'var(--ui-primary)' }"
										/>
										<div class="flex flex-wrap items-baseline justify-between gap-x-3">
											<p class="font-medium text-white">
												{{ item.title }}
												<UBadge
													v-if="isCurrentProgramItem(item)"
													label="Jetzt"
													color="success"
													variant="subtle"
													size="sm"
													class="ml-1"
												/>
												<UBadge
													v-if="item.is_mine"
													label="Du bist dran"
													color="primary"
													variant="subtle"
													size="sm"
													class="ml-1"
												/>
											</p>
											<span class="text-xs text-slate-400">{{ formatTimeRange(item.start_at, item.end_at) }}</span>
										</div>
										<p v-if="item.location" class="text-xs text-slate-500">
											<UIcon name="i-lucide-map-pin" class="size-3" /> {{ item.location }}
										</p>
									</li>
								</ol>
							</div>

							<div class="space-y-4">
								<div>
									<h4 class="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
										<UIcon name="i-lucide-megaphone" class="size-4" /> Neuigkeiten
									</h4>
									<p v-if="!event.latest_announcements.length" class="text-sm text-slate-500">
										Keine Neuigkeiten.
									</p>
									<ul v-else class="space-y-2">
										<li v-for="announcement in event.latest_announcements" :key="announcement.id">
											<NuxtLink
												:to="`/events/${event.id}`"
												class="flex items-start gap-2 text-sm hover:text-white"
											>
												<UIcon
													:name="announcement.priority === 'important' ? 'i-lucide-alert-triangle' : 'i-lucide-info'"
													:class="[
														'mt-0.5 size-4 shrink-0',
														announcement.priority === 'important' ? 'text-amber-400' : 'text-slate-500',
													]"
												/>
												<span class="min-w-0">
													<span class="block truncate text-slate-200">{{ announcement.title }}</span>
													<span class="text-xs text-slate-500">{{ formatRelative(announcement.created_at) }}</span>
												</span>
											</NuxtLink>
										</li>
									</ul>
								</div>

								<div class="grid grid-cols-2 gap-2">
									<UButton label="Programm" icon="i-lucide-calendar-range" color="neutral" variant="subtle" size="sm" block :to="`/events/${event.id}/program`" />
									<UButton label="Teilnehmende" icon="i-lucide-users" color="neutral" variant="subtle" size="sm" block :to="`/events/${event.id}/participants`" />
									<UButton label="Notizen" icon="i-lucide-sticky-note" color="neutral" variant="subtle" size="sm" block :to="`/events/${event.id}/notes`" />
									<UButton label="Nachrichten" icon="i-lucide-messages-square" color="neutral" variant="subtle" size="sm" block :to="`/messages?event=${event.id}`" />
								</div>
							</div>
						</div>
					</div>

					<div class="grid gap-6 lg:grid-cols-3">
						<div class="space-y-6 lg:col-span-2">
							<DashboardSectionCard
								title="Bald fällig"
								description="Deine Aufgaben der nächsten 7 Tage"
								icon="i-lucide-list-checks"
								flush
							>
								<template #actions>
									<UButton label="Neue Aufgabe" icon="i-lucide-plus" color="neutral" variant="subtle" size="sm" to="/tasks?new=1" />
									<UButton label="Alle" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right" to="/tasks" />
								</template>

								<p v-if="!dashboard.tasks.due_soon.length" class="px-6 py-5 text-sm text-slate-500">
									Nichts fällig in den nächsten Tagen. 🎉
								</p>
								<ul v-else class="divide-y divide-slate-800">
									<li
										v-for="task in dashboard.tasks.due_soon"
										:key="task.id"
										class="flex items-center gap-3 px-4 py-2.5"
									>
										<UButton
											:icon="TASK_STATUS_ICONS[task.status]"
											color="neutral"
											variant="ghost"
											size="sm"
											:loading="completing.has(task.id)"
											aria-label="Als erledigt markieren"
											@click="completeTask(task)"
										/>
										<NuxtLink :to="taskLink(task)" class="min-w-0 flex-1">
											<p class="truncate text-sm text-white">{{ task.title }}</p>
											<p class="text-xs text-slate-500">fällig {{ formatRelative(task.due_at) }}</p>
										</NuxtLink>
										<UBadge v-if="task.event" :label="task.event.name" color="neutral" variant="outline" size="sm" class="hidden max-w-40 truncate sm:inline-flex" />
										<UBadge
											v-if="task.priority === 'high' || task.priority === 'urgent'"
											:label="TASK_PRIORITY_LABELS[task.priority]"
											:color="TASK_PRIORITY_COLORS[task.priority]"
											variant="subtle"
											size="sm"
										/>
									</li>
								</ul>
							</DashboardSectionCard>

							<DashboardSectionCard
								title="Deine nächsten Programmpunkte"
								description="Hier bist du eingeteilt"
								icon="i-lucide-calendar-clock"
								flush
							>
								<p v-if="!dashboard.my_next_program_items.length" class="px-6 py-5 text-sm text-slate-500">
									Du bist gerade für keinen Programmpunkt eingeteilt.
								</p>
								<ul v-else class="divide-y divide-slate-800">
									<li v-for="item in dashboard.my_next_program_items" :key="item.id">
										<NuxtLink
											:to="`/events/${item.event.id}/program`"
											class="flex items-center gap-3 px-5 py-3 hover:bg-slate-800/40"
										>
											<span class="h-9 w-1 shrink-0 rounded-full" :style="{ backgroundColor: item.color ?? 'var(--ui-primary)' }" />
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium text-white">{{ item.title }}</p>
												<p class="truncate text-xs text-slate-500">
													{{ formatShortDay(item.start_at) }}, {{ formatTimeRange(item.start_at, item.end_at) }}
													<template v-if="item.location"> · {{ item.location }}</template>
												</p>
											</div>
											<UBadge :label="item.event.name" color="neutral" variant="outline" size="sm" class="hidden max-w-40 truncate sm:inline-flex" />
										</NuxtLink>
									</li>
								</ul>
							</DashboardSectionCard>

							<DashboardSectionCard
								title="Neuigkeiten aus der Organisation"
								icon="i-lucide-megaphone"
							>
								<template #actions>
									<UButton label="Alle" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right" to="/news" />
								</template>

								<p v-if="!dashboard.org_announcements.length" class="text-sm text-slate-500">
									Aktuell gibt es keine Neuigkeiten.
								</p>
								<div v-else class="space-y-5">
									<article
										v-for="announcement in dashboard.org_announcements"
										:key="announcement.id"
										:class="[
											'rounded-lg p-4',
											announcement.priority === 'important'
												? 'border border-amber-700/50 bg-amber-950/20'
												: 'bg-slate-950/40',
										]"
									>
										<div class="mb-2 flex flex-wrap items-center gap-2">
											<UIcon v-if="announcement.pinned" name="i-lucide-pin" class="size-4 text-primary-400" />
											<h4 class="font-medium text-white">{{ announcement.title }}</h4>
											<UBadge
												v-if="announcement.priority === 'important'"
												label="Wichtig"
												color="warning"
												variant="subtle"
												size="sm"
											/>
										</div>
										<div class="line-clamp-4 text-sm text-slate-300">
											<ContentMarkdownView :content="announcement.content" />
										</div>
										<p class="mt-2 text-xs text-slate-500">
											{{ announcement.created_by?.display_name ?? "Kernteam" }} · {{ formatRelative(announcement.created_at) }}
										</p>
									</article>
								</div>
							</DashboardSectionCard>
						</div>

						<div class="space-y-6">
							<DashboardSectionCard title="Nachrichten" icon="i-lucide-messages-square" flush>
								<template #actions>
									<UButton label="Öffnen" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right" to="/messages" />
								</template>
								<p v-if="!dashboard.recent_conversations.length" class="px-6 py-5 text-sm text-slate-500">
									Noch keine Unterhaltungen.
								</p>
								<ul v-else class="divide-y divide-slate-800">
									<li v-for="conversation in dashboard.recent_conversations" :key="conversation.id">
										<NuxtLink
											:to="`/messages/${conversation.id}`"
											class="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/40"
										>
											<UChip :show="conversation.unread_count > 0" color="primary" inset>
												<div class="flex size-9 items-center justify-center rounded-full bg-slate-800">
													<UIcon :name="CONVERSATION_ICONS[conversation.type]" class="size-4 text-slate-300" />
												</div>
											</UChip>
											<div class="min-w-0 flex-1">
												<p class="flex items-center justify-between gap-2">
													<span :class="['truncate text-sm', conversation.unread_count ? 'font-semibold text-white' : 'text-slate-200']">
														{{ conversation.title }}
													</span>
													<span class="shrink-0 text-xs text-slate-500">{{ formatRelative(conversation.last_message_at) }}</span>
												</p>
												<p class="truncate text-xs text-slate-500">
													{{ conversation.last_message_preview ?? "Noch keine Nachrichten" }}
												</p>
											</div>
											<UBadge
												v-if="conversation.unread_count"
												:label="String(conversation.unread_count)"
												color="primary"
												size="sm"
											/>
										</NuxtLink>
									</li>
								</ul>
							</DashboardSectionCard>

							<DashboardSectionCard title="Heute im Kalender" icon="i-lucide-calendar" flush>
								<template #actions>
									<UButton label="Kalender" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right" to="/calendar" />
								</template>
								<p v-if="!dashboard.calendar_today.length" class="px-6 py-5 text-sm text-slate-500">
									Keine persönlichen Termine heute.
								</p>
								<ul v-else class="divide-y divide-slate-800">
									<li v-for="entry in dashboard.calendar_today" :key="entry.id" class="flex items-center gap-3 px-5 py-3">
										<span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: entry.color ?? 'var(--ui-primary)' }" />
										<div class="min-w-0">
											<p class="truncate text-sm text-white">{{ entry.title }}</p>
											<p class="text-xs text-slate-500">
												{{ entry.all_day ? "Ganztägig" : formatTimeRange(entry.start_at, entry.end_at) }}
												<template v-if="entry.location"> · {{ entry.location }}</template>
											</p>
										</div>
									</li>
								</ul>
							</DashboardSectionCard>

							<DashboardSectionCard title="Bevorstehende Events" icon="i-lucide-tent" flush>
								<template #actions>
									<UButton label="Alle" color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-right" to="/events" />
								</template>
								<div v-if="!hasAnyEvent" class="px-6 py-5">
									<UEmpty
										icon="i-lucide-tent"
										title="Noch keine Events"
										description="Sobald du einer Freizeit oder einem Event zugeteilt bist, erscheint es hier."
										variant="naked"
										size="sm"
									/>
								</div>
								<p v-else-if="!dashboard.upcoming_events.length" class="px-6 py-5 text-sm text-slate-500">
									Keine weiteren Events geplant.
								</p>
								<ul v-else class="divide-y divide-slate-800">
									<li v-for="event in dashboard.upcoming_events" :key="event.id">
										<NuxtLink :to="`/events/${event.id}`" class="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/40">
											<div
												class="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-800 leading-none"
											>
												<span class="text-sm font-bold text-white">{{ event.days_until }}</span>
												<span class="text-[10px] text-slate-400">{{ event.days_until === 1 ? "Tag" : "Tage" }}</span>
											</div>
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium text-white">{{ event.name }}</p>
												<p class="truncate text-xs text-slate-500">
													<template v-if="event.type === 'recurring' && event.occurrence">
														Nächster Termin {{ occurrenceLabel(event.occurrence) }}
														<template v-if="event.occurrence.location"> · {{ event.occurrence.location }}</template>
													</template>
													<template v-else>
														{{ formatDayRange(event.start_date, event.end_date) }}
														<template v-if="event.location"> · {{ event.location }}</template>
													</template>
												</p>
											</div>
											<UBadge
												:label="getEventRoleLabel(event.my_role)"
												:color="getEventRoleColor(event.my_role)"
												variant="subtle"
												size="sm"
											/>
										</NuxtLink>
									</li>
								</ul>
							</DashboardSectionCard>
						</div>
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
