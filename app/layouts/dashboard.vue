<script setup lang="ts">
/**
 * The portal shell: one `UDashboardSidebar` whose content switches with the route (Delivr
 * pattern) — the main sidebar (personal space + selected event + organisation), and separate
 * sidebars for /settings, /admin and /core-team with a "Zurück zum Portal" link. The user menu
 * sits in the footer of every variant. On the multi-org base domain (system host) the shell is the
 * system admin dashboard: organisations, system admins, their invitations and audit log.
 */
import type { NavigationMenuItem } from "@nuxt/ui";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { EventPermission } from "~/utils/types";

const route = useRoute();
const instance = useInstance();
const isSystem = computed(() => instance.value?.kind === "system");
const homeRoute = computed(() => (isSystem.value ? "/admin" : "/"));

const user = await useUserInfoStore().use();
// The system host has no events, messages or notifications.
const myEvents = isSystem.value ? ref([]) : await useMyEventsStore().use();

const role = computed(() => user.value?.role);
const isCoreTeam = computed(() => hasOrgRole(role.value, "core_team"));
const isAdmin = computed(() => hasOrgRole(role.value, "admin"));

const {
	isNotificationsSlideoverOpen,
	unreadMessages,
	unreadNotifications,
	startBadgePolling,
	stopBadgePolling,
} = useDashboard();

onMounted(() => {
	if (!isSystem.value) startBadgePolling();
});
onBeforeUnmount(stopBadgePolling);

// --- selected event -------------------------------------------------------------------------

const selectedEventId = useSelectedEventId();
const selectedEvent = useEventDetailsRef(selectedEventId);

// Fall back to the first running/upcoming event when nothing was picked yet.
if (!isSystem.value && !selectedEventId.value && myEvents.value?.length) {
	const today = toDayString();
	const fallback =
		myEvents.value.find((e) => e.start_date <= today && today <= e.end_date) ??
		myEvents.value.find((e) => e.start_date >= today) ??
		myEvents.value[0];
	if (fallback) selectedEventId.value = fallback.id;
}

watch(
	selectedEventId,
	async (id) => {
		if (!id || isSystem.value) return;
		const { event } = await loadEventDetails(id);
		// A stale cookie (removed from the event, event deleted): forget it.
		if (!event && !route.params.event_id) selectedEventId.value = null;
	},
	{ immediate: true },
);

const can = (permission: EventPermission) => canInEvent(selectedEvent.value, permission);

// --- sidebar variants -----------------------------------------------------------------------

const section = computed<"main" | "settings" | "admin" | "coreTeam" | "system">(() => {
	if (route.path.startsWith("/settings")) return "settings";
	if (isSystem.value) return "system";
	if (route.path.startsWith("/admin")) return "admin";
	if (route.path.startsWith("/core-team")) return "coreTeam";
	return "main";
});

const personalItems = computed<NavigationMenuItem[]>(() => [
	{ label: "Übersicht", icon: "i-lucide-layout-dashboard", to: "/", exact: true },
	{ label: "Meine Aufgaben", icon: "i-lucide-list-checks", to: "/tasks" },
	{
		label: "Nachrichten",
		icon: "i-lucide-messages-square",
		to: "/messages",
		badge: unreadMessages.value > 0 ? String(unreadMessages.value) : undefined,
	},
	{ label: "Kalender", icon: "i-lucide-calendar", to: "/calendar" },
	{ label: "Notizen", icon: "i-lucide-notebook-pen", to: "/notes" },
	{
		label: "Benachrichtigungen",
		icon: "i-lucide-bell",
		badge: unreadNotifications.value > 0 ? String(unreadNotifications.value) : undefined,
		onSelect: () => {
			isNotificationsSlideoverOpen.value = true;
		},
	},
]);

const eventItems = computed<NavigationMenuItem[]>(() => {
	const event = selectedEvent.value;
	if (!event) return [];
	const base = `/events/${event.id}`;
	const items: NavigationMenuItem[] = [
		{ label: "Übersicht", icon: "i-lucide-house", to: base, exact: true },
		{ label: "Programm", icon: "i-lucide-calendar-range", to: `${base}/program` },
		{ label: "Teilnehmende", icon: "i-lucide-users", to: `${base}/participants` },
		{ label: "Zimmer", icon: "i-lucide-bed-double", to: `${base}/rooms` },
		{ label: "Team", icon: "i-lucide-contact", to: `${base}/staff` },
		{ label: "Gruppen", icon: "i-lucide-users-round", to: `${base}/groups` },
		{ label: "Zuständigkeiten", icon: "i-lucide-badge-check", to: `${base}/responsibilities` },
		{ label: "Aufgaben", icon: "i-lucide-list-todo", to: `${base}/tasks` },
		{ label: "Notizen", icon: "i-lucide-sticky-note", to: `${base}/notes` },
		{ label: "Dokumente", icon: "i-lucide-folder", to: `${base}/documents` },
		{ label: "Finanzen", icon: "i-lucide-receipt-euro", to: `${base}/finances` },
	];

	const leaderItems: NavigationMenuItem[] = [
		...(can("event:edit")
			? [{ label: "Einstellungen", icon: "i-lucide-settings-2", to: `${base}/settings` }]
			: []),
		...(can("stats:view")
			? [{ label: "Statistiken", icon: "i-lucide-chart-column", to: `${base}/stats` }]
			: []),
		...(can("audit_log:view")
			? [{ label: "Audit-Log", icon: "i-lucide-scroll-text", to: `${base}/audit-log` }]
			: []),
	];

	if (leaderItems.length) {
		items.push({
			label: "Leitung",
			icon: "i-lucide-crown",
			type: "trigger",
			defaultOpen: leaderItems.some((item) => route.path === item.to),
			children: leaderItems,
		});
	}

	return items;
});

const organisationItems = computed<NavigationMenuItem[]>(() => [
	{ label: "Organisation", type: "label" },
	{ label: "Neuigkeiten", icon: "i-lucide-megaphone", to: "/news" },
	{ label: "Dokumente & Leitfäden", icon: "i-lucide-library", to: "/documents" },
	...(isCoreTeam.value
		? [{ label: "Kernteam-Bereich", icon: "i-lucide-building-2", to: "/core-team" }]
		: []),
]);

/**
 * Sidebar links stay highlighted on their sub-pages (`/settings/api-keys/new`,
 * `/events/1/participants/7`, `/admin/users/3/activity`). List and detail pages are sibling
 * routes, which the router's own active check doesn't connect. `exact` links are left alone.
 */
function withSubpageActive(items: NavigationMenuItem[]): NavigationMenuItem[] {
	return items.map((item) => {
		const children = item.children ? withSubpageActive(item.children) : undefined;
		const withChildren = children ? { ...item, children } : item;
		if (typeof item.to !== "string" || item.exact || item.active !== undefined) return withChildren;
		const active = route.path === item.to || route.path.startsWith(`${item.to}/`);
		return { ...withChildren, active };
	});
}

const settingsItems: NavigationMenuItem[] = [
	{ label: "Einstellungen", icon: "i-lucide-settings", type: "label" },
	{ label: "Profil", icon: "i-lucide-user", to: "/settings", exact: true },
	{ label: "Sicherheit", icon: "i-lucide-shield", to: "/settings/security" },
	{ label: "API-Schlüssel", icon: "i-lucide-key", to: "/settings/api-keys" },
	{ label: "App installieren", icon: "i-lucide-smartphone", to: "/settings/apps" },
];

const adminItems: NavigationMenuItem[] = [
	{ label: "Administration", icon: "i-lucide-shield", type: "label" },
	{ label: "Benutzer", icon: "i-lucide-users", to: "/admin/users" },
	{ label: "Einladungen", icon: "i-lucide-mail-plus", to: "/admin/invitations" },
	{ label: "Organisation", icon: "i-lucide-palette", to: "/admin/organization" },
	{ label: "Audit-Log", icon: "i-lucide-scroll-text", to: "/admin/audit-log" },
];

const systemItems: NavigationMenuItem[] = [
	{ label: "Systemverwaltung", icon: "i-lucide-server-cog", type: "label" },
	{ label: "Organisationen", icon: "i-lucide-building", to: "/admin/orgs" },
	{ label: "Domains", icon: "i-lucide-globe", to: "/admin/domains" },
	{ label: "System-Admins", icon: "i-lucide-users", to: "/admin/users" },
	{ label: "Einladungen", icon: "i-lucide-mail-plus", to: "/admin/invitations" },
	{ label: "Audit-Log", icon: "i-lucide-scroll-text", to: "/admin/audit-log" },
];

const coreTeamItems: NavigationMenuItem[] = [
	{ label: "Kernteam", icon: "i-lucide-building-2", type: "label" },
	{ label: "Übersicht", icon: "i-lucide-layout-dashboard", to: "/core-team", exact: true },
	{ label: "Freizeiten & Events", icon: "i-lucide-tent", to: "/core-team/events" },
	{ label: "Personalplanung", icon: "i-lucide-calendar-cog", to: "/core-team/staff-planning" },
	{ label: "Finanzen", icon: "i-lucide-wallet", to: "/core-team/finances" },
	{ label: "Statistiken", icon: "i-lucide-chart-pie", to: "/core-team/stats" },
	{ label: "Material & Ressourcen", icon: "i-lucide-package", to: "/core-team/resources" },
	{ label: "Neuigkeiten verwalten", icon: "i-lucide-megaphone", to: "/core-team/announcements" },
	{ label: "Dokumente verwalten", icon: "i-lucide-library", to: "/documents" },
	{ label: "Interne Notizen", icon: "i-lucide-notebook-tabs", to: "/core-team/notes" },
	{ label: "Kernteam-Chat", icon: "i-lucide-messages-square", to: "/messages?channel=core_team" },
];

const backItem = computed<NavigationMenuItem[]>(() => [
	isSystem.value
		? { label: "Zurück zur Systemverwaltung", icon: "i-lucide-arrow-left", to: "/admin" }
		: { label: "Zurück zum Portal", icon: "i-lucide-arrow-left", to: "/" },
]);

// --- search ---------------------------------------------------------------------------------

const searchGroups = computed(() =>
	isSystem.value
		? [
				{
					id: "pages",
					label: "Seiten",
					items: [...systemItems, ...settingsItems]
						.filter((item) => item.to)
						.map(({ badge, chip, children, defaultOpen, type, ...item }) => item),
				},
			]
		: [
				{
					id: "pages",
					label: "Seiten",
					items: [
						...personalItems.value.filter((item) => item.to),
						...eventItems.value.flatMap((item) => (item.children ? item.children : [item])),
						...organisationItems.value.filter((item) => item.to),
						...settingsItems.filter((item) => item.to),
						...(isCoreTeam.value ? coreTeamItems.filter((item) => item.to) : []),
						...(isAdmin.value ? adminItems.filter((item) => item.to) : []),
					].map(({ badge, chip, children, defaultOpen, type, ...item }) => item),
				},
				{
					id: "events",
					label: "Meine Events",
					items: (myEvents.value ?? []).map((event) => ({
						label: event.name,
						suffix: formatDayRange(event.start_date, event.end_date),
						icon: event.type === "camp" ? "i-lucide-tent" : "i-lucide-calendar-days",
						to: `/events/${event.id}`,
					})),
				},
			],
);
</script>

<template>
	<NuxtLoadingIndicator color="var(--ui-primary)" position="top" />

	<UDashboardGroup class="main-bg-color text-slate-100">
		<UDashboardSearch :groups="searchGroups" placeholder="Suchen…" />

		<UDashboardSidebar
			id="default"
			class="print:hidden"
			collapsible
			resizable
			:ui="{
				header: 'main-bg-color',
				body: 'main-bg-color',
				content: 'main-bg-color',
				footer: 'border-t border-default main-bg-color',
			}"
			:min-size="18"
			:default-size="20"
			:max-size="30"
		>
			<template #header="{ collapsed }">
				<NuxtLink :to="homeRoute" :class="`${!collapsed ? 'ms-2.5' : ''} flex items-center gap-1.5`">
					<ImgAppLogo v-if="!collapsed" class="h-8" />
					<ImgAppIcon v-else class="h-8 w-8" />
				</NuxtLink>
			</template>

			<template #default="{ collapsed }">
				<template v-if="section === 'system'">
					<UDashboardSearchButton
						:collapsed="collapsed"
						label="Suchen…"
						class="bg-transparent ring-default"
					/>
					<UNavigationMenu :collapsed="collapsed" :items="withSubpageActive(systemItems)" orientation="vertical" />
				</template>

				<template v-else-if="section === 'main'">
					<UDashboardSearchButton
						:collapsed="collapsed"
						label="Suchen…"
						class="bg-transparent ring-default"
					/>

					<UNavigationMenu :collapsed="collapsed" :items="withSubpageActive(personalItems)" orientation="vertical" />

					<div class="flex flex-col">
						<UNavigationMenu
							:collapsed="collapsed"
							:items="[{ label: 'Freizeiten & Events', type: 'label' }]"
							orientation="vertical"
						/>
						<DashboardEventSwitcher :collapsed="collapsed" :selected="selectedEvent" />
						<UNavigationMenu
							v-if="eventItems.length"
							:key="selectedEvent?.id"
							:collapsed="collapsed"
							:items="withSubpageActive(eventItems)"
							orientation="vertical"
							class="mt-1"
						/>
					</div>

					<UNavigationMenu
						:collapsed="collapsed"
						:items="withSubpageActive(organisationItems)"
						orientation="vertical"
						class="mt-auto"
					/>
				</template>

				<template v-else>
					<UNavigationMenu
						:collapsed="collapsed"
						:items="backItem"
						orientation="vertical"
						class="mb-2"
					/>

					<UNavigationMenu
						v-if="section === 'settings'"
						:collapsed="collapsed"
						:items="withSubpageActive(settingsItems)"
						orientation="vertical"
					/>

					<UNavigationMenu
						v-if="section === 'admin' && isAdmin"
						:collapsed="collapsed"
						:items="withSubpageActive(adminItems)"
						orientation="vertical"
					/>

					<UNavigationMenu
						v-if="section === 'coreTeam' && isCoreTeam"
						:collapsed="collapsed"
						:items="withSubpageActive(coreTeamItems)"
						orientation="vertical"
					/>
				</template>
			</template>

			<template #footer="{ collapsed }">
				<DashboardUserMenu :collapsed="collapsed" />
			</template>
		</UDashboardSidebar>

		<slot />

		<DashboardNotificationsSlideover />
	</UDashboardGroup>
</template>
