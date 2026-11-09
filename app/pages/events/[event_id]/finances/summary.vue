<script setup lang="ts">
/** "Auswertung": expenses by status, by category and by person (open reimbursements). */
definePageMeta({ layout: "dashboard" });

const finances = useEventFinances();
const allowed = await finances.requireSection("expenses:view_all");
const { summary } = finances;

const statusItems = computed(() =>
	(["submitted", "approved", "reimbursed", "rejected"] as const).map((status) => ({
		label: EXPENSE_STATUS_LABELS[status],
		value: summary.value?.totals_by_status[status] ?? 0,
		tone:
			status === "rejected"
				? ("error" as const)
				: status === "reimbursed"
					? ("emerald" as const)
					: status === "submitted"
						? ("amber" as const)
						: ("primary" as const),
	})),
);

const categoryItems = computed(() =>
	(summary.value?.by_category ?? []).map((row) => ({
		label: row.category,
		value: row.amount_cents,
		hint: `${row.count}×`,
	})),
);
</script>

<template>
	<div v-if="allowed" class="space-y-6">
		<template v-if="summary">
			<div class="grid gap-6 lg:grid-cols-2">
				<DashboardSectionCard title="Nach Status" icon="i-lucide-list-checks">
					<FinanceBarList :items="statusItems" :format="formatCents" />
				</DashboardSectionCard>

				<DashboardSectionCard title="Nach Kategorie" icon="i-lucide-tags">
					<FinanceBarList :items="categoryItems" :format="formatCents" />
				</DashboardSectionCard>
			</div>

			<DashboardSectionCard
				title="Nach Person"
				description="Offene Erstattungen = genehmigt, aber noch nicht ausgezahlt"
				icon="i-lucide-users"
				flush
			>
				<p v-if="!summary.by_submitter.length" class="p-6 text-sm text-slate-500">Noch keine Ausgaben.</p>
				<ul v-else class="divide-y divide-slate-800">
					<li
						v-for="(row, index) in summary.by_submitter"
						:key="row.user?.id ?? `unknown-${index}`"
						class="flex items-center gap-3 px-6 py-3"
					>
						<UAvatar :text="initials(row.user?.display_name)" size="sm" />
						<p class="min-w-0 flex-1 truncate text-sm text-white">
							{{ row.user?.display_name ?? "Gelöschtes Konto" }}
						</p>
						<div class="text-right text-sm">
							<p class="font-medium tabular-nums text-white">{{ formatCents(row.amount_cents) }}</p>
							<p
								:class="[
									'text-xs tabular-nums',
									row.open_reimbursement_cents > 0 ? 'text-amber-400' : 'text-slate-500',
								]"
							>
								offen: {{ formatCents(row.open_reimbursement_cents) }}
							</p>
						</div>
					</li>
				</ul>
			</DashboardSectionCard>
		</template>
		<div v-else class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
		</div>
	</div>
</template>
