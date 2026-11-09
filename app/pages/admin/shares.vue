<script setup lang="ts">
/**
 * Every share link of the org: what is shared, with which rights, until when, how often it was
 * opened, and who created it. Admins can revoke any link here.
 */
import type { TableColumn } from "@nuxt/ui";
import { Utils } from "~/utils";
import type { AdminShare } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Freigabelinks | Administration",
	description: "Alle Links für Menschen ohne Konto",
});

const toast = useToast();

type Row = AdminShare & { state: "active" | "expired"; place: string };

const shares = await useAPIAsyncData("admin-shares", async () => {
	const res = await useAPI((api) => api.getAdminShares({}));
	if (!res.success) {
		toast.add({
			title: "Freigabelinks konnten nicht geladen werden",
			description: res.message,
			color: "error",
		});
		return [];
	}
	return res.data;
});

const rows = computed<Row[]>(() =>
	(shares.data.value ?? []).map((share) => ({
		...share,
		state: share.expired ? "expired" : "active",
		place: share.file.event?.name ?? "Organisation",
	})),
);

const counts = computed(() => ({
	active: rows.value.filter((row) => row.state === "active").length,
	expired: rows.value.filter((row) => row.state === "expired").length,
}));

const tableFilters = computed(() => [
	{
		column: "file" as const,
		type: "text" as const,
		placeholder: "Datei oder Ordner suchen …",
		icon: "i-lucide-search",
	},
	{
		column: "state" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		icon: "i-lucide-filter",
		options: [
			{ label: `Aktiv (${counts.value.active})`, value: "active" },
			{ label: `Abgelaufen (${counts.value.expired})`, value: "expired" },
		],
	},
]);

// Active links first; expired ones on demand.
const table = useDataTableInitialFilters({ state: ["active"] });

const columns: TableColumn<Row>[] = [
	{
		id: "file",
		accessorFn: (row) => `${row.file.name} ${row.label ?? ""} ${row.place}`,
		header: "Geteilt",
	},
	{ accessorKey: "state", header: "Rechte & Schutz" },
	{ accessorKey: "expires_at", header: "Gültig bis" },
	{ accessorKey: "last_accessed_at", header: "Genutzt" },
	{ accessorKey: "created_at", header: "Erstellt" },
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
];

async function copy(url: string) {
	const ok = await Utils.copyToClipboard(url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: { title: "Kopieren nicht möglich", color: "warning" },
	);
}

const revokeTarget = ref<Row | null>(null);
const revokeOpen = computed({
	get: () => revokeTarget.value !== null,
	set: (value) => {
		if (!value) revokeTarget.value = null;
	},
});

async function onRevoke() {
	const target = revokeTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteAdminSharesByShareId({ path: { shareId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Widerrufen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Link widerrufen", icon: "i-lucide-check", color: "success" });
	await shares.refresh();
}
</script>

<template>
	<UDashboardPanel id="admin-shares">
		<template #header>
			<DashboardPageHeader
				title="Freigabelinks"
				icon="i-lucide-share-2"
				description="Links für Menschen ohne Konto – wer den Link hat, kann tun, was er erlaubt"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					ref="table"
					:data="rows"
					:columns="columns"
					:loading="shares.loading.value"
					:filters="tableFilters"
					empty-title="Keine Freigabelinks"
					empty-description="Geteilt wird in den Dokumenten über „Teilen“ im Menü einer Datei oder eines Ordners."
					empty-icon="i-lucide-share-2"
					@refresh="shares.refresh()"
				>
					<template #file-cell="{ row }">
						<NuxtLink :to="row.original.file.path" class="flex items-center gap-3 hover:underline">
							<UIcon
								:name="row.original.file.kind === 'folder' ? 'i-lucide-folder' : 'i-lucide-file'"
								:class="row.original.file.kind === 'folder' ? 'text-amber-400' : 'text-slate-400'"
								class="size-5 shrink-0"
							/>
							<span class="flex min-w-0 flex-col leading-tight">
								<span class="truncate font-medium text-white">{{ row.original.file.name }}</span>
								<span class="truncate text-xs text-slate-500">
									{{ row.original.place }}<template v-if="row.original.label"> · {{ row.original.label }}</template>
								</span>
							</span>
						</NuxtLink>
					</template>

					<template #state-cell="{ row }">
						<div class="flex flex-wrap gap-1">
							<UBadge :label="sharePermissionLabel(row.original.permissions, row.original.file.kind)" color="neutral" variant="subtle" size="sm" />
							<UBadge v-if="row.original.has_password" label="Passwort" icon="i-lucide-lock" color="neutral" variant="subtle" size="sm" />
							<UBadge v-if="row.original.expired" label="Abgelaufen" color="error" variant="soft" size="sm" />
						</div>
					</template>

					<template #expires_at-cell="{ row }">
						<span class="text-sm">{{ row.original.expires_at ? formatDate(row.original.expires_at) : "Läuft nicht ab" }}</span>
					</template>

					<template #last_accessed_at-cell="{ row }">
						<span class="text-sm">
							{{ row.original.access_count }}×
							<span v-if="row.original.last_accessed_at" class="text-slate-500">· {{ formatRelative(row.original.last_accessed_at) }}</span>
						</span>
					</template>

					<template #created_at-cell="{ row }">
						<span class="flex flex-col text-sm leading-tight">
							{{ formatDate(row.original.created_at) }}
							<span v-if="row.original.created_by" class="text-xs text-slate-500">{{ row.original.created_by.display_name }}</span>
						</span>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex justify-end gap-1">
							<UButton icon="i-lucide-copy" size="sm" color="neutral" variant="ghost" aria-label="Link kopieren" :disabled="row.original.expired" @click="copy(row.original.url)" />
							<UButton icon="i-lucide-link-2-off" size="sm" color="error" variant="ghost" aria-label="Link widerrufen" @click="revokeTarget = row.original" />
						</div>
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardDeleteModal
		v-model:open="revokeOpen"
		title="Link widerrufen"
		:warning-text="`Der Link zu „${revokeTarget?.file.name}“ funktioniert danach nicht mehr.`"
		:require-confirm-text="false"
		:on-delete="onRevoke"
	/>
</template>
