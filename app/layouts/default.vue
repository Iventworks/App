<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { is } from 'zod/v4/locales';
import { useUserInfoStore } from '~/composables/stores/useUserStore';

const userInfoStore = useUserInfoStore();
const user = await userInfoStore.use();

const isCoreTeam = computed(() => user.value?.role === "core_team" || user.value?.role === "admin");
const isAdmin = computed(() => user.value?.role === "admin");

const sidebarItems = computed(() => {
    const basicItems: NavigationMenuItem[] = [
        {
            label: "Overview",
            icon: "i-lucide-layout-dashboard",
            to: "/",
        },
		{
			label: "Emails",
			icon: "i-lucide-mail",
			to: "/emails/inbox",
		},
        {
            label: "Chats",
            icon: "i-lucide-message-circle",
            to: "/chats",
        },
        {
            label: "Meine Aufgaben",
            icon: "i-lucide-list-checks",
            to: "/tasks",
        },
        {
            label: "Infobox",
            icon: "i-lucide-info",
            to: "/management/infobox",
        },
    ];

    const selectedCampOrEvent = useSelectedCampOrEvent();

	const campItems: NavigationMenuItem[] = [
		{
			label: 'Infos & Übersicht',
			icon: 'i-lucide-users',
			to: `/camps-and-events/${selectedCampOrEvent.value?.id || ''}/overview`,
		},
        {
            label: 'Programm',
            icon: 'i-lucide-calendar',
            to: `/camps-and-events/${selectedCampOrEvent.value?.id || ''}/program`,
        },
        {
            label: 'Aufgaben',
            icon: 'i-lucide-list-checks',
            to: `/camps-and-events/${selectedCampOrEvent.value?.id || ''}/tasks`,
        },
        {
            label: 'Teilnehmerverwaltung',
            icon: 'i-lucide-user-check',
            to: `/camps-and-events/${selectedCampOrEvent.value?.id || ''}/participants`,
        },
        {
            label: 'Ressourcen & Dokumente',
            icon: 'i-lucide-folder',
            to: `/camps-and-events/${selectedCampOrEvent.value?.id || ''}/resources`,
        },
        {
            label: 'Mitarbeiterverwaltung',
            icon: 'i-lucide-user-plus',
            to: `/camps-and-events/${selectedCampOrEvent.value?.id || ''}/staff`,
        }
	];

    const settings: NavigationMenuItem[] = [
        {
            label: "Einstellungen",
            icon: "i-lucide-settings-2",
            type: "label"
        },
        {
            label: "Allgemein",
            icon: "i-lucide-sliders",
            to: "/settings",
            exact: true,
        },
        {
            label: "Sicherheit",
            icon: "i-lucide-shield",
            to: "/settings/security",
        }
    ];

    const coreTeamItems: NavigationMenuItem[] = [
        {
            label: "Kernteam Management",
            icon: "i-lucide-heart-pulse",
            type: "label"
        },
        {
            label: "Freizeiten & Events Verwalten",
            icon: "i-lucide-key",
            to: "/management/camps-and-events",
        },
        {
            label: "Ressourcen & Dokumente",
            icon: "i-lucide-folder",
            to: "/management/resources",
        },
        {
            label: "Datenbank",
            icon: "i-lucide-database",
            to: "/management/database",
        },
        {
            label: "Finanzen",
            icon: "i-lucide-wallet",
            to: "/management/finances",
            badge: {
                label: "Konzept",
                color: "warning"
            }
        },
        {
            label: "Statistiken",
            icon: "i-lucide-chart-bar",
            to: "/management/stats",
            badge: {
                label: "Konzept",
                color: "warning"
            }
        }
    ];

    const adminItems: NavigationMenuItem[] = [
        {
            label: "Admin",
            icon: "i-lucide-shield",
            type: "label"
        },
        {
            label: "Benutzerverwaltung",
            icon: "i-lucide-users",
            to: "/admin/users",
        },
        {
            label: "Audit Log",
            icon: "i-lucide-clipboard-list",
            badge: {
                label: "Konzept",
                color: "warning"
            }
            // to: "/core-team/audit-log",
        }
        // {
        //     label: "Alle Freizeiten",
        //     icon: "i-lucide-package-search",
        //     to: "/admin/packages",
        // }
    ];

    const footerItems: NavigationMenuItem[] = [
        // {
        //     label: "Back to Home",
        //     icon: "i-lucide-home",
        //     to: "/",
        // },
    ];

    return {
        basic: basicItems,
        camps: campItems,
        coreTeam: coreTeamItems,
        admin: adminItems,
        settings: settings
    }
});

const searchGroups = computed(() => [{
	id: 'links',
	label: 'Go to',
	items: Object.values(sidebarItems.value).flat(),
}])


</script>

<template>
	<UDashboardGroup class="main-bg-color">
		<UDashboardSidebar id="default"
			collapsible
			resizable
			:ui="{
                header: 'main-bg-color',
                body: 'main-bg-color',
                content: 'main-bg-color',
                footer: 'border-t border-default main-bg-color',
			}"
			:min-size="18"
            :default-size="18"
            :max-size="30"
		>
			<template #header="{ collapsed }">
                <NuxtLink to="/" :class="`flex items-center gap-1.5`">
                    <img
                        src="/static/logo/crossover-favicon.png"
                        alt="Crossover Management Portal"
                        class="w-10 max-h-10 mx-auto"
                        style="width: auto; height: auto;"
                    />
                    <h1
                        class="text-lg font-semibold"
                        v-if="!collapsed"
                    >
                        Crossover Management Portal
                    </h1>
                </NuxtLink>
			</template>

			<template #default="{ collapsed }">
				
				<UDashboardSearchButton
					:collapsed="collapsed"
					class="bg-transparent ring-default"
				/>

				<UNavigationMenu
                    :collapsed="collapsed"
                    :items="sidebarItems.basic"
                    orientation="vertical"
                />

                <div class="flex flex-col main-bg-color">
                    <UNavigationMenu
                        :collapsed="collapsed"
                        :items="[{
                            label: 'Freizeiten & Events',
                            icon: 'i-lucide-calendars',
                            type: 'label'
                        }]"
                        orientation="vertical"
                    />

                    <CampsMenu :collapsed="collapsed"/>
                    
                    <UNavigationMenu
                        :collapsed="collapsed"
                        :items="sidebarItems.camps"
                        orientation="vertical"
                        class="mt-0"
                    />
                </div>

                <UNavigationMenu
                    v-if="isCoreTeam"
                    :collapsed="collapsed"
                    :items="sidebarItems.coreTeam"
                    orientation="vertical"
                />

                <UNavigationMenu
                    v-if="isAdmin"
                    :collapsed="collapsed"
                    :items="sidebarItems.admin"
                    orientation="vertical"
                />

                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="sidebarItems.settings"
                    orientation="vertical"
                    class="mt-auto"
                />

            </template>

			<template #footer="{ collapsed }">
				<UserMenu :collapsed="collapsed" />
			</template>

		</UDashboardSidebar>

		<UDashboardSearch :groups="searchGroups" />

		<slot />

		<NotificationsSlideover />
	</UDashboardGroup>
</template>
