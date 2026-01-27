<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { useUserInfoStore } from '~/composables/stores/useUserStore';

const userInfoStore = useUserInfoStore();
const user = await userInfoStore.use();

const isAdmin = computed(() => user.value?.role === "admin");

const sidebarItems = computed<NavigationMenuItem[][]>(() => {
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
    ];

	const campItems: NavigationMenuItem[] = [
		{
			label: 'Camps',
			icon: 'i-lucide-tent',
			type: 'label'
		},
		{
			label: 'My Camps',
			icon: 'i-lucide-users',
			to: '/camps',
		},
	];

    const settings: NavigationMenuItem[] = [
        {
            type: "label",
            class: "mt-4 pt-3 border-t-2 border-default",
        },
        {
            label: "Settings",
            to: "/settings",
            icon: "i-lucide-settings",
            defaultOpen: true,
            type: "trigger",
            children: [
                {
                    label: "General",
                    to: "/settings",
                    exact: true,
                },
                {
                    label: "Security",
                    to: "/settings/security",
                },
            ],
        },
    ];

    const adminItems: NavigationMenuItem[] = isAdmin.value ? [
        {
            label: "Admin",
            icon: "i-lucide-shield",
            type: "label",
            class: "mt-4 pt-4 border-t-2 border-default",
        },
        {
            label: "Users",
            icon: "i-lucide-users",
            to: "/admin/users",
        },
        {
            label: "Alle Freizeiten",
            icon: "i-lucide-package-search",
            to: "/admin/packages",
        }
    ] : [];

    const footerItems: NavigationMenuItem[] = [
        // {
        //     label: "Back to Home",
        //     icon: "i-lucide-home",
        //     to: "/",
        // },
    ];

    return [[...basicItems], [...campItems, ...adminItems, ...settings], [...footerItems]];
});

const searchGroups = computed(() => [{
	id: 'links',
	label: 'Go to',
	items: sidebarItems.value.flat()
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
                    :items="sidebarItems[0]"
                    orientation="vertical"
					class="mb-4 pb-4 border-b-2 border-default"
                />

				<CampsMenu :collapsed="collapsed" />

                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="sidebarItems[1]"
                    orientation="vertical"
                />

                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="sidebarItems[2]"
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
