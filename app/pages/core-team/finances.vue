<script setup lang="ts">
/** Kernteam finances: budgets, planned and actual spending of every event, per year. */
import type { TableColumn } from "@nuxt/ui";
import type { GetOrgCoreTeamFinancesResponses } from "~/api-client";

type Finances = GetOrgCoreTeamFinancesResponses["200"]["data"];
type EventFinances = Finances["per_event"][number];
type Row = EventFinances & { name: string; remaining_cents: number };

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Finanzen | Kernteam | CMP" });

const toast = useToast();
const year = ref<number | null>(new Date().getFullYear());

const {
	data: finances,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-finances", async () => {
	const result = await useAPI((api) =>
		api.getOrgCoreTeamFinances({ query: year.value ? { year: year.value } : {} }),
	);
	if (!result.success) {
		toast.add({
			title: "Finanzen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data as Finances;
});

watch(year, () => refresh());

const rows = computed<Row[]>(() =>
	(finances.value?.per_event ?? []).map((entry) => ({
		...entry,
		name: entry.event.name,
		remaining_cents: entry.budget_cents - entry.actual_expense_cents,
	})),
);

const remainingTotal = computed(() =>
	finances.value
		? finances.value.totals.budget_cents - finances.value.totals.actual_expense_cents
		: 0,
);

const columns: TableColumn<Row>[] = [
	{ accessorKey: "name", header: "Event" },
	{ accessorKey: "budget_cents", header: "Budget" },
	{ accessorKey: "planned_expense_cents", header: "Geplant" },
	{ accessorKey: "expected_fees_cents", header: "Beiträge (erw.)" },
	{ accessorKey: "actual_expense_cents", header: "Ausgegeben" },
	{ accessorKey: "pending_expense_cents", header: "Ungeprüft" },
	{ accessorKey: "reimbursed_cents", header: "Erstattet" },
	{ accessorKey: "remaining_cents", header: "Verbleibend" },
];

const filters = [{ column: "name" as const, type: "text" as const, placeholder: "Event suchen …" }];
</script>

<template>
	<UDashboardPanel id="core-team-finances">
		<template #header>
			<DashboardPageHeader title="Finanzen" icon="i-lucide-wallet" description="Alle Events im Überblick">
				<template #right>
					<FinanceYearSelect v-model="year" />
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="!finances" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<template v-else>
					<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<DashboardStatCard
							label="Budget gesamt"
							:value="formatCents(finances.totals.budget_cents)"
							:hint="`geplant: ${formatCents(finances.totals.planned_expense_cents)}`"
							icon="i-lucide-wallet"
						/>
						<DashboardStatCard
							label="Ausgegeben"
							:value="formatCents(finances.totals.actual_expense_cents)"
							:hint="`davon erstattet: ${formatCents(finances.totals.reimbursed_cents)}`"
							icon="i-lucide-shopping-cart"
							icon-color="amber"
						/>
						<DashboardStatCard
							label="Ungeprüfte Belege"
							:value="formatCents(finances.totals.pending_expense_cents)"
							icon="i-lucide-hourglass"
							icon-color="neutral"
						/>
						<DashboardStatCard
							label="Erwartete Einnahmen"
							:value="formatCents(finances.totals.expected_fees_cents + finances.totals.planned_income_cents)"
							:hint="`Beiträge ${formatCents(finances.totals.expected_fees_cents)} · sonstige ${formatCents(finances.totals.planned_income_cents)}`"
							icon="i-lucide-trending-up"
							icon-color="emerald"
						/>
					</div>

					<UAlert
						v-if="remainingTotal < 0"
						icon="i-lucide-triangle-alert"
						color="error"
						variant="subtle"
						title="Budget überschritten"
						:description="`Über alle Events wurde ${formatCents(-remainingTotal)} mehr ausgegeben als budgetiert.`"
					/>

					<DashboardDataTable
						:data="rows"
						:columns="columns"
						:loading="loading"
						:filters="filters"
						:show-page-size-selector="false"
						empty-title="Keine Events"
						:empty-description="year ? `Für ${year} gibt es keine Events.` : 'Es gibt noch keine Events.'"
						empty-icon="i-lucide-wallet"
						@refresh="refresh"
					>
						<template #name-cell="{ row }">
							<NuxtLink
								:to="`/events/${row.original.event.id}/finances?tab=budget`"
								class="block min-w-40 hover:text-primary-400"
							>
								<span class="block font-medium text-white">{{ row.original.event.name }}</span>
								<span class="text-xs text-slate-500">
									{{ formatDay(row.original.event.start_date) }} ·
									{{ EVENT_STATUS_LABELS[row.original.event.status] }}
								</span>
							</NuxtLink>
						</template>
						<template #budget_cents-cell="{ row }">
							<span class="tabular-nums">{{ formatCents(row.original.budget_cents) }}</span>
						</template>
						<template #planned_expense_cents-cell="{ row }">
							<span class="tabular-nums text-slate-300">{{ formatCents(row.original.planned_expense_cents) }}</span>
						</template>
						<template #expected_fees_cents-cell="{ row }">
							<span class="tabular-nums text-emerald-400">{{ formatCents(row.original.expected_fees_cents) }}</span>
						</template>
						<template #actual_expense_cents-cell="{ row }">
							<span class="tabular-nums font-medium text-white">{{ formatCents(row.original.actual_expense_cents) }}</span>
						</template>
						<template #pending_expense_cents-cell="{ row }">
							<span
								:class="[
									'tabular-nums',
									row.original.pending_expense_cents ? 'text-amber-400' : 'text-slate-500',
								]"
							>
								{{ formatCents(row.original.pending_expense_cents) }}
							</span>
						</template>
						<template #reimbursed_cents-cell="{ row }">
							<span class="tabular-nums text-slate-300">{{ formatCents(row.original.reimbursed_cents) }}</span>
						</template>
						<template #remaining_cents-cell="{ row }">
							<span
								:class="[
									'tabular-nums font-medium',
									row.original.remaining_cents < 0 ? 'text-red-400' : 'text-emerald-400',
								]"
							>
								{{ formatCents(row.original.remaining_cents) }}
							</span>
						</template>
					</DashboardDataTable>

					<div class="grid gap-6 lg:grid-cols-2">
						<DashboardSectionCard
							title="Ausgaben nach Kategorie"
							description="Genehmigte und erstattete Ausgaben"
							icon="i-lucide-tags"
						>
							<FinanceBarList
								:items="finances.by_category.map((c) => ({ label: c.category, value: c.actual_cents }))"
								:format="formatCents"
								empty-text="Noch keine genehmigten Ausgaben."
							/>
						</DashboardSectionCard>

						<DashboardSectionCard title="Budgetauslastung je Event" icon="i-lucide-gauge">
							<FinancePlannedActualList
								:rows="
									rows
										.filter((row) => row.budget_cents > 0 || row.actual_expense_cents > 0)
										.map((row) => ({ label: row.name, planned: row.budget_cents, actual: row.actual_expense_cents }))
								"
								empty-text="Noch keine Budgets festgelegt."
							/>
						</DashboardSectionCard>
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
