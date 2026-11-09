<script setup lang="ts">
/** "Budget": total budget, planned income/expenses and plan vs. approved costs per category. */
definePageMeta({ layout: "dashboard" });

const finances = useEventFinances();
const allowed = await finances.requireSection("budget:view");
const { can, eventId, budget, openCreateBudgetItem, openEditBudgetItem, openDeleteBudgetItem } =
	finances;

const plannedActualRows = computed(() =>
	(budget.value?.by_category ?? []).map((row) => ({
		label: row.category,
		planned: row.planned_cents,
		actual: row.actual_cents,
	})),
);

const budgetItemsByKind = computed(() => ({
	expense: (budget.value?.items ?? []).filter((item) => item.kind === "expense"),
	income: (budget.value?.items ?? []).filter((item) => item.kind === "income"),
}));
</script>

<template>
	<div v-if="allowed" class="space-y-6">
		<template v-if="budget">
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<DashboardStatCard label="Gesamtbudget" :value="formatCents(budget.budget_cents)" icon="i-lucide-wallet" />
				<DashboardStatCard
					label="Ausgegeben"
					:value="formatCents(budget.actual_expense_cents)"
					hint="genehmigt + erstattet"
					icon="i-lucide-shopping-cart"
					icon-color="amber"
				/>
				<DashboardStatCard
					label="Eingereicht, ungeprüft"
					:value="formatCents(budget.pending_expense_cents)"
					icon="i-lucide-hourglass"
					icon-color="neutral"
				/>
				<DashboardStatCard
					label="Verbleibend"
					:value="formatCents(budget.remaining_cents)"
					:icon="budget.remaining_cents < 0 ? 'i-lucide-triangle-alert' : 'i-lucide-piggy-bank'"
					:icon-color="budget.remaining_cents < 0 ? 'error' : 'emerald'"
				/>
			</div>

			<UAlert
				v-if="budget.budget_cents === 0"
				icon="i-lucide-info"
				color="neutral"
				variant="subtle"
				title="Noch kein Gesamtbudget festgelegt"
				:description="
					can('event:edit')
						? 'Das Gesamtbudget legst du in den Event-Einstellungen fest.'
						: 'Das Gesamtbudget legt die Leitung in den Event-Einstellungen fest.'
				"
				:actions="
					can('event:edit')
						? [{ label: 'Zu den Einstellungen', to: `/events/${eventId}/settings`, color: 'neutral', variant: 'outline' }]
						: []
				"
			/>

			<div class="grid gap-6 lg:grid-cols-2">
				<DashboardSectionCard
					title="Plan vs. Ausgaben"
					description="Je Kategorie: geplante Ausgaben und tatsächlich genehmigte Kosten"
					icon="i-lucide-chart-bar-big"
				>
					<FinancePlannedActualList :rows="plannedActualRows" />
				</DashboardSectionCard>

				<DashboardSectionCard
					title="Planung"
					:description="`Ausgaben ${formatCents(budget.planned_expense_cents)} · Einnahmen ${formatCents(budget.planned_income_cents)}`"
					icon="i-lucide-clipboard-list"
					flush
				>
					<template v-if="can('budget:manage')" #actions>
						<UButton label="Budgetposten" icon="i-lucide-plus" size="sm" @click="openCreateBudgetItem" />
					</template>

					<p v-if="!budget.items.length" class="p-6 text-sm text-slate-500">Noch keine Budgetposten geplant.</p>
					<div v-else class="divide-y divide-slate-800">
						<template v-for="kind in (['expense', 'income'] as const)" :key="kind">
							<div v-if="budgetItemsByKind[kind].length" class="px-6 py-3">
								<p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
									{{ kind === "expense" ? "Geplante Ausgaben" : "Geplante Einnahmen" }}
								</p>
								<ul class="space-y-1">
									<li
										v-for="item in budgetItemsByKind[kind]"
										:key="item.id"
										class="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-800/40"
									>
										<div class="min-w-0 flex-1">
											<p class="text-sm text-white">{{ item.category }}</p>
											<p v-if="item.description" class="truncate text-xs text-slate-500">
												{{ item.description }}
											</p>
										</div>
										<span
											:class="[
												'text-sm font-medium tabular-nums',
												kind === 'income' ? 'text-emerald-400' : 'text-white',
											]"
										>
											{{ kind === "income" ? "+" : "" }}{{ formatCents(item.planned_cents) }}
										</span>
										<div v-if="can('budget:manage')" class="flex gap-1">
											<UButton
												icon="i-lucide-pencil"
												color="neutral"
												variant="ghost"
												size="xs"
												aria-label="Bearbeiten"
												@click="openEditBudgetItem(item)"
											/>
											<UButton
												icon="i-lucide-trash-2"
												color="error"
												variant="ghost"
												size="xs"
												aria-label="Löschen"
												@click="openDeleteBudgetItem(item)"
											/>
										</div>
									</li>
								</ul>
							</div>
						</template>
					</div>
				</DashboardSectionCard>
			</div>
		</template>
		<div v-else class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
		</div>
	</div>
</template>
