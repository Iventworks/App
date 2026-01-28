<script setup lang="ts">
interface Camp {
    id: string
    name: string
    dateRange: string
    participants: number
    maxParticipants: number
    status: 'planning' | 'active' | 'completed'
    myRole: string
}

interface Activity {
    id: number
    type: 'task' | 'chat' | 'participant' | 'document'
    title: string
    description: string
    time: Date
    camp: string
    icon: string
}

const myCamps = ref<Camp[]>([
    {
        id: '1',
        name: 'young+free Crottendorf 2026',
        dateRange: '14.-21. Februar 2026',
        participants: 42,
        maxParticipants: 50,
        status: 'planning',
        myRole: 'Freizeitleiter'
    },
    {
        id: '2',
        name: 'SkiWelt Wilder Kaiser 2025',
        dateRange: '01.-08. März 2025',
        participants: 35,
        maxParticipants: 40,
        status: 'active',
        myRole: 'Teamer'
    },
    {
        id: '3',
        name: 'Orchesterfreizeit im Kloster 2025',
        dateRange: '22.-29. August 2025',
        participants: 28,
        maxParticipants: 30,
        status: 'planning',
        myRole: 'Programmleitung'
    }
])

const recentActivities = ref<Activity[]>([
    {
        id: 1,
        type: 'task',
        title: 'Neue Aufgabe zugewiesen',
        description: 'Materialbestellung für Workshop',
        time: new Date(Date.now() - 2 * 60 * 60 * 1000),
        camp: 'young+free Crottendorf 2026',
        icon: 'i-lucide-check-circle'
    },
    {
        id: 2,
        type: 'chat',
        title: 'Neue Nachricht',
        description: 'Sarah Müller: Hast du die Programmpunkte fertig?',
        time: new Date(Date.now() - 5 * 60 * 60 * 1000),
        camp: 'young+free Crottendorf 2026',
        icon: 'i-lucide-message-circle'
    },
    {
        id: 3,
        type: 'participant',
        title: 'Neue Anmeldung',
        description: '3 neue Teilnehmer haben sich angemeldet',
        time: new Date(Date.now() - 24 * 60 * 60 * 1000),
        camp: 'SkiWelt Wilder Kaiser 2025',
        icon: 'i-lucide-user-plus'
    },
    {
        id: 4,
        type: 'document',
        title: 'Dokument hochgeladen',
        description: 'Teilnehmerliste_aktualisiert.xlsx',
        time: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        camp: 'young+free Crottendorf 2026',
        icon: 'i-lucide-file'
    }
])

const upcomingEvents = ref([
    {
        id: 1,
        title: 'Team-Meeting',
        date: new Date('2026-01-30'),
        time: '19:00',
        type: 'meeting',
        camp: 'young+free Crottendorf 2026'
    },
    {
        id: 2,
        title: 'Anmeldefrist',
        date: new Date('2026-02-05'),
        time: '23:59',
        type: 'deadline',
        camp: 'young+free Crottendorf 2026'
    },
    {
        id: 3,
        title: 'Freizeit Beginn',
        date: new Date('2026-02-14'),
        time: '16:00',
        type: 'event',
        camp: 'young+free Crottendorf 2026'
    }
])

const tasksSummary = ref({
    total: 12,
    overdue: 1,
    today: 3,
    thisWeek: 5,
    completed: 8
})

const statusConfig = {
    planning: { label: 'In Planung', color: 'warning' },
    active: { label: 'Aktiv', color: 'success' },
    completed: { label: 'Abgeschlossen', color: 'neutral' }
}

function getStatusConfig(status: Camp['status']) {
    return statusConfig[status]
}

function getParticipantsPercentage(camp: Camp) {
    return Math.round((camp.participants / camp.maxParticipants) * 100)
}

function formatTimeAgo(date: Date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    
    if (seconds < 60) return 'Gerade eben'
    if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} Min`
    if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} Std`
    return `vor ${Math.floor(seconds / 86400)} Tag${Math.floor(seconds / 86400) > 1 ? 'en' : ''}`
}

function formatEventDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function getDaysUntil(date: Date) {
    const now = new Date()
    const diff = date.getTime() - now.getTime()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    return days
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader
                title="Dashboard"
                icon="i-lucide-home"
                description="Willkommen zurück, Lukas! Hier ist Ihre Übersicht."
            />
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Quick Stats -->
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-primary-100 dark:bg-primary-900/20">
                                    <UIcon name="i-lucide-tent" class="w-6 h-6 text-primary-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ myCamps.length }}</p>
                                    <p class="text-sm text-gray-500">Aktive Freizeiten</p>
                                </div>
                            </div>
                        </UCard>

                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-green-100 dark:bg-green-900/20">
                                    <UIcon name="i-lucide-users" class="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ myCamps.reduce((sum, c) => sum + c.participants, 0) }}</p>
                                    <p class="text-sm text-gray-500">Teilnehmer gesamt</p>
                                </div>
                            </div>
                        </UCard>

                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-warning-100 dark:bg-warning-900/20">
                                    <UIcon name="i-lucide-list-checks" class="w-6 h-6 text-warning-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ tasksSummary.total }}</p>
                                    <p class="text-sm text-gray-500">Offene Aufgaben</p>
                                </div>
                            </div>
                        </UCard>

                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-red-100 dark:bg-red-900/20">
                                    <UIcon name="i-lucide-alert-circle" class="w-6 h-6 text-red-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ tasksSummary.overdue }}</p>
                                    <p class="text-sm text-gray-500">Überfällig</p>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <!-- My Camps -->
                        <div class="lg:col-span-2 space-y-4">
                            <div class="flex items-center justify-between">
                                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Meine Freizeiten</h2>
                                <UButton 
                                    to="/management/camps-and-events" 
                                    variant="ghost" 
                                    size="xs"
                                    trailing-icon="i-lucide-arrow-right"
                                >
                                    Alle anzeigen
                                </UButton>
                            </div>

                            <div class="space-y-3">
                                <UCard
                                    v-for="camp in myCamps"
                                    :key="camp.id"
                                    class="cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
                                    @click="navigateTo(`/camps-and-events/${camp.id}/overview`)"
                                >
                                    <div class="space-y-3">
                                        <div class="flex items-start justify-between">
                                            <div>
                                                <h3 class="font-semibold text-gray-900 dark:text-white mb-1">
                                                    {{ camp.name }}
                                                </h3>
                                                <div class="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                                                    <div class="flex items-center gap-1">
                                                        <UIcon name="i-lucide-calendar" class="w-3 h-3" />
                                                        {{ camp.dateRange }}
                                                    </div>
                                                    <div class="flex items-center gap-1">
                                                        <UIcon name="i-lucide-briefcase" class="w-3 h-3" />
                                                        {{ camp.myRole }}
                                                    </div>
                                                </div>
                                            </div>
                                            <UBadge
                                                :color="getStatusConfig(camp.status).color as any"
                                                variant="subtle"
                                            >
                                                {{ getStatusConfig(camp.status).label }}
                                            </UBadge>
                                        </div>

                                        <div class="space-y-1">
                                            <div class="flex items-center justify-between text-sm">
                                                <span class="text-gray-600 dark:text-gray-400">
                                                    {{ camp.participants }} / {{ camp.maxParticipants }} Teilnehmer
                                                </span>
                                                <span class="font-medium">{{ getParticipantsPercentage(camp) }}%</span>
                                            </div>
                                            <div class="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                                <div 
                                                    class="h-full rounded-full transition-all duration-300"
                                                    :class="{
                                                        'bg-warning-500': getStatusConfig(camp.status).color === 'warning',
                                                        'bg-success-500': getStatusConfig(camp.status).color === 'success',
                                                        'bg-neutral-500': getStatusConfig(camp.status).color === 'neutral'
                                                    }"
                                                    :style="{ width: `${getParticipantsPercentage(camp)}%` }"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </UCard>
                            </div>
                        </div>

                        <!-- Upcoming Events -->
                        <div class="space-y-4">
                            <div class="flex items-center justify-between">
                                <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Anstehende Termine</h2>
                                <UButton 
                                    to="/(personal)/calendar" 
                                    variant="ghost" 
                                    size="xs"
                                    trailing-icon="i-lucide-arrow-right"
                                >
                                    Kalender
                                </UButton>
                            </div>

                            <div class="space-y-2">
                                <UCard
                                    v-for="event in upcomingEvents"
                                    :key="event.id"
                                    class="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <div class="flex gap-3">
                                        <div class="shrink-0 w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/20 flex flex-col items-center justify-center">
                                            <span class="text-xs font-medium text-primary-600">
                                                {{ event.date.toLocaleDateString('de-DE', { month: 'short' }) }}
                                            </span>
                                            <span class="text-lg font-bold text-primary-600">
                                                {{ event.date.getDate() }}
                                            </span>
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <p class="font-medium text-gray-900 dark:text-white mb-1">
                                                {{ event.title }}
                                            </p>
                                            <p class="text-xs text-gray-500">
                                                {{ event.time }} • {{ event.camp }}
                                            </p>
                                            <p class="text-xs text-primary-600 mt-1">
                                                in {{ getDaysUntil(event.date) }} Tag{{ getDaysUntil(event.date) !== 1 ? 'en' : '' }}
                                            </p>
                                        </div>
                                    </div>
                                </UCard>
                            </div>
                        </div>
                    </div>

                    <!-- Recent Activity -->
                    <div class="space-y-4">
                        <div class="flex items-center justify-between">
                            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Letzte Aktivitäten</h2>
                            <UButton variant="ghost" size="xs">Alle anzeigen</UButton>
                        </div>

                        <div class="space-y-2">
                            <div
                                v-for="activity in recentActivities"
                                :key="activity.id"
                                class="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                            >
                                <div class="shrink-0 w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/20 flex items-center justify-center">
                                    <UIcon :name="activity.icon" class="w-4 h-4 text-primary-600" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <p class="font-medium text-gray-900 dark:text-white text-sm">
                                        {{ activity.title }}
                                    </p>
                                    <p class="text-sm text-gray-600 dark:text-gray-400">
                                        {{ activity.description }}
                                    </p>
                                    <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                        <span>{{ activity.camp }}</span>
                                        <span>•</span>
                                        <span>{{ formatTimeAgo(activity.time) }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Quick Actions -->
                    <UCard>
                        <div class="space-y-3">
                            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Schnellzugriff</h2>
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <UButton
                                    to="/(personal)/tasks"
                                    block
                                    variant="soft"
                                    color="primary"
                                    icon="i-lucide-list-checks"
                                >
                                    Meine Aufgaben
                                </UButton>
                                <UButton
                                    to="/(personal)/chats"
                                    block
                                    variant="soft"
                                    color="primary"
                                    icon="i-lucide-message-circle"
                                >
                                    Nachrichten
                                </UButton>
                                <UButton
                                    to="/management/database"
                                    block
                                    variant="soft"
                                    color="primary"
                                    icon="i-lucide-database"
                                >
                                    Datenbank
                                </UButton>
                                <UButton
                                    to="/management/resources"
                                    block
                                    variant="soft"
                                    color="primary"
                                    icon="i-lucide-folder"
                                >
                                    Dokumente
                                </UButton>
                            </div>
                        </div>
                    </UCard>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
