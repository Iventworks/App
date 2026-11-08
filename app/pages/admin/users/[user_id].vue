<script setup lang="ts">
/**
 * Layout for one account (`/admin/users/:id` and `/admin/users/:id/activity`): loads the account
 * and provides it to the child pages as `admin_user` (style guide 07: useSubrouterInjectedData +
 * useSubrouterPathDynamics, toolbar sub-navigation).
 */
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import type { AdminUserDetail } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const userId = Number(route.params.user_id);

const {
	data: result,
	refresh,
	loading,
} = await useAPIAsyncData(`admin-user-${userId}`, async () =>
	Number.isInteger(userId) && userId > 0
		? await useAPI((api) => api.getAdminUsersByUserId({ path: { userId } }))
		: null,
);

const error =
	result.value?.success && result.value.data
		? null
		: createError({
				statusCode: result.value?.code || 404,
				statusMessage: result.value?.message || "Benutzer nicht gefunden",
			});

const user = computed(() => (result.value?.success ? result.value.data : null) as AdminUserDetail);

useSubrouterInjectedData<AdminUserDetail>("admin_user").provide({ data: user, refresh, loading });

const name = computed(() => user.value?.display_name ?? `#${userId}`);

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	[`/admin/users/${userId}`]: {
		isNavLink: true,
		label: "Übersicht",
		icon: "i-lucide-user",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { title: name.value, description: `Konto von ${name.value}` },
			breadcrumbItems: [{ label: name.value }],
		}),
	},
	[`/admin/users/${userId}/activity`]: {
		isNavLink: true,
		label: "Aktivität",
		icon: "i-lucide-scroll-text",
		to: `/admin/users/${userId}/activity`,
		getDynamicValues: () => ({
			seoSettings: { title: `Aktivität | ${name.value}`, description: `Audit-Log zu ${name.value}` },
			breadcrumbItems: [{ label: name.value, to: `/admin/users/${userId}` }, { label: "Aktivität" }],
		}),
	},
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: "Benutzer | Administration | CMP",
	basebreadcrumbItems: [{ label: "Benutzer", to: "/admin/users" }],
	routes,
});

const routePathDynamicValues = await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});
</script>

<template>
	<UDashboardPanel id="admin-user">
		<template #header>
			<DashboardPageHeader icon="i-lucide-user" :breadcrumb-items="routePathDynamicValues.breadcrumbItems">
				<template v-if="user" #right>
					<UBadge v-if="user.suspended_at" label="Gesperrt" color="error" icon="i-lucide-ban" variant="soft" />
					<UBadge :label="getRoleLabel(user.role)" :color="getRoleColor(user.role)" variant="subtle" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar v-if="!error">
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<NuxtPage v-if="!error" />
				<UError v-else :error="error" />
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
