<script setup lang="ts">
/**
 * Event finances, one sub-route per view (style guide 07: useSubrouterPathDynamics + toolbar
 * sub-navigation): staff submit expenses with receipts ("Meine Ausgaben", index); leaders review
 * every expense ("Alle Ausgaben", `/all`), plan the budget ("Budget", `/budget`) and see the
 * breakdown ("Auswertung", `/summary`). This page loads the data once and renders the dialogs; the
 * child pages use both through `useEventFinances()`.
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const route = useRoute();
const userInfo = await useUserInfoStore().use();

const finances = await createEventFinances({ eventId, can, userId: () => userInfo.value?.id });
provideEventFinances(finances);

const { sections, basePath } = finances;

const routes = computed<UseSubrouterPathDynamics.RoutesConfig>(() =>
	Object.fromEntries(
		sections.value.map((section) => [
			section.path,
			{
				isNavLink: true,
				label: section.label,
				icon: section.icon,
				// The index link must not stay highlighted on `/all`, `/budget`, `/summary`.
				exact: section.path === basePath.value,
				getDynamicValues: () => ({
					seoSettings: { title: section.label, description: `Finanzen von ${event.value.name}` },
					breadcrumbItems: [{ label: section.label }],
				}),
			},
		]),
	),
);

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: `Finanzen | ${event.value.name}`,
	routes,
});

await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});
</script>

<template>
	<UDashboardPanel id="event-finances">
		<template #header>
			<DashboardPageHeader title="Finanzen" icon="i-lucide-receipt-euro" :description="event.name" />

			<UDashboardToolbar v-if="sections.length > 1">
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<UEmpty
					v-if="!sections.length"
					icon="i-lucide-lock"
					title="Kein Zugriff"
					description="Du hast in diesem Event keinen Zugriff auf die Finanzen."
				/>
				<NuxtPage v-else />
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<FinanceDialogs />
</template>
