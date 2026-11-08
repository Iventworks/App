<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";

interface Transaction {
	id: number;
	date: Date;
	description: string;
	category: string;
	type: "income" | "expense";
	amount: number;
	status: "pending" | "completed" | "cancelled";
	relatedTo?: string;
	paymentMethod: string;
}

const transactions = ref<Transaction[]>([
	{
		id: 1,
		date: new Date("2026-01-25"),
		description: "Teilnehmerbeitrag young+free Crottendorf",
		category: "Einnahmen",
		type: "income",
		amount: 189.0,
		status: "completed",
		relatedTo: "young+free Crottendorf 2026",
		paymentMethod: "Überweisung",
	},
	{
		id: 2,
		date: new Date("2026-01-22"),
		description: "Materialbestellung Bastelmaterial",
		category: "Material",
		type: "expense",
		amount: 245.5,
		status: "completed",
		relatedTo: "young+free Crottendorf 2026",
		paymentMethod: "Rechnung",
	},
	{
		id: 3,
		date: new Date("2026-01-20"),
		description: "Unterkunft Crottendorf Anzahlung",
		category: "Unterkunft",
		type: "expense",
		amount: 1200.0,
		status: "pending",
		relatedTo: "young+free Crottendorf 2026",
		paymentMethod: "Überweisung",
	},
	{
		id: 4,
		date: new Date("2026-01-18"),
		description: "Teilnehmerbeitrag young+free Crottendorf",
		category: "Einnahmen",
		type: "income",
		amount: 189.0,
		status: "completed",
		relatedTo: "young+free Crottendorf 2026",
		paymentMethod: "PayPal",
	},
	{
		id: 5,
		date: new Date("2026-01-15"),
		description: "Verpflegung Wocheneinkauf",
		category: "Verpflegung",
		type: "expense",
		amount: 680.0,
		status: "completed",
		relatedTo: "young+free Crottendorf 2026",
		paymentMethod: "Rechnung",
	},
]);

const searchQuery = ref("");
const selectedType = ref("all");
const selectedCategory = ref("all");
const selectedStatus = ref("all");

const filteredTransactions = computed(() => {
	return transactions.value.filter((t) => {
		const matchesSearch =
			!searchQuery.value ||
			t.description.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
			(t.relatedTo && t.relatedTo.toLowerCase().includes(searchQuery.value.toLowerCase()));

		const matchesType = selectedType.value === "all" || t.type === selectedType.value;
		const matchesCategory = selectedCategory.value === "all" || t.category === selectedCategory.value;
		const matchesStatus = selectedStatus.value === "all" || t.status === selectedStatus.value;

		return matchesSearch && matchesType && matchesCategory && matchesStatus;
	});
});

const stats = computed(() => {
	const totalIncome = transactions.value
		.filter((t) => t.type === "income" && t.status === "completed")
		.reduce((sum, t) => sum + t.amount, 0);

	const totalExpense = transactions.value
		.filter((t) => t.type === "expense" && t.status === "completed")
		.reduce((sum, t) => sum + t.amount, 0);

	const balance = totalIncome - totalExpense;

	const pending = transactions.value
		.filter((t) => t.status === "pending")
		.reduce((sum, t) => sum + t.amount, 0);

	return { totalIncome, totalExpense, balance, pending };
});

const categories = computed(() => {
	const cats = [...new Set(transactions.value.map((t) => t.category))];
	return ["all", ...cats];
});

const statusConfig = {
	pending: { label: "Ausstehend", color: "orange" },
	completed: { label: "Abgeschlossen", color: "green" },
	cancelled: { label: "Storniert", color: "red" },
};

function getStatusConfig(status: Transaction["status"]) {
	return statusConfig[status];
}

function formatDate(date: Date) {
	return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatCurrency(amount: number) {
	return new Intl.NumberFormat("de-DE", {
		style: "currency",
		currency: "EUR",
	}).format(amount);
}

const columns: TableColumn<Transaction>[] = [
	{ accessorKey: "date", header: "Datum" },
	{ accessorKey: "description", header: "Beschreibung" },
	{ accessorKey: "category", header: "Kategorie" },
	{ accessorKey: "amount", header: "Betrag" },
	{ accessorKey: "status", header: "Status" },
	{ id: "actions", header: "" },
];
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Finanzen" 
                icon="i-lucide-wallet"
                description="Finanzübersicht und Transaktionsverwaltung"
            >
                <template #actions>
                    <UButton icon="i-lucide-download" variant="soft">
                        Exportieren
                    </UButton>
                    <UButton icon="i-lucide-plus" color="primary">
                        Transaktion hinzufügen
                    </UButton>
                </template>
            </DashboardPageHeader>
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Info Banner -->
                    <UAlert
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-alert-circle"
                        title="Konzeptphase"
                        description="Diese Funktion befindet sich noch in der Konzeptphase. Die hier angezeigten Daten sind Beispieldaten."
                    />

                    <!-- Stats -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <UCard>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <p class="text-sm text-gray-500">Einnahmen</p>
                                    <UIcon name="i-lucide-trending-up" class="w-4 h-4 text-green-500" />
                                </div>
                                <p class="text-2xl font-bold text-green-600">{{ formatCurrency(stats.totalIncome) }}</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <p class="text-sm text-gray-500">Ausgaben</p>
                                    <UIcon name="i-lucide-trending-down" class="w-4 h-4 text-red-500" />
                                </div>
                                <p class="text-2xl font-bold text-red-600">{{ formatCurrency(stats.totalExpense) }}</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <p class="text-sm text-gray-500">Saldo</p>
                                    <UIcon name="i-lucide-wallet" class="w-4 h-4 text-blue-500" />
                                </div>
                                <p class="text-2xl font-bold" :class="stats.balance >= 0 ? 'text-green-600' : 'text-red-600'">
                                    {{ formatCurrency(stats.balance) }}
                                </p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="space-y-2">
                                <div class="flex items-center justify-between">
                                    <p class="text-sm text-gray-500">Ausstehend</p>
                                    <UIcon name="i-lucide-clock" class="w-4 h-4 text-orange-500" />
                                </div>
                                <p class="text-2xl font-bold text-orange-600">{{ formatCurrency(stats.pending) }}</p>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-wrap items-center gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Transaktionen durchsuchen..."
                            size="lg"
                        />
                        
                        <div class="flex flex-wrap gap-2">
                            <UButton
                                :variant="selectedType === 'all' ? 'solid' : 'soft'"
                                :color="selectedType === 'all' ? 'primary' : 'neutral'"
                                size="sm"
                                @click="selectedType = 'all'"
                            >
                                Alle
                            </UButton>
                            <UButton
                                :variant="selectedType === 'income' ? 'solid' : 'soft'"
                                :color="selectedType === 'income' ? 'success' : 'neutral'"
                                size="sm"
                                @click="selectedType = 'income'"
                            >
                                Einnahmen
                            </UButton>
                            <UButton
                                :variant="selectedType === 'expense' ? 'solid' : 'soft'"
                                :color="selectedType === 'expense' ? 'error' : 'neutral'"
                                size="sm"
                                @click="selectedType = 'expense'"
                            >
                                Ausgaben
                            </UButton>
                        </div>

                        <div class="flex flex-wrap gap-2">
                            <UButton
                                :variant="selectedCategory === 'all' ? 'solid' : 'soft'"
                                :color="selectedCategory === 'all' ? 'primary' : 'neutral'"
                                size="sm"
                                @click="selectedCategory = 'all'"
                            >
                                Alle Kategorien
                            </UButton>
                            <UButton
                                v-for="cat in categories.filter(c => c !== 'all')"
                                :key="cat"
                                :variant="selectedCategory === cat ? 'solid' : 'soft'"
                                color="neutral"
                                size="sm"
                                @click="selectedCategory = cat"
                            >
                                {{ cat }}
                            </UButton>
                        </div>

                        <div class="flex flex-wrap gap-2">
                            <UButton
                                :variant="selectedStatus === 'all' ? 'solid' : 'soft'"
                                :color="selectedStatus === 'all' ? 'primary' : 'neutral'"
                                size="sm"
                                @click="selectedStatus = 'all'"
                            >
                                Alle
                            </UButton>
                            <UButton
                                v-for="status in (['pending', 'completed', 'cancelled'] as const)"
                                :key="status"
                                :variant="selectedStatus === status ? 'solid' : 'soft'"
                                :color="selectedStatus === status ? getStatusConfig(status).color as any : 'neutral'"
                                size="sm"
                                @click="selectedStatus = status"
                            >
                                {{ getStatusConfig(status).label }}
                            </UButton>
                        </div>
                    </div>

                    <!-- Transactions Table -->
                    <UCard>
                        <UTable :columns="columns" :data="filteredTransactions">

                            <template #date-cell="{ row }">
                                <span class="text-sm">{{ formatDate(row.original.date) }}</span>
                            </template>

                            <template #description-cell="{ row }">
                                <div>
                                    <p class="font-medium">{{ row.original.description }}</p>
                                    <p v-if="row.original.relatedTo" class="text-xs text-gray-500">{{ row.original.relatedTo }}</p>
                                </div>
                            </template>

                            <template #category-cell="{ row }">
                                <UBadge color="neutral" variant="subtle" size="xs">
                                    {{ row.original.category }}
                                </UBadge>
                            </template>

                            <template #amount-cell="{ row }">
                                <div class="flex items-center gap-2">
                                    <UIcon 
                                        :name="row.original.type === 'income' ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'" 
                                        :class="row.original.type === 'income' ? 'text-green-500' : 'text-red-500'"
                                        class="w-4 h-4"
                                    />
                                    <span 
                                        class="font-medium"
                                        :class="row.original.type === 'income' ? 'text-green-600' : 'text-red-600'"
                                    >
                                        {{ row.original.type === 'income' ? '+' : '-' }}{{ formatCurrency(row.original.amount) }}
                                    </span>
                                </div>
                            </template>

                            <template #status-cell="{ row }">
                                <UBadge 
                                    :color="getStatusConfig(row.original.status).color as any" 
                                    variant="subtle"
                                    size="xs"
                                >
                                    {{ getStatusConfig(row.original.status).label }}
                                </UBadge>
                            </template>

                            <template #actions-cell="{ row }">
                                <UDropdown
                                    :items="[
                                        [{ label: 'Details', icon: 'i-lucide-eye' }],
                                        [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
                                        [{ label: 'Rechnung', icon: 'i-lucide-file-text' }],
                                        [{ label: 'Löschen', icon: 'i-lucide-trash-2', class: 'text-red-500' }]
                                    ]"
                                >
                                    <UButton 
                                        icon="i-lucide-more-horizontal" 
                                        variant="ghost" 
                                        color="neutral"
                                        size="xs"
                                    />
                                </UDropdown>
                            </template>
                        </UTable>
                    </UCard>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
