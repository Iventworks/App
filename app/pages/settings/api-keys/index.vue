<script setup lang="ts">
/**
 * The account's API keys (style guide template `dashboard/apikeys/index.vue`): a DataTable with
 * "Neuer Schlüssel" in `#header-right`; creating and the key's details live on
 * `/settings/api-keys/new` and `/settings/api-keys/<id>`.
 */
import type { TableColumn } from "@nuxt/ui";
import type { APIKey } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "API-Schlüssel | Einstellungen | CMP",
	description: "API-Schlüssel für Integrationen verwalten",
});

const toast = useToast();

const columns: TableColumn<APIKey>[] = [
	{ accessorKey: "id", header: "ID" },
	{ accessorKey: "description", header: "Beschreibung" },
	{ accessorKey: "created_at", header: "Erstellt" },
	{ accessorKey: "expires_at", header: "Läuft ab" },
	{ id: "status", header: "Status" },
	{ id: "actions", header: "" },
];

const apiKeys = await useAPIAsyncData<APIKey[]>("account-apikeys", async () => {
	const res = await useAPI((api) => api.getAccountApikeys({}));
	if (!res.success) {
		toast.add({
			title: "API-Schlüssel konnten nicht geladen werden",
			description: res.message,
			color: "error",
		});
		return [];
	}
	return res.data;
});

function isExpired(key: APIKey) {
	return key.expires_at !== null && key.expires_at < Date.now();
}

const deleteConfirmOpen = ref(false);
const deleteTarget = ref<APIKey | null>(null);

function openDelete(key: APIKey) {
	deleteTarget.value = key;
	deleteConfirmOpen.value = true;
}

async function onDeleteApiKey() {
	const apiKeyID = deleteTarget.value?.id;
	if (!apiKeyID) return;

	const res = await useAPI((api) => api.deleteAccountApikeysByApiKeyId({ path: { apiKeyID } }));
	if (!res.success) {
		toast.add({
			title: "Löschen fehlgeschlagen",
			description: res.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		throw new Error(res.message);
	}

	toast.add({ title: "API-Schlüssel gelöscht", icon: "i-lucide-check", color: "success" });
	await apiKeys.refresh();
}
</script>

<template>
	<UDashboardPanel id="settings-api-keys">
		<template #header>
			<DashboardPageHeader
				title="API-Schlüssel"
				icon="i-lucide-key"
				description="Zugriff für Skripte und Integrationen"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					:data="apiKeys.data"
					:columns="columns"
					:loading="apiKeys.loading"
					:filters="[
						{
							column: 'description',
							type: 'text',
							placeholder: 'Beschreibung suchen …',
							icon: 'i-lucide-search',
						},
					]"
					empty-title="Noch keine API-Schlüssel"
					empty-description="Lege einen Schlüssel an, um die CMP-API aus eigenen Programmen zu nutzen."
					empty-icon="i-lucide-key"
					@refresh="apiKeys.refresh()"
				>
					<template #header-right>
						<UButton label="Neuer Schlüssel" icon="i-lucide-plus" color="primary" to="/settings/api-keys/new" />
					</template>

					<template #id-cell="{ row }">
						<NuxtLink
							:to="`/settings/api-keys/${row.original.id}`"
							:title="row.original.id"
							class="font-mono text-sm font-medium text-primary-400 hover:underline"
						>
							{{ shortId(row.original.id) }}
						</NuxtLink>
					</template>

					<template #description-cell="{ row }">
						<span class="line-clamp-1 max-w-xs text-slate-300">
							{{ row.original.description || "—" }}
						</span>
					</template>

					<template #created_at-cell="{ row }">
						<span class="text-sm">{{ formatDate(row.original.created_at) }}</span>
					</template>

					<template #expires_at-cell="{ row }">
						<span
							v-if="row.original.expires_at"
							class="text-sm"
							:class="isExpired(row.original) ? 'text-red-400' : ''"
						>
							{{ formatDate(row.original.expires_at) }}
						</span>
						<span v-else class="text-sm text-slate-400">Nie</span>
					</template>

					<template #status-cell="{ row }">
						<UBadge v-if="isExpired(row.original)" color="error" variant="soft" size="sm">Abgelaufen</UBadge>
						<UBadge v-else color="success" variant="soft" size="sm">Aktiv</UBadge>
					</template>

					<template #actions-cell="{ row }">
						<UButton
							icon="i-lucide-trash-2"
							color="error"
							variant="ghost"
							size="sm"
							aria-label="Schlüssel löschen"
							@click="openDelete(row.original)"
						/>
					</template>

					<template #empty-actions>
						<UButton label="Schlüssel anlegen" color="primary" to="/settings/api-keys/new" />
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardDeleteModal
		v-model:open="deleteConfirmOpen"
		title="Schlüssel löschen"
		:warning-text="`Der Schlüssel „${deleteTarget?.description}“ funktioniert danach nicht mehr. Das lässt sich nicht rückgängig machen.`"
		:require-confirm-text="false"
		:on-delete="onDeleteApiKey"
	/>
</template>
