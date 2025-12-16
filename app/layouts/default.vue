<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { UserStore } from '~/utils/stores/userStore';

const route = useRoute()

const sessionCookie = useCookie<string | null>("session_token");
const user = ref<any | null>(null);

if (sessionCookie.value) {
    user.value = await UserStore.use().catch(() => null);
}

const isAdmin = computed(() => user.value?.role === "admin");

const sidebarItems = computed<NavigationMenuItem[][]>(() => {
    const devItems: NavigationMenuItem[] = [
        {
            label: "Overview",
            icon: "i-lucide-layout-dashboard",
            to: "/dashboard",
        },
        {
            label: "Packages",
            icon: "i-lucide-package",
            to: "/dashboard/packages",
        },
        {
            label: "Tasks",
            icon: "i-lucide-list-checks",
            to: "/dashboard/tasks",
        },
    ];

    const settings: NavigationMenuItem[] = [
        {
            type: "label",
            class: "mt-4 pt-3 border-t-2 border-default",
        },
        {
            label: "Settings",
            to: "/dashboard/settings",
            icon: "i-lucide-settings",
            defaultOpen: true,
            type: "trigger",
            children: [
                {
                    label: "General",
                    to: "/dashboard/settings",
                    exact: true,
                },
                {
                    label: "Security",
                    to: "/dashboard/settings/security",
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
            // defaultOpen: route.path.startsWith("/dashboard/admin"),
            // children: [
            //     {
            //         label: "Stable Requests",
            //         to: "/dashboard/admin/requests",
            //     },
            //     {
            //         label: "Users",
            //         to: "/dashboard/admin/users",
            //     },
            //     {
            //         label: "All Packages",
            //         to: "/dashboard/admin/packages",
            //     },
            // ],
        },
        {
            label: "Users",
            icon: "i-lucide-users",
            to: "/dashboard/admin/users",
        },
        {
            label: "All Packages",
            icon: "i-lucide-package-search",
            to: "/dashboard/admin/packages",
        },
        {
            label: "Stable Requests",
            icon: "i-lucide-git-pull-request",
            to: "/dashboard/admin/requests",
        },
        {
            label: "OS Releases",
            icon: "i-lucide-rocket",
            to: "/dashboard/admin/os-releases",
        },
        {
            label: "Tasks",
            icon: "i-lucide-list-checks",
            to: "/dashboard/admin/tasks",
        }
    ] : [];

    const footerItems: NavigationMenuItem[] = [
        {
            label: "Explorer",
            icon: "i-lucide-compass",
            to: "/explorer",
        },
        {
            label: "Back to Home",
            icon: "i-lucide-home",
            to: "/",
        },
    ];

    return [[...devItems, ...adminItems, ...settings], footerItems];
});

const groups = computed(() => [{
	id: 'links',
	label: 'Go to',
	items: sidebarItems.value.flat()
}])


</script>

<template>
	<UDashboardGroup>
		<UDashboardSidebar id="default"
			collapsible
			resizable
			:ui="{
				footer: 'lg:border-t lg:border-default'
			}"
			:min-size="18"
            :default-size="18"
            :max-size="30"
		>
			<template #header="{ collapsed }">
				<CampsMenu :collapsed="collapsed" />
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
                />

                <UNavigationMenu
                    :collapsed="collapsed"
                    :items="sidebarItems[1]"
                    orientation="vertical"
                    class="mt-auto"
                />
            </template>

			<template #footer="{ collapsed }">
				<UserMenu :collapsed="collapsed" />
			</template>

		</UDashboardSidebar>

		<UDashboardSearch :groups="groups" />

		<slot />

		<NotificationsSlideover />
	</UDashboardGroup>
</template>
