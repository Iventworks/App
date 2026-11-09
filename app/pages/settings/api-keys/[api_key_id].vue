<script setup lang="ts">
/**
 * Parent route for one API key (`/settings/api-keys/new` or `/settings/api-keys/<id>`), as in the
 * style guide template `dashboard/apikeys/[api_key_id].vue`: loads the key once and hands it to
 * the child pages via `useSubrouterInjectedData`; toolbar and breadcrumbs come from
 * `useSubrouterPathDynamics`. Add sub-pages as `[api_key_id]/<name>.vue` plus an entry in
 * `getRoutesConfig()`.
 */
import type { NuxtError } from "#app";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import type { APIKey, NewAPIKey } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const route = useRoute();
const apiKeyId = safeDecodeURIComponent(route.params.api_key_id as string);

let error: NuxtError | null = null;

if (apiKeyId === "new") {
	useSubrouterInjectedData<APIKey, NewAPIKey>("api_key", true).provide({
		data: ref<NewAPIKey>({
			description: "",
			expires_at: "90d",
		}),
		isNew: true,
	});
} else {
	const {
		data: result,
		refresh,
		loading,
	} = await useAPIAsyncData(
		`account-apikey-${apiKeyId}`,
		async () =>
			await useAPI((api) => api.getAccountApikeysByApiKeyId({ path: { apiKeyID: apiKeyId } })),
	);

	if (!result.value?.success) {
		error = createError({
			statusCode: result.value?.code || 500,
			statusMessage: result.value?.message || "API-Schlüssel konnte nicht geladen werden",
		});
	}

	useSubrouterInjectedData<APIKey, NewAPIKey>("api_key", true).provide({
		data: computed(() => (result.value?.success ? result.value.data : null) as APIKey),
		refresh,
		loading,
		isNew: false,
	});
}

function getRoutesConfig(): UseSubrouterPathDynamics.RoutesConfig {
	const isNew = apiKeyId === "new";
	return {
		[`/settings/api-keys/${isNew ? "new" : apiKeyId}`]: {
			isNavLink: true,
			label: "Allgemein",
			icon: "i-lucide-info",
			exact: true,
			getDynamicValues() {
				return {
					seoSettings: {
						title: isNew ? "Neuer Schlüssel" : `Schlüssel ${shortId(apiKeyId)}`,
						description: isNew ? "Neuen API-Schlüssel anlegen" : `API-Schlüssel ${apiKeyId} verwalten`,
					},
					breadcrumbItems: [{ label: isNew ? "Neuer Schlüssel" : shortId(apiKeyId) }],
				};
			},
		},
	};
}

const subrouterPathDynamics = useSubrouterPathDynamics({
	baseTitle: "API-Schlüssel | Einstellungen",
	basebreadcrumbItems: [{ label: "API-Schlüssel", to: "/settings/api-keys" }],
	routes: getRoutesConfig(),
});

const routePathDynamicValues = await useAwaitedComputed(async () => {
	const values = await subrouterPathDynamics.getPathDynamicValues(route.path);
	useSeoMeta(values.seoSettings);
	return values;
});
</script>

<template>
	<UDashboardPanel id="settings-api-key">
		<template #header>
			<DashboardPageHeader icon="i-lucide-key" :breadcrumb-items="routePathDynamicValues.breadcrumbItems" />

			<UDashboardToolbar>
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouterPathDynamics.links" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<div class="flex w-full flex-col gap-4 sm:gap-6 lg:gap-12">
				<UError v-if="error" :error="error" />
				<NuxtPage v-else />
			</div>
		</template>
	</UDashboardPanel>
</template>
