<script setup lang="ts">
interface CampEvent {
    id: number
    name: string
    type: 'freizeit' | 'seminar' | 'event' | 'schulung'
    startDate: Date
    endDate: Date
    location: string
    status: 'planung' | 'anmeldung' | 'laufend' | 'abgeschlossen'
    participants: number
    maxParticipants: number
    staff: number
    leader: string
}

const campsAndEvents = ref<CampEvent[]>([
    {
        id: 1,
        name: 'young+free Crottendorf 2026',
        type: 'freizeit',
        startDate: new Date('2026-02-15'),
        endDate: new Date('2026-02-21'),
        location: 'Crottendorf, Erzgebirge',
        status: 'anmeldung',
        participants: 45,
        maxParticipants: 80,
        staff: 15,
        leader: 'Lukas Pohl'
    },
    {
        id: 2,
        name: 'Ostercamp 2026',
        type: 'freizeit',
        startDate: new Date('2026-04-03'),
        endDate: new Date('2026-04-06'),
        location: 'Taizé, Frankreich',
        status: 'planung',
        participants: 12,
        maxParticipants: 40,
        staff: 6,
        leader: 'Sarah Müller'
    },
    {
        id: 3,
        name: 'Sommercamp 2026',
        type: 'freizeit',
        startDate: new Date('2026-07-20'),
        endDate: new Date('2026-07-27'),
        location: 'Ostsee',
        status: 'planung',
        participants: 0,
        maxParticipants: 100,
        staff: 0,
        leader: 'TBD'
    },
    {
        id: 4,
        name: 'Mitarbeiterschulung Frühjahr',
        type: 'schulung',
        startDate: new Date('2026-03-14'),
        endDate: new Date('2026-03-14'),
        location: 'Gemeindehaus Leipzig',
        status: 'anmeldung',
        participants: 22,
        maxParticipants: 30,
        staff: 3,
        leader: 'Jesko Bahlcke'
    },
    {
        id: 5,
        name: 'Worship Night',
        type: 'event',
        startDate: new Date('2026-05-15'),
        endDate: new Date('2026-05-15'),
        location: 'Stadtkirche Leipzig',
        status: 'planung',
        participants: 0,
        maxParticipants: 200,
        staff: 8,
        leader: 'Lisa Frischmuth'
    }
])

const searchQuery = ref('')
const selectedType = ref('all')
const selectedStatus = ref('all')

const filteredCamps = computed(() => {
    return campsAndEvents.value.filter(c => {
        const matchesSearch = !searchQuery.value || 
            c.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            c.location.toLowerCase().includes(searchQuery.value.toLowerCase())
        
        const matchesType = selectedType.value === 'all' || c.type === selectedType.value
        const matchesStatus = selectedStatus.value === 'all' || c.status === selectedStatus.value
        
        return matchesSearch && matchesType && matchesStatus
    })
})

const stats = computed(() => {
    const total = campsAndEvents.value.length
    const upcoming = campsAndEvents.value.filter(c => c.startDate > new Date()).length
    const active = campsAndEvents.value.filter(c => c.status === 'laufend').length
    const totalParticipants = campsAndEvents.value.reduce((sum, c) => sum + c.participants, 0)
    
    return { total, upcoming, active, totalParticipants }
})

const typeConfig = {
    freizeit: { label: 'Freizeit', color: 'primary', icon: 'i-lucide-tent' },
    seminar: { label: 'Seminar', color: 'info', icon: 'i-lucide-book-open' },
    event: { label: 'Event', color: 'success', icon: 'i-lucide-calendar-star' },
    schulung: { label: 'Schulung', color: 'warning', icon: 'i-lucide-graduation-cap' }
}

const statusConfig = {
    planung: { label: 'Planung', color: 'neutral' },
    anmeldung: { label: 'Anmeldung', color: 'primary' },
    laufend: { label: 'Laufend', color: 'success' },
    abgeschlossen: { label: 'Abgeschlossen', color: 'neutral' }
}

function getTypeConfig(type: CampEvent['type']) {
    return typeConfig[type]
}

function getStatusConfig(status: CampEvent['status']) {
    return statusConfig[status]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateRange(start: Date, end: Date) {
    if (start.toDateString() === end.toDateString()) {
        return formatDate(start)
    }
    return `${formatDate(start)} - ${formatDate(end)}`
}

function getParticipantPercentage(current: number, max: number) {
    return Math.round((current / max) * 100)
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Freizeiten & Events" 
                icon="i-lucide-calendars"
                description="Verwaltung aller Crossover Freizeiten und Veranstaltungen"
            >
                <template #actions>
                    <UButton icon="i-lucide-plus" color="primary">
                        Neue Freizeit / Event
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
                                    <UIcon name="i-lucide-calendar" class="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.total }}</p>
                                    <p class="text-sm text-gray-500">Gesamt</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-green-100 dark:bg-green-900/20">
                                    <UIcon name="i-lucide-calendar-check" class="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.upcoming }}</p>
                                    <p class="text-sm text-gray-500">Anstehend</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-orange-100 dark:bg-orange-900/20">
                                    <UIcon name="i-lucide-activity" class="w-6 h-6 text-orange-600" />
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
                                    <p class="text-2xl font-bold">{{ stats.totalParticipants }}</p>
                                    <p class="text-sm text-gray-500">Teilnehmer</p>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-col gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Suchen..."
                            size="lg"
                        />
                        
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Typ</label>
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
                                        v-for="type in (['freizeit', 'seminar', 'event', 'schulung'] as const)"
                                        :key="type"
                                        :variant="selectedType === type ? 'solid' : 'soft'"
                                        :color="selectedType === type ? getTypeConfig(type).color as any : 'neutral'"
                                        size="sm"
                                        @click="selectedType = type"
                                    >
                                        {{ getTypeConfig(type).label }}
                                    </UButton>
                                </div>
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
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
                                        v-for="status in (['planung', 'anmeldung', 'laufend', 'abgeschlossen'] as const)"
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
                        </div>
                    </div>

                    <!-- Camps List -->
                    <div class="space-y-4">
                        <UCard
                            v-for="camp in filteredCamps"
                            :key="camp.id"
                            class="hover:ring-2 hover:ring-primary-500 transition-all cursor-pointer"
                        >
                            <div class="flex items-start justify-between gap-4">
                                <div class="flex-1 space-y-3">
                                    <div class="flex items-start justify-between">
                                        <div class="flex-1">
                                            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">{{ camp.name }}</h3>
                                            <div class="flex flex-wrap items-center gap-2 mb-2">
                                                <UBadge 
                                                    :color="getTypeConfig(camp.type).color as any" 
                                                    variant="subtle"
                                                    size="xs"
                                                >
                                                    <UIcon :name="getTypeConfig(camp.type).icon" class="w-3 h-3 mr-1" />
                                                    {{ getTypeConfig(camp.type).label }}
                                                </UBadge>
                                                <UBadge 
                                                    :color="getStatusConfig(camp.status).color as any" 
                                                    variant="subtle"
                                                    size="xs"
                                                >
                                                    {{ getStatusConfig(camp.status).label }}
                                                </UBadge>
                                            </div>
                                        </div>
                                        <UDropdown
                                            :items="[
                                                [{ label: 'Zur Übersicht', icon: 'i-lucide-eye' }],
                                                [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
                                                [{ label: 'Duplizieren', icon: 'i-lucide-copy' }],
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
                                    </div>

                                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div>
                                            <p class="text-xs text-gray-500 mb-1">Zeitraum</p>
                                            <div class="flex items-center gap-1 text-sm">
                                                <UIcon name="i-lucide-calendar" class="w-4 h-4 text-gray-400" />
                                                <span>{{ formatDateRange(camp.startDate, camp.endDate) }}</span>
                                            </div>
                                        </div>
                                        <div>
                                            <p class="text-xs text-gray-500 mb-1">Ort</p>
                                            <div class="flex items-center gap-1 text-sm">
                                                <UIcon name="i-lucide-map-pin" class="w-4 h-4 text-gray-400" />
                                                <span>{{ camp.location }}</span>
                                            </div>
                                        </div>
                                        <div>
                                            <p class="text-xs text-gray-500 mb-1">Leitung</p>
                                            <div class="flex items-center gap-1 text-sm">
                                                <UIcon name="i-lucide-user" class="w-4 h-4 text-gray-400" />
                                                <span>{{ camp.leader }}</span>
                                            </div>
                                        </div>
                                        <div>
                                            <p class="text-xs text-gray-500 mb-1">Team</p>
                                            <div class="flex items-center gap-1 text-sm">
                                                <UIcon name="i-lucide-users" class="w-4 h-4 text-gray-400" />
                                                <span>{{ camp.staff }} Mitarbeiter</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div class="flex items-center justify-between mb-1 text-sm">
                                            <span class="text-gray-600 dark:text-gray-400">Teilnehmer</span>
                                            <span class="font-medium">{{ camp.participants }} / {{ camp.maxParticipants }}</span>
                                        </div>
                                        <div class="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                            <div 
                                                class="h-full rounded-full transition-all duration-300"
                                                :class="getParticipantPercentage(camp.participants, camp.maxParticipants) > 80 ? 'bg-success-500' : 'bg-primary-500'"
                                                :style="{ width: `${getParticipantPercentage(camp.participants, camp.maxParticipants)}%` }"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </UCard>

                        <div v-if="filteredCamps.length === 0" class="text-center py-12">
                            <UIcon name="i-lucide-calendar-x" class="w-12 h-12 mx-auto text-gray-400 mb-3" />
                            <p class="text-gray-500">Keine Freizeiten oder Events gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
