<script setup lang="ts">
/**
 * An event's material, one sub-route per view (style guide 07: useSubrouterPathDynamics + toolbar
 * sub-navigation): the list ("Liste", index), the requests of team members ("Anfragen",
 * `/requests`) and the packing list ("Packliste", `/packing`). This page loads the data once and
 * renders the dialogs; the child pages use both through `useEventMaterials()`.
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const route = useRoute();
const userInfo = await useUserInfoStore().use();

const materials = await createEventMaterials({
	event,
	eventId,
	can,
	userId: () => userInfo.value?.id,
});
provideEventMaterials(materials);

const { basePath, openRequests, refresh, loading } = materials;

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() => ({
	[basePath.value]: {
		isNavLink: true,
		label: "Liste",
		icon: "i-lucide-list",
		exact: true,
		getDynamicValues: () => ({
			seoSettings: { description: `Material von ${event.value.name}` },
			breadcrumbItems: [],
		}),
	},
	[`${basePath.value}/requests`]: {
		isNavLink: true,
		label: openRequests.value.length ? `Anfragen (${openRequests.value.length})` : "Anfragen",
		icon: "i-lucide-message-circle-question",
		getDynamicValues: () => ({
			seoSettings: { title: "Anfragen", description: `Materialanfragen für ${event.value.name}` },
			breadcrumbItems: [{ label: "Anfragen" }],
		}),
	},
	[`${basePath.value}/packing`]: {
		isNavLink: true,
		label: "Packliste",
		icon: "i-lucide-list-checks",
		getDynamicValues: () => ({
			seoSettings: { title: "Packliste", description: `Packliste von ${event.value.name}` },
			breadcrumbItems: [{ label: "Packliste" }],
		}),
	},
}));

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: `Material | ${event.value.name}`,
	routes,
});

await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});
</script>

<template>
	<UDashboardPanel id="event-materials">
		<template #header>
			<DashboardPageHeader title="Material" icon="i-lucide-package" :description="event.name">
				<template #right>
					<UButton
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="ghost"
						aria-label="Aktualisieren"
						:loading="loading"
						@click="refresh()"
					/>
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<UEmpty
					v-if="!can('materials:view')"
					icon="i-lucide-lock"
					title="Kein Zugriff"
					description="Du siehst das Material dieses Events nicht."
				/>
				<NuxtPage v-else />
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<MaterialsDialogs v-if="can('materials:view')" />
</template>
