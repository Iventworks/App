<script setup lang="ts">
/**
 * The org's own settings (`/admin/organization` + `/domains`): loads them once and shares them
 * with the child pages as `organization` (useSubrouterInjectedData + useSubrouterPathDynamics).
 * Domains only exist in multi-org mode.
 */
import { useInstanceStore } from "~/composables/stores/useInstanceStore";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import type { OrgSettings } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const route = useRoute();

const {
	data: result,
	refresh,
	loading,
} = await useAPIAsyncData(
	"admin-organization",
	async () => await useAPI((api) => api.getAdminOrganization({})),
);

const error = result.value?.success
	? null
	: createError({
			statusCode: result.value?.code || 500,
			statusMessage: result.value?.message || "Einstellungen konnten nicht geladen werden",
		});

const settings = computed(() => (result.value?.success ? result.value.data : null) as OrgSettings);

// The sidebar logo, colour and page titles follow every change right away.
watch(
	() => settings.value?.org,
	(org) => {
		if (org) useInstanceStore().setOrg(org);
	},
);

useSubrouterInjectedData<OrgSettings>("organization").provide({ data: settings, refresh, loading });

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	"/admin/organization": {
		isNavLink: true,
		label: "Allgemein",
		icon: "i-lucide-palette",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { title: "Allgemein", description: "Name, Farbe, Logo und Icon der Organisation" },
			breadcrumbItems: [{ label: "Allgemein" }],
		}),
	},
	...(settings.value?.multi_org
		? {
				"/admin/organization/domains": {
					isNavLink: true,
					label: "Domains",
					icon: "i-lucide-globe",
					to: "/admin/organization/domains",
					getDynamicValues: () => ({
						seoSettings: { title: "Domains", description: "Eigene Domains der Organisation" },
						breadcrumbItems: [{ label: "Domains" }],
					}),
				},
			}
		: {}),
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: "Organisation | Administration",
	basebreadcrumbItems: [{ label: "Organisation", to: "/admin/organization" }],
	routes,
});

const routePathDynamicValues = await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});
</script>

<template>
	<UDashboardPanel id="admin-organization">
		<template #header>
			<DashboardPageHeader
				icon="i-lucide-building"
				:breadcrumb-items="routePathDynamicValues.breadcrumbItems"
				description="So erscheint deine Organisation – und unter welchen Adressen"
			/>

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
