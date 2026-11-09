<script setup lang="ts">
/**
 * System dashboard: the custom domains of every org. Without self-service
 * (`IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE`), a domain an org admin added waits here for approval:
 * add it to the reverse proxy, then approve it. Everything else per domain lives on the org's page.
 */
import type { TableColumn } from "@nuxt/ui";
import type { SystemDomain } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Domains", description: "Eigene Domains aller Organisationen" });

const toast = useToast();

type DomainState = "approval" | "dns" | "active";
type Row = SystemDomain & { state: DomainState };

const STATE_LABELS: Record<DomainState, string> = {
	approval: "Freigabe ausstehend",
	dns: "DNS ausstehend",
	active: "Aktiv",
};

const domains = await useAPIAsyncData("system-domains", async () => {
	const res = await useAPI((api) => api.getSystemDomains({}));
	if (!res.success) {
		toast.add({
			title: "Domains konnten nicht geladen werden",
			description: res.message,
			color: "error",
		});
		return [];
	}
	return res.data;
});

const rows = computed<Row[]>(() =>
	(domains.data.value ?? []).map((domain) => ({
		...domain,
		// Waiting for approval also covers domains whose DNS isn't verified yet: approval can come first.
		state: domain.active ? "active" : !domain.approved ? "approval" : "dns",
	})),
);

const counts = computed(() => {
	const result: Record<DomainState, number> = { approval: 0, dns: 0, active: 0 };
	for (const row of rows.value) result[row.state]++;
	return result;
});

const tableFilters = computed(() => [
	{
		column: "domain" as const,
		type: "text" as const,
		placeholder: "Domain suchen …",
		icon: "i-lucide-search",
	},
	{
		column: "state" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		icon: "i-lucide-filter",
		options: (["approval", "dns", "active"] as DomainState[]).map((value) => ({
			label: `${STATE_LABELS[value]} (${counts.value[value]})`,
			value,
		})),
	},
]);

// What waits for a system admin first; the filter shows the rest on demand.
const table = useDataTableInitialFilters({ state: ["approval"] });

const columns: TableColumn<Row>[] = [
	{ accessorKey: "domain", header: "Domain" },
	{ accessorKey: "org", header: "Organisation" },
	{ accessorKey: "state", header: "Status" },
	{ accessorKey: "created_at", header: "Hinzugefügt" },
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
];

const approving = ref<number | null>(null);
async function approve(row: Row) {
	approving.value = row.id;
	const result = await useAPI((api) =>
		api.postSystemOrgsByOrgIdDomainsByDomainIdApproval({
			path: { orgId: row.org.id, domainId: row.id },
		}),
	);
	approving.value = null;
	if (!result.success) {
		toast.add({ title: "Freigabe fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: `${row.domain} freigegeben`,
		description: result.data.active
			? "Die Domain ist jetzt aktiv."
			: "Sie wird aktiv, sobald die DNS-Prüfung klappt.",
		icon: "i-lucide-check",
		color: "success",
	});
	await domains.refresh();
}
</script>

<template>
	<UDashboardPanel id="system-domains">
		<template #header>
			<DashboardPageHeader
				title="Domains"
				icon="i-lucide-globe"
				description="Eigene Domains aller Organisationen – erst im Reverse Proxy einrichten, dann freigeben"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					ref="table"
					:data="rows"
					:columns="columns"
					:loading="domains.loading.value"
					:filters="tableFilters"
					empty-title="Keine Domains"
					empty-description="Hier erscheinen die eigenen Domains der Organisationen."
					empty-icon="i-lucide-globe"
					@refresh="domains.refresh()"
				>
					<template #domain-cell="{ row }">
						<div class="flex items-center gap-2">
							<span class="font-mono text-sm text-white">{{ row.original.domain }}</span>
							<UBadge v-if="row.original.is_primary" label="Hauptdomain" color="primary" variant="subtle" size="sm" />
						</div>
					</template>

					<template #org-cell="{ row }">
						<NuxtLink :to="`/admin/orgs/${row.original.org.id}/domains`" class="hover:underline">
							{{ row.original.org.display_name }}
							<span class="font-mono text-xs text-slate-500">{{ row.original.org.slug }}</span>
						</NuxtLink>
					</template>

					<template #state-cell="{ row }">
						<OrgDomainStatus :domain="row.original" />
					</template>

					<template #created_at-cell="{ row }">
						<span class="text-sm">{{ formatDate(row.original.created_at) }}</span>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex justify-end gap-1">
							<UButton
								v-if="!row.original.approved"
								label="Freigeben"
								icon="i-lucide-shield-check"
								size="sm"
								color="primary"
								variant="subtle"
								:loading="approving === row.original.id"
								@click="approve(row.original)"
							/>
							<UButton
								:to="`/admin/orgs/${row.original.org.id}/domains`"
								label="Verwalten"
								icon="i-lucide-arrow-right"
								size="sm"
								color="neutral"
								variant="ghost"
							/>
						</div>
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
