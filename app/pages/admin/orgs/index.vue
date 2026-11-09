<script setup lang="ts">
/** System dashboard: every org of this installation (multi-org mode, base domain). */
import type { TableColumn } from "@nuxt/ui";
import { DEFAULT_BRAND } from "~/composables/stores/useInstanceStore";
import type { SystemOrg } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Organisationen", description: "Alle Organisationen dieser Installation" });

const toast = useToast();

const orgs = await useAPIAsyncData("system-orgs", async () => {
	const res = await useAPI((api) => api.getSystemOrgs({}));
	if (!res.success) {
		toast.add({
			title: "Organisationen konnten nicht geladen werden",
			description: res.message,
			color: "error",
		});
		return [];
	}
	return res.data;
});

const columns: TableColumn<SystemOrg>[] = [
	{ accessorKey: "display_name", header: "Name" },
	{ accessorKey: "url", header: "Adresse" },
	{ accessorKey: "user_count", header: "Benutzer" },
	{ accessorKey: "event_count", header: "Events" },
	{ accessorKey: "domain_count", header: "Domains" },
	{ accessorKey: "created_at", header: "Angelegt" },
];
</script>

<template>
	<UDashboardPanel id="system-orgs">
		<template #header>
			<DashboardPageHeader
				title="Organisationen"
				icon="i-lucide-building"
				description="Jede Organisation hat eigene Benutzer, Daten, Farben und Adressen"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					:data="orgs.data.value ?? []"
					:columns="columns"
					:loading="orgs.loading.value"
					:filters="[{ column: 'display_name', type: 'text', placeholder: 'Organisation suchen …', icon: 'i-lucide-search' }]"
					empty-title="Noch keine Organisation"
					empty-description="Lege die erste Organisation an und lade ihre Leitung als Admin ein."
					empty-icon="i-lucide-building"
					@refresh="orgs.refresh()"
				>
					<template #header-right>
						<UButton label="Organisation anlegen" icon="i-lucide-plus" color="primary" to="/admin/orgs/new" />
					</template>

					<template #display_name-cell="{ row }">
						<NuxtLink :to="`/admin/orgs/${row.original.id}`" class="flex items-center gap-3 hover:underline">
							<img :src="row.original.icon_url ?? DEFAULT_BRAND.icon" alt="" class="size-7 rounded object-contain" />
							<span class="flex flex-col leading-tight">
								<span class="font-medium text-white">{{ row.original.display_name }}</span>
								<span class="font-mono text-xs text-slate-500">{{ row.original.slug }}</span>
							</span>
						</NuxtLink>
					</template>

					<template #url-cell="{ row }">
						<ULink :to="row.original.url" external target="_blank" class="font-mono text-sm text-primary-400 hover:underline">
							{{ row.original.primary_domain ?? row.original.default_domain }}
						</ULink>
					</template>

					<template #created_at-cell="{ row }">
						<span class="text-sm">{{ formatDate(row.original.created_at) }}</span>
					</template>

					<template #empty-actions>
						<UButton label="Organisation anlegen" color="primary" to="/admin/orgs/new" />
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
