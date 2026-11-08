<script setup lang="ts">
interface Task {
	id: number;
	title: string;
	description: string;
	dueDate: Date;
	priority: "low" | "medium" | "high" | "urgent";
	status: "todo" | "in_progress" | "done";
	camp: string;
	category: string;
	assignedBy?: string;
}

const tasks = ref<Task[]>([
	{
		id: 1,
		title: "Materialbestellung für Workshop",
		description: "Bastelmaterial für Kreativ-Workshops bestellen",
		dueDate: new Date("2026-02-01"),
		priority: "high",
		status: "in_progress",
		camp: "young+free Crottendorf 2026",
		category: "Organisation",
		assignedBy: "Lukas Pohl",
	},
	{
		id: 2,
		title: "Teammeeting vorbereiten",
		description: "Agenda und Unterlagen für nächstes Team-Meeting zusammenstellen",
		dueDate: new Date("2026-01-30"),
		priority: "urgent",
		status: "todo",
		camp: "young+free Crottendorf 2026",
		category: "Team",
		assignedBy: "Sarah Müller",
	},
	{
		id: 3,
		title: "Teilnehmerliste aktualisieren",
		description: "Neue Anmeldungen in Liste eintragen und prüfen",
		dueDate: new Date("2026-02-03"),
		priority: "medium",
		status: "in_progress",
		camp: "young+free Crottendorf 2026",
		category: "Verwaltung",
	},
	{
		id: 4,
		title: "Programmpunkt ausarbeiten",
		description: "Detaillierte Planung für Gottesdienst am Sonntag",
		dueDate: new Date("2026-02-05"),
		priority: "high",
		status: "todo",
		camp: "young+free Crottendorf 2026",
		category: "Programm",
		assignedBy: "Jesko Bahlcke",
	},
	{
		id: 5,
		title: "Erste-Hilfe-Kurs erneuern",
		description: "Anmeldung für Auffrischungskurs",
		dueDate: new Date("2026-02-10"),
		priority: "medium",
		status: "todo",
		camp: "Allgemein",
		category: "Persönlich",
	},
	{
		id: 6,
		title: "Packliste fertigstellen",
		description: "Persönliche Packliste für Freizeit vervollständigen",
		dueDate: new Date("2026-02-12"),
		priority: "low",
		status: "done",
		camp: "young+free Crottendorf 2026",
		category: "Vorbereitung",
	},
]);

const selectedStatus = ref("all");
const selectedPriority = ref("all");
const searchQuery = ref("");

const filteredTasks = computed(() => {
	return tasks.value.filter((task) => {
		const matchesStatus = selectedStatus.value === "all" || task.status === selectedStatus.value;
		const matchesPriority =
			selectedPriority.value === "all" || task.priority === selectedPriority.value;
		const matchesSearch =
			!searchQuery.value ||
			task.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
			task.description.toLowerCase().includes(searchQuery.value.toLowerCase());

		return matchesStatus && matchesPriority && matchesSearch;
	});
});

const taskStats = computed(() => {
	const total = tasks.value.length;
	const todo = tasks.value.filter((t) => t.status === "todo").length;
	const inProgress = tasks.value.filter((t) => t.status === "in_progress").length;
	const done = tasks.value.filter((t) => t.status === "done").length;
	const urgent = tasks.value.filter((t) => t.priority === "urgent" && t.status !== "done").length;
	const overdue = tasks.value.filter((t) => t.dueDate < new Date() && t.status !== "done").length;

	return { total, todo, inProgress, done, urgent, overdue };
});

const priorityConfig = {
	low: { label: "Niedrig", color: "neutral", icon: "i-lucide-arrow-down" },
	medium: { label: "Mittel", color: "primary", icon: "i-lucide-minus" },
	high: { label: "Hoch", color: "warning", icon: "i-lucide-arrow-up" },
	urgent: { label: "Dringend", color: "error", icon: "i-lucide-alert-circle" },
};

const statusConfig = {
	todo: { label: "Zu erledigen", color: "neutral", icon: "i-lucide-circle" },
	in_progress: { label: "In Bearbeitung", color: "primary", icon: "i-lucide-loader" },
	done: { label: "Erledigt", color: "success", icon: "i-lucide-check-circle" },
};

function getPriorityConfig(priority: Task["priority"]) {
	return priorityConfig[priority];
}

function getStatusConfig(status: Task["status"]) {
	return statusConfig[status];
}

function formatDate(date: Date) {
	return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isOverdue(task: Task) {
	return task.status !== "done" && task.dueDate < new Date();
}

function getDaysUntil(date: Date) {
	const now = new Date();
	const diff = date.getTime() - now.getTime();
	const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
	return days;
}

function toggleTaskStatus(task: Task) {
	if (task.status === "done") {
		task.status = "todo";
	} else if (task.status === "todo") {
		task.status = "in_progress";
	} else {
		task.status = "done";
	}
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader
                title="Meine Aufgaben"
                icon="i-lucide-list-checks"
                description="Übersicht Ihrer persönlichen Aufgaben und Todos"
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
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
                                <p class="text-2xl font-bold text-primary-500">{{ taskStats.inProgress }}</p>
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
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-orange-500">{{ taskStats.overdue }}</p>
                                <p class="text-sm text-gray-500">Überfällig</p>
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
                                        :color="selectedStatus === 'todo' ? 'neutral' : 'neutral'"
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
                                        :color="selectedStatus === 'done' ? 'success' : 'neutral'"
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
                                        v-for="prio in (['urgent', 'high', 'medium', 'low'] as const)"
                                        :key="prio"
                                        :variant="selectedPriority === prio ? 'solid' : 'soft'"
                                        :color="selectedPriority === prio ? getPriorityConfig(prio).color as any : 'neutral'"
                                        size="sm"
                                        @click="selectedPriority = prio"
                                    >
                                        {{ getPriorityConfig(prio).label }}
                                    </UButton>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tasks List -->
                    <div class="space-y-3">
                        <div
                            v-for="task in filteredTasks"
                            :key="task.id"
                            class="group p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 transition-all bg-white dark:bg-gray-900"
                            :class="{ 'ring-2 ring-red-500': isOverdue(task) }"
                        >
                            <div class="flex items-start gap-4">
                                <div class="shrink-0 pt-1">
                                    <UCheckbox 
                                        :model-value="task.status === 'done'" 
                                        @update:model-value="toggleTaskStatus(task)"
                                    />
                                </div>

                                <div class="flex-1 min-w-0">
                                    <div class="flex items-start justify-between gap-3 mb-2">
                                        <div class="flex-1">
                                            <div class="flex flex-wrap items-center gap-2 mb-1">
                                                <h3 
                                                    class="font-semibold text-gray-900 dark:text-white"
                                                    :class="{ 'line-through text-gray-500': task.status === 'done' }"
                                                >
                                                    {{ task.title }}
                                                </h3>
                                                <UBadge
                                                    :color="getPriorityConfig(task.priority).color as any"
                                                    variant="subtle"
                                                    size="xs"
                                                >
                                                    <UIcon :name="getPriorityConfig(task.priority).icon" class="w-3 h-3 mr-1" />
                                                    {{ getPriorityConfig(task.priority).label }}
                                                </UBadge>
                                                <UBadge
                                                    :color="getStatusConfig(task.status).color as any"
                                                    variant="subtle"
                                                    size="xs"
                                                >
                                                    <UIcon :name="getStatusConfig(task.status).icon" class="w-3 h-3 mr-1" />
                                                    {{ getStatusConfig(task.status).label }}
                                                </UBadge>
                                            </div>
                                            <p class="text-sm text-gray-600 dark:text-gray-400">{{ task.description }}</p>
                                        </div>
                                        <UDropdown
                                            :items="[
                                                [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
                                                [{ label: 'Status ändern', icon: 'i-lucide-check-circle' }],
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

                                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-calendar" class="w-3 h-3" />
                                            <span :class="isOverdue(task) ? 'text-red-500 font-semibold' : ''">
                                                {{ formatDate(task.dueDate) }}
                                                <span v-if="!isOverdue(task) && task.status !== 'done'">
                                                    (in {{ getDaysUntil(task.dueDate) }}d)
                                                </span>
                                                <span v-if="isOverdue(task)" class="ml-1">
                                                    (Überfällig!)
                                                </span>
                                            </span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-tent" class="w-3 h-3" />
                                            <span>{{ task.camp }}</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-folder" class="w-3 h-3" />
                                            <span>{{ task.category }}</span>
                                        </div>
                                        <div v-if="task.assignedBy" class="flex items-center gap-1">
                                            <UIcon name="i-lucide-user" class="w-3 h-3" />
                                            <span>von {{ task.assignedBy }}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div v-if="filteredTasks.length === 0" class="text-center py-12">
                            <UIcon name="i-lucide-check-circle" class="w-12 h-12 mx-auto text-green-400 mb-3" />
                            <p class="text-gray-500">Keine Aufgaben gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>