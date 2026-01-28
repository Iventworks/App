<script setup lang="ts">
const route = useRoute()
const campId = computed(() => route.params.id as string)

interface Task {
    id: number
    title: string
    description: string
    assignee: string
    dueDate: Date
    priority: 'low' | 'medium' | 'high' | 'urgent'
    status: 'todo' | 'in_progress' | 'done'
    category: string
}

const tasks = ref<Task[]>([
    {
        id: 1,
        title: 'Materialbestellung abschließen',
        description: 'Bastelmaterial für Workshops bestellen',
        assignee: 'Lisa Frischmuth',
        dueDate: new Date('2026-02-01'),
        priority: 'high',
        status: 'in_progress',
        category: 'Material'
    },
    {
        id: 2,
        title: 'Teilnehmerliste finalisieren',
        description: 'Alle Anmeldungen prüfen und Liste erstellen',
        assignee: 'Sarah Müller',
        dueDate: new Date('2026-02-05'),
        priority: 'urgent',
        status: 'done',
        category: 'Organisation'
    },
    {
        id: 3,
        title: 'Gottesdienstablauf planen',
        description: 'Detaillierte Planung der Gottesdienste',
        assignee: 'Jesko Bahlcke',
        dueDate: new Date('2026-02-08'),
        priority: 'high',
        status: 'in_progress',
        category: 'Programm'
    },
    {
        id: 4,
        title: 'Teamschulungsunterlagen vorbereiten',
        description: 'Materialien für Mitarbeiterschulung zusammenstellen',
        assignee: 'Lukas Pohl',
        dueDate: new Date('2026-02-07'),
        priority: 'medium',
        status: 'todo',
        category: 'Team'
    },
    {
        id: 5,
        title: 'Verpflegungsplan erstellen',
        description: 'Menüplan für die gesamte Woche erstellen',
        assignee: 'Küchenteam',
        dueDate: new Date('2026-02-03'),
        priority: 'medium',
        status: 'in_progress',
        category: 'Verpflegung'
    },
    {
        id: 6,
        title: 'Notfallkontakte aktualisieren',
        description: 'Liste aller Notfallkontakte aktualisieren',
        assignee: 'Sarah Müller',
        dueDate: new Date('2026-02-10'),
        priority: 'high',
        status: 'todo',
        category: 'Organisation'
    },
    {
        id: 7,
        title: 'Packliste veröffentlichen',
        description: 'Packliste an alle Teilnehmer versenden',
        assignee: 'Miriam Lohrey',
        dueDate: new Date('2026-01-30'),
        priority: 'medium',
        status: 'done',
        category: 'Kommunikation'
    },
    {
        id: 8,
        title: 'Spiele und Materialien prüfen',
        description: 'Inventur der vorhandenen Spiele und Materialien',
        assignee: 'Lisa Frischmuth',
        dueDate: new Date('2026-02-01'),
        priority: 'low',
        status: 'todo',
        category: 'Material'
    }
])

const selectedStatus = ref<string>('all')
const selectedPriority = ref<string>('all')
const searchQuery = ref('')

const filteredTasks = computed(() => {
    return tasks.value.filter(task => {
        const matchesStatus = selectedStatus.value === 'all' || task.status === selectedStatus.value
        const matchesPriority = selectedPriority.value === 'all' || task.priority === selectedPriority.value
        const matchesSearch = !searchQuery.value || 
            task.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            task.description.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            task.assignee.toLowerCase().includes(searchQuery.value.toLowerCase())
        
        return matchesStatus && matchesPriority && matchesSearch
    })
})

const taskStats = computed(() => {
    const total = tasks.value.length
    const done = tasks.value.filter(t => t.status === 'done').length
    const inProgress = tasks.value.filter(t => t.status === 'in_progress').length
    const todo = tasks.value.filter(t => t.status === 'todo').length
    const urgent = tasks.value.filter(t => t.priority === 'urgent' && t.status !== 'done').length
    
    return { total, done, inProgress, todo, urgent }
})

const priorityConfig = {
    low: { label: 'Niedrig', color: 'neutral', icon: 'i-lucide-arrow-down' },
    medium: { label: 'Mittel', color: 'primary', icon: 'i-lucide-minus' },
    high: { label: 'Hoch', color: 'warning', icon: 'i-lucide-arrow-up' },
    urgent: { label: 'Dringend', color: 'error', icon: 'i-lucide-alert-circle' }
}

const statusConfig = {
    todo: { label: 'Zu erledigen', color: 'neutral', icon: 'i-lucide-circle' },
    in_progress: { label: 'In Bearbeitung', color: 'primary', icon: 'i-lucide-loader' },
    done: { label: 'Erledigt', color: 'success', icon: 'i-lucide-check-circle' }
}

function getPriorityConfig(priority: Task['priority']) {
    return priorityConfig[priority]
}

function getStatusConfig(status: Task['status']) {
    return statusConfig[status]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function isOverdue(task: Task) {
    return task.status !== 'done' && task.dueDate < new Date()
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
                title="Aufgaben" 
                icon="i-lucide-list-checks"
                description="Aufgabenverwaltung für young+free Crottendorf 2026"
            >
                <template #actions>
                    <UButton icon="i-lucide-plus" color="primary">
                        Neue Aufgabe
                    </UButton>
                </template>
            </DashboardPageHeader>
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Stats -->
                    <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ taskStats.total }}</p>
                                <p class="text-sm text-gray-500">Gesamt</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-gray-500">{{ taskStats.todo }}</p>
                                <p class="text-sm text-gray-500">Offen</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-blue-500">{{ taskStats.inProgress }}</p>
                                <p class="text-sm text-gray-500">In Arbeit</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-green-500">{{ taskStats.done }}</p>
                                <p class="text-sm text-gray-500">Erledigt</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-red-500">{{ taskStats.urgent }}</p>
                                <p class="text-sm text-gray-500">Dringend</p>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-col gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Aufgaben durchsuchen..."
                            size="lg"
                        />
                        
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                                        :variant="selectedStatus === 'todo' ? 'solid' : 'soft'"
                                        :color="selectedStatus === 'todo' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedStatus = 'todo'"
                                    >
                                        Offen
                                    </UButton>
                                    <UButton
                                        :variant="selectedStatus === 'in_progress' ? 'solid' : 'soft'"
                                        :color="selectedStatus === 'in_progress' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedStatus = 'in_progress'"
                                    >
                                        In Arbeit
                                    </UButton>
                                    <UButton
                                        :variant="selectedStatus === 'done' ? 'solid' : 'soft'"
                                        :color="selectedStatus === 'done' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedStatus = 'done'"
                                    >
                                        Erledigt
                                    </UButton>
                                </div>
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Priorität</label>
                                <div class="flex flex-wrap gap-2">
                                    <UButton
                                        :variant="selectedPriority === 'all' ? 'solid' : 'soft'"
                                        :color="selectedPriority === 'all' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedPriority = 'all'"
                                    >
                                        Alle
                                    </UButton>
                                    <UButton
                                        :variant="selectedPriority === 'urgent' ? 'solid' : 'soft'"
                                        :color="selectedPriority === 'urgent' ? 'error' : 'neutral'"
                                        size="sm"
                                        @click="selectedPriority = 'urgent'"
                                    >
                                        Dringend
                                    </UButton>
                                    <UButton
                                        :variant="selectedPriority === 'high' ? 'solid' : 'soft'"
                                        :color="selectedPriority === 'high' ? 'warning' : 'neutral'"
                                        size="sm"
                                        @click="selectedPriority = 'high'"
                                    >
                                        Hoch
                                    </UButton>
                                    <UButton
                                        :variant="selectedPriority === 'medium' ? 'solid' : 'soft'"
                                        :color="selectedPriority === 'medium' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedPriority = 'medium'"
                                    >
                                        Mittel
                                    </UButton>
                                    <UButton
                                        :variant="selectedPriority === 'low' ? 'solid' : 'soft'"
                                        :color="selectedPriority === 'low' ? 'neutral' : 'neutral'"
                                        size="sm"
                                        @click="selectedPriority = 'low'"
                                    >
                                        Niedrig
                                    </UButton>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tasks List -->
                    <div class="space-y-3">
                        <UCard
                            v-for="task in filteredTasks"
                            :key="task.id"
                            class="hover:ring-2 hover:ring-primary-500 transition-all cursor-pointer"
                            :class="{ 'ring-2 ring-red-500': isOverdue(task) }"
                        >
                            <div class="flex items-start gap-4">
                                <div class="shrink-0 pt-1">
                                    <UCheckbox :model-value="task.status === 'done'" />
                                </div>

                                <div class="flex-1 min-w-0">
                                    <div class="flex items-start justify-between gap-3 mb-2">
                                        <div class="flex-1">
                                            <h3 class="font-semibold text-gray-900 dark:text-white mb-1"
                                                :class="{ 'line-through text-gray-500': task.status === 'done' }">
                                                {{ task.title }}
                                            </h3>
                                            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">{{ task.description }}</p>
                                        </div>
                                        <UDropdown
                                            :items="[
                                                [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
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

                                    <div class="flex flex-wrap items-center gap-3 text-sm">
                                        <UBadge
                                            :color="getStatusConfig(task.status).color as any"
                                            variant="subtle"
                                            size="xs"
                                        >
                                            <UIcon :name="getStatusConfig(task.status).icon" class="w-3 h-3 mr-1" />
                                            {{ getStatusConfig(task.status).label }}
                                        </UBadge>

                                        <UBadge
                                            :color="getPriorityConfig(task.priority).color as any"
                                            variant="subtle"
                                            size="xs"
                                        >
                                            <UIcon :name="getPriorityConfig(task.priority).icon" class="w-3 h-3 mr-1" />
                                            {{ getPriorityConfig(task.priority).label }}
                                        </UBadge>

                                        <div class="flex items-center gap-1 text-gray-500">
                                            <UIcon name="i-lucide-user" class="w-3 h-3" />
                                            <span>{{ task.assignee }}</span>
                                        </div>

                                        <div class="flex items-center gap-1"
                                             :class="isOverdue(task) ? 'text-red-500' : 'text-gray-500'">
                                            <UIcon name="i-lucide-calendar" class="w-3 h-3" />
                                            <span>{{ formatDate(task.dueDate) }}</span>
                                            <span v-if="!isOverdue(task) && task.status !== 'done'" class="text-xs">
                                                (in {{ getDaysUntil(task.dueDate) }}d)
                                            </span>
                                            <span v-if="isOverdue(task)" class="text-xs font-semibold">
                                                (Überfällig!)
                                            </span>
                                        </div>

                                        <UBadge color="neutral" variant="subtle" size="xs">
                                            {{ task.category }}
                                        </UBadge>
                                    </div>
                                </div>
                            </div>
                        </UCard>

                        <div v-if="filteredTasks.length === 0" class="text-center py-12">
                            <UIcon name="i-lucide-inbox" class="w-12 h-12 mx-auto text-gray-400 mb-3" />
                            <p class="text-gray-500">Keine Aufgaben gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
