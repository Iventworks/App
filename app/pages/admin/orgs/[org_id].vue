<script setup lang="ts">
/**
 * One org for the system admins (`/admin/orgs/:id` + `/domains`): loaded once and shared with the
 * child pages as `system_org`.
 */
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import type { SystemOrg } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const orgId = Number(route.params.org_id);

const {
	data: result,
	refresh,
	loading,
} = await useAPIAsyncData(`system-org-${orgId}`, async () =>
	Number.isInteger(orgId) && orgId > 0
		? await useAPI((api) => api.getSystemOrgsByOrgId({ path: { orgId } }))
		: null,
);

const error =
	result.value?.success && result.value.data
		? null
		: createError({
				statusCode: result.value?.code || 404,
				statusMessage: result.value?.message || "Organisation nicht gefunden",
			});

const org = computed(() => (result.value?.success ? result.value.data : null) as SystemOrg);

useSubrouterInjectedData<SystemOrg>("system_org").provide({ data: org, refresh, loading });

const name = computed(() => org.value?.display_name ?? `#${orgId}`);

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	[`/admin/orgs/${orgId}`]: {
		isNavLink: true,
		label: "Allgemein",
		icon: "i-lucide-building",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { title: name.value, description: `Organisation ${name.value}` },
			breadcrumbItems: [{ label: name.value }],
		}),
	},
	[`/admin/orgs/${orgId}/domains`]: {
		isNavLink: true,
		label: "Domains",
		icon: "i-lucide-globe",
		to: `/admin/orgs/${orgId}/domains`,
		getDynamicValues: () => ({
			seoSettings: { title: `Domains | ${name.value}`, description: `Domains von ${name.value}` },
			breadcrumbItems: [{ label: name.value, to: `/admin/orgs/${orgId}` }, { label: "Domains" }],
		}),
	},
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: "Organisationen",
	basebreadcrumbItems: [{ label: "Organisationen", to: "/admin/orgs" }],
	routes,
});

const routePathDynamicValues = await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});
</script>

<template>
	<UDashboardPanel id="system-org">
		<template #header>
			<DashboardPageHeader icon="i-lucide-building" :breadcrumb-items="routePathDynamicValues.breadcrumbItems">
				<template v-if="org" #right>
					<UButton
						:to="org.url"
						external
						target="_blank"
						label="Öffnen"
						icon="i-lucide-external-link"
						color="neutral"
						variant="subtle"
						size="sm"
					/>
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
