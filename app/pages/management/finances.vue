<script setup lang="ts">
interface Transaction {
    id: number
    date: Date
    description: string
    category: string
    type: 'income' | 'expense'
    amount: number
    status: 'pending' | 'completed' | 'cancelled'
    relatedTo?: string
    paymentMethod: string
}

const transactions = ref<Transaction[]>([
    {
        id: 1,
        date: new Date('2026-01-25'),
        description: 'Teilnehmerbeitrag young+free Crottendorf',
        category: 'Einnahmen',
        type: 'income',
        amount: 189.00,
        status: 'completed',
        relatedTo: 'young+free Crottendorf 2026',
        paymentMethod: 'Überweisung'
    },
    {
        id: 2,
        date: new Date('2026-01-22'),
        description: 'Materialbestellung Bastelmaterial',
        category: 'Material',
        type: 'expense',
        amount: 245.50,
        status: 'completed',
        relatedTo: 'young+free Crottendorf 2026',
        paymentMethod: 'Rechnung'
    },
    {
        id: 3,
        date: new Date('2026-01-20'),
        description: 'Unterkunft Crottendorf Anzahlung',
        category: 'Unterkunft',
        type: 'expense',
        amount: 1200.00,
        status: 'pending',
        relatedTo: 'young+free Crottendorf 2026',
        paymentMethod: 'Überweisung'
    },
    {
        id: 4,
        date: new Date('2026-01-18'),
        description: 'Teilnehmerbeitrag young+free Crottendorf',
        category: 'Einnahmen',
        type: 'income',
        amount: 189.00,
        status: 'completed',
        relatedTo: 'young+free Crottendorf 2026',
        paymentMethod: 'PayPal'
    },
    {
        id: 5,
        date: new Date('2026-01-15'),
        description: 'Verpflegung Wocheneinkauf',
        category: 'Verpflegung',
        type: 'expense',
        amount: 680.00,
        status: 'completed',
        relatedTo: 'young+free Crottendorf 2026',
        paymentMethod: 'Rechnung'
    }
])

const searchQuery = ref('')
const selectedType = ref('all')
const selectedCategory = ref('all')
const selectedStatus = ref('all')

const filteredTransactions = computed(() => {
    return transactions.value.filter(t => {
        const matchesSearch = !searchQuery.value || 
            t.description.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            (t.relatedTo && t.relatedTo.toLowerCase().includes(searchQuery.value.toLowerCase()))
        
        const matchesType = selectedType.value === 'all' || t.type === selectedType.value
        const matchesCategory = selectedCategory.value === 'all' || t.category === selectedCategory.value
        const matchesStatus = selectedStatus.value === 'all' || t.status === selectedStatus.value
        
        return matchesSearch && matchesType && matchesCategory && matchesStatus
    })
})

const stats = computed(() => {
    const totalIncome = transactions.value
        .filter(t => t.type === 'income' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0)
    
    const totalExpense = transactions.value
        .filter(t => t.type === 'expense' && t.status === 'completed')
        .reduce((sum, t) => sum + t.amount, 0)
    
    const balance = totalIncome - totalExpense
    
    const pending = transactions.value
        .filter(t => t.status === 'pending')
        .reduce((sum, t) => sum + t.amount, 0)
    
    return { totalIncome, totalExpense, balance, pending }
})

const categories = computed(() => {
    const cats = [...new Set(transactions.value.map(t => t.category))]
    return ['all', ...cats]
})

const statusConfig = {
    pending: { label: 'Ausstehend', color: 'orange' },
    completed: { label: 'Abgeschlossen', color: 'green' },
    cancelled: { label: 'Storniert', color: 'red' }
}

function getStatusConfig(status: Transaction['status']) {
    return statusConfig[status]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatCurrency(amount: number) {
    return new Intl.NumberFormat('de-DE', { 
        style: 'currency', 
        currency: 'EUR' 
    }).format(amount)
}

const columns = [
    { key: 'date', label: 'Datum' },
    { key: 'description', label: 'Beschreibung' },
    { key: 'category', label: 'Kategorie' },
    { key: 'amount', label: 'Betrag' },
    { key: 'status', label: 'Status' },
    { key: 'actions', label: '' }
]
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
                            class="w-64"
                        />
                        
                        <USelectMenu
                            v-model="selectedType"
                            :options="['all', 'income', 'expense']"
                            class="w-40"
                        >
                            <template #label>
                                <span v-if="selectedType === 'all'">Alle Typen</span>
                                <span v-else-if="selectedType === 'income'">Einnahmen</span>
                                <span v-else>Ausgaben</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Typen</span>
                                <span v-else-if="option === 'income'">Einnahmen</span>
                                <span v-else>Ausgaben</span>
                            </template>
                        </USelectMenu>

                        <USelectMenu
                            v-model="selectedCategory"
                            :options="categories"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedCategory === 'all'">Alle Kategorien</span>
                                <span v-else>{{ selectedCategory }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Kategorien</span>
                                <span v-else>{{ option }}</span>
                            </template>
                        </USelectMenu>

                        <USelectMenu
                            v-model="selectedStatus"
                            :options="['all', 'pending', 'completed', 'cancelled']"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedStatus === 'all'">Alle Status</span>
                                <span v-else>{{ getStatusConfig(selectedStatus as Transaction['status']).label }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Status</span>
                                <span v-else>{{ getStatusConfig(option as Transaction['status']).label }}</span>
                            </template>
                        </USelectMenu>
                    </div>

                    <!-- Transactions Table -->
                    <UCard>
                        <UTable :columns="columns" :rows="filteredTransactions">
                            <template #date-data="{ row }">
                                <span class="text-sm">{{ formatDate(row.date) }}</span>
                            </template>

                            <template #description-data="{ row }">
                                <div>
                                    <p class="font-medium">{{ row.description }}</p>
                                    <p v-if="row.relatedTo" class="text-xs text-gray-500">{{ row.relatedTo }}</p>
                                </div>
                            </template>

                            <template #category-data="{ row }">
                                <UBadge color="neutral" variant="subtle" size="xs">
                                    {{ row.category }}
                                </UBadge>
                            </template>

                            <template #amount-data="{ row }">
                                <div class="flex items-center gap-2">
                                    <UIcon 
                                        :name="row.type === 'income' ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'" 
                                        :class="row.type === 'income' ? 'text-green-500' : 'text-red-500'"
                                        class="w-4 h-4"
                                    />
                                    <span 
                                        class="font-medium"
                                        :class="row.type === 'income' ? 'text-green-600' : 'text-red-600'"
                                    >
                                        {{ row.type === 'income' ? '+' : '-' }}{{ formatCurrency(row.amount) }}
                                    </span>
                                </div>
                            </template>

                            <template #status-data="{ row }">
                                <UBadge 
                                    :color="getStatusConfig(row.status).color" 
                                    variant="subtle"
                                    size="xs"
                                >
                                    {{ getStatusConfig(row.status).label }}
                                </UBadge>
                            </template>

                            <template #actions-data="{ row }">
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
                                        color="gray"
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
