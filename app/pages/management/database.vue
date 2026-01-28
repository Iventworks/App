<script setup lang="ts">
interface Contact {
    id: number
    firstName: string
    lastName: string
    email: string
    phone: string
    category: 'teilnehmer' | 'mitarbeiter' | 'eltern' | 'externe' | 'andere'
    tags: string[]
    lastContact: Date
    notes: string
    status: 'aktiv' | 'inaktiv' | 'archiviert'
}

const contacts = ref<Contact[]>([
    {
        id: 1,
        firstName: 'Anna',
        lastName: 'Schmidt',
        email: 'anna.schmidt@example.com',
        phone: '+49 151 12345678',
        category: 'teilnehmer',
        tags: ['young+free', 'Crottendorf 2026'],
        lastContact: new Date('2026-01-25'),
        notes: 'Vegetarisch, war bereits 2x dabei',
        status: 'aktiv'
    },
    {
        id: 2,
        firstName: 'Lukas',
        lastName: 'Pohl',
        email: 'l.pohl@crossover.info',
        phone: '+49 151 11111111',
        category: 'mitarbeiter',
        tags: ['Leitung', 'Kernteam'],
        lastContact: new Date('2026-01-28'),
        notes: 'Freizeitleiter, Juleica',
        status: 'aktiv'
    },
    {
        id: 3,
        firstName: 'Maria',
        lastName: 'Schmidt',
        email: 'maria.schmidt@example.com',
        phone: '+49 151 98765432',
        category: 'eltern',
        tags: ['Notfallkontakt Anna Schmidt'],
        lastContact: new Date('2026-01-15'),
        notes: 'Mutter von Anna Schmidt',
        status: 'aktiv'
    },
    {
        id: 4,
        firstName: 'Sarah',
        lastName: 'Müller',
        email: 's.mueller@crossover.info',
        phone: '+49 152 22222222',
        category: 'mitarbeiter',
        tags: ['Teamer', 'Erste Hilfe'],
        lastContact: new Date('2026-01-27'),
        notes: 'Organisation, 3 Jahre Erfahrung',
        status: 'aktiv'
    },
    {
        id: 5,
        firstName: 'Thomas',
        lastName: 'Weber',
        email: 'thomas.weber@extern.de',
        phone: '+49 160 55555555',
        category: 'externe',
        tags: ['Speaker', 'Referent'],
        lastContact: new Date('2025-12-10'),
        notes: 'Externer Speaker für Seminare',
        status: 'aktiv'
    }
])

const searchQuery = ref('')
const selectedCategory = ref('all')
const selectedStatus = ref('all')

const filteredContacts = computed(() => {
    return contacts.value.filter(c => {
        const matchesSearch = !searchQuery.value || 
            `${c.firstName} ${c.lastName}`.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            c.email.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            c.tags.some(tag => tag.toLowerCase().includes(searchQuery.value.toLowerCase()))
        
        const matchesCategory = selectedCategory.value === 'all' || c.category === selectedCategory.value
        const matchesStatus = selectedStatus.value === 'all' || c.status === selectedStatus.value
        
        return matchesSearch && matchesCategory && matchesStatus
    })
})

const stats = computed(() => {
    const total = contacts.value.length
    const active = contacts.value.filter(c => c.status === 'aktiv').length
    const participants = contacts.value.filter(c => c.category === 'teilnehmer').length
    const staff = contacts.value.filter(c => c.category === 'mitarbeiter').length
    
    return { total, active, participants, staff }
})

const categoryConfig = {
    teilnehmer: { label: 'Teilnehmer', color: 'blue', icon: 'i-lucide-user' },
    mitarbeiter: { label: 'Mitarbeiter', color: 'purple', icon: 'i-lucide-user-check' },
    eltern: { label: 'Eltern', color: 'green', icon: 'i-lucide-users' },
    externe: { label: 'Externe', color: 'orange', icon: 'i-lucide-user-plus' },
    andere: { label: 'Andere', color: 'gray', icon: 'i-lucide-user-circle' }
}

const statusConfig = {
    aktiv: { label: 'Aktiv', color: 'green' },
    inaktiv: { label: 'Inaktiv', color: 'gray' },
    archiviert: { label: 'Archiviert', color: 'neutral' }
}

function getCategoryConfig(category: Contact['category']) {
    return categoryConfig[category]
}

function getStatusConfig(status: Contact['status']) {
    return statusConfig[status]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const columns = [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Kategorie' },
    { key: 'contact', label: 'Kontakt' },
    { key: 'tags', label: 'Tags' },
    { key: 'lastContact', label: 'Letzter Kontakt' },
    { key: 'status', label: 'Status' },
    { key: 'actions', label: '' }
]
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Datenbank" 
                icon="i-lucide-database"
                description="Zentrale Kontakt- und Personendatenbank"
            >
                <template #actions>
                    <UButton icon="i-lucide-download" variant="soft">
                        Exportieren
                    </UButton>
                    <UButton icon="i-lucide-user-plus" color="primary">
                        Kontakt hinzufügen
                    </UButton>
                </template>
            </DashboardPageHeader>
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Stats -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                                    <UIcon name="i-lucide-database" class="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.total }}</p>
                                    <p class="text-sm text-gray-500">Kontakte</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-green-100 dark:bg-green-900/20">
                                    <UIcon name="i-lucide-user-check" class="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.active }}</p>
                                    <p class="text-sm text-gray-500">Aktiv</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                                    <UIcon name="i-lucide-users" class="w-6 h-6 text-purple-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.participants }}</p>
                                    <p class="text-sm text-gray-500">Teilnehmer</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-orange-100 dark:bg-orange-900/20">
                                    <UIcon name="i-lucide-user-cog" class="w-6 h-6 text-orange-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.staff }}</p>
                                    <p class="text-sm text-gray-500">Mitarbeiter</p>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-wrap items-center gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Kontakte durchsuchen..."
                            class="w-64"
                        />
                        
                        <USelectMenu
                            v-model="selectedCategory"
                            :options="['all', 'teilnehmer', 'mitarbeiter', 'eltern', 'externe', 'andere']"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedCategory === 'all'">Alle Kategorien</span>
                                <span v-else>{{ getCategoryConfig(selectedCategory as Contact['category']).label }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Kategorien</span>
                                <span v-else>{{ getCategoryConfig(option as Contact['category']).label }}</span>
                            </template>
                        </USelectMenu>

                        <USelectMenu
                            v-model="selectedStatus"
                            :options="['all', 'aktiv', 'inaktiv', 'archiviert']"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedStatus === 'all'">Alle Status</span>
                                <span v-else>{{ getStatusConfig(selectedStatus as Contact['status']).label }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Status</span>
                                <span v-else>{{ getStatusConfig(option as Contact['status']).label }}</span>
                            </template>
                        </USelectMenu>
                    </div>

                    <!-- Contacts Table -->
                    <UCard>
                        <UTable :columns="columns" :rows="filteredContacts">
                            <template #name-data="{ row }">
                                <div class="flex items-center gap-3">
                                    <UAvatar :alt="`${row.firstName} ${row.lastName}`" size="sm" />
                                    <div>
                                        <p class="font-medium">{{ row.firstName }} {{ row.lastName }}</p>
                                    </div>
                                </div>
                            </template>

                            <template #category-data="{ row }">
                                <UBadge 
                                    :color="getCategoryConfig(row.category).color" 
                                    variant="subtle"
                                    size="xs"
                                >
                                    <UIcon :name="getCategoryConfig(row.category).icon" class="w-3 h-3 mr-1" />
                                    {{ getCategoryConfig(row.category).label }}
                                </UBadge>
                            </template>

                            <template #contact-data="{ row }">
                                <div class="text-sm space-y-1">
                                    <div class="flex items-center gap-1">
                                        <UIcon name="i-lucide-mail" class="w-3 h-3 text-gray-400" />
                                        <span>{{ row.email }}</span>
                                    </div>
                                    <div class="flex items-center gap-1">
                                        <UIcon name="i-lucide-phone" class="w-3 h-3 text-gray-400" />
                                        <span>{{ row.phone }}</span>
                                    </div>
                                </div>
                            </template>

                            <template #tags-data="{ row }">
                                <div class="flex flex-wrap gap-1">
                                    <UBadge 
                                        v-for="tag in row.tags" 
                                        :key="tag"
                                        color="neutral" 
                                        variant="subtle"
                                        size="xs"
                                    >
                                        {{ tag }}
                                    </UBadge>
                                </div>
                            </template>

                            <template #lastContact-data="{ row }">
                                <span class="text-sm">{{ formatDate(row.lastContact) }}</span>
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
                                        [{ label: 'Details anzeigen', icon: 'i-lucide-eye' }],
                                        [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
                                        [{ label: 'E-Mail senden', icon: 'i-lucide-mail' }],
                                        [{ label: 'Notizen', icon: 'i-lucide-file-text' }],
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
