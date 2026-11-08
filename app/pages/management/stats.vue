<script setup lang="ts">
interface StatItem {
	label: string;
	value: number;
	change: number;
	trend: "up" | "down" | "stable";
	icon: string;
}

const yearlyStats = ref<StatItem[]>([
	{
		label: "Gesamte Teilnehmer",
		value: 287,
		change: 23,
		trend: "up",
		icon: "i-lucide-users",
	},
	{
		label: "Veranstaltungen",
		value: 12,
		change: 3,
		trend: "up",
		icon: "i-lucide-calendar",
	},
	{
		label: "Aktive Mitarbeiter",
		value: 45,
		change: 8,
		trend: "up",
		icon: "i-lucide-user-check",
	},
	{
		label: "Freizeittage",
		value: 68,
		change: -5,
		trend: "down",
		icon: "i-lucide-calendar-days",
	},
]);

const monthlyParticipants = ref([
	{ month: "Jan", count: 0 },
	{ month: "Feb", count: 45 },
	{ month: "Mär", count: 12 },
	{ month: "Apr", count: 28 },
	{ month: "Mai", count: 0 },
	{ month: "Jun", count: 0 },
	{ month: "Jul", count: 85 },
	{ month: "Aug", count: 42 },
	{ month: "Sep", count: 0 },
	{ month: "Okt", count: 35 },
	{ month: "Nov", count: 25 },
	{ month: "Dez", count: 15 },
]);

const topEvents = ref([
	{
		id: 1,
		name: "Sommercamp 2025",
		participants: 85,
		satisfaction: 4.8,
		status: "abgeschlossen",
	},
	{
		id: 2,
		name: "young+free Crottendorf 2026",
		participants: 45,
		satisfaction: 0,
		status: "geplant",
	},
	{
		id: 3,
		name: "Ostercamp 2025",
		participants: 42,
		satisfaction: 4.6,
		status: "abgeschlossen",
	},
	{
		id: 4,
		name: "Herbstfreizeit 2025",
		participants: 35,
		satisfaction: 4.7,
		status: "abgeschlossen",
	},
]);

const ageDistribution = ref([
	{ range: "13-14", count: 45 },
	{ range: "15-16", count: 98 },
	{ range: "17-18", count: 87 },
	{ range: "19+", count: 57 },
]);

const categoryDistribution = ref([
	{ category: "Freizeiten", count: 8, percentage: 67 },
	{ category: "Events", count: 2, percentage: 17 },
	{ category: "Schulungen", count: 2, percentage: 16 },
]);

function getTrendIcon(trend: string) {
	const icons = {
		up: "i-lucide-trending-up",
		down: "i-lucide-trending-down",
		stable: "i-lucide-minus",
	};
	return icons[trend as keyof typeof icons];
}

function getTrendColor(trend: string) {
	const colors = {
		up: "text-green-500",
		down: "text-red-500",
		stable: "text-gray-500",
	};
	return colors[trend as keyof typeof colors];
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Statistiken" 
                icon="i-lucide-chart-bar"
                description="Auswertungen und Kennzahlen für Crossover Aktivitäten"
            >
                <template #actions>
                    <UButton icon="i-lucide-download" variant="soft">
                        Bericht exportieren
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

                    <!-- Yearly Stats -->
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <UCard v-for="stat in yearlyStats" :key="stat.label">
                            <div class="space-y-3">
                                <div class="flex items-center justify-between">
                                    <p class="text-sm text-gray-500">{{ stat.label }}</p>
                                    <UIcon :name="stat.icon" class="w-5 h-5 text-gray-400" />
                                </div>
                                <p class="text-3xl font-bold text-gray-900 dark:text-white">{{ stat.value }}</p>
                                <div class="flex items-center gap-2 text-sm">
                                    <UIcon :name="getTrendIcon(stat.trend)" :class="getTrendColor(stat.trend)" class="w-4 h-4" />
                                    <span :class="getTrendColor(stat.trend)">
                                        {{ stat.trend === 'up' ? '+' : stat.trend === 'down' ? '-' : '' }}{{ Math.abs(stat.change) }}
                                    </span>
                                    <span class="text-gray-500">vs. Vorjahr</span>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <!-- Monthly Participants Chart -->
                        <UCard>
                            <template #header>
                                <h3 class="text-lg font-semibold">Teilnehmer pro Monat</h3>
                            </template>
                            <div class="space-y-3">
                                <div v-for="item in monthlyParticipants" :key="item.month" class="flex items-center gap-3">
                                    <span class="font-medium text-sm w-8">{{ item.month }}</span>
                                    <div class="flex-1 h-8 bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden">
                                        <div 
                                            class="h-full bg-primary-500 rounded-md transition-all duration-300"
                                            :style="{ width: `${(item.count / 85) * 100}%` }"
                                        />
                                    </div>
                                    <span class="text-sm text-gray-500 w-8 text-right">{{ item.count }}</span>
                                </div>
                            </div>
                        </UCard>

                        <!-- Top Events -->
                        <UCard>
                            <template #header>
                                <h3 class="text-lg font-semibold">Top Veranstaltungen</h3>
                            </template>
                            <div class="space-y-4">
                                <div v-for="event in topEvents" :key="event.id" class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                                    <div class="flex-1">
                                        <p class="font-medium text-sm">{{ event.name }}</p>
                                        <div class="flex items-center gap-3 mt-1">
                                            <div class="flex items-center gap-1 text-xs text-gray-500">
                                                <UIcon name="i-lucide-users" class="w-3 h-3" />
                                                <span>{{ event.participants }}</span>
                                            </div>
                                            <div v-if="event.satisfaction > 0" class="flex items-center gap-1 text-xs text-gray-500">
                                                <UIcon name="i-lucide-star" class="w-3 h-3" />
                                                <span>{{ event.satisfaction }}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <UBadge 
                                        :color="event.status === 'abgeschlossen' ? 'success' : 'primary'" 
                                        variant="subtle"
                                        size="xs"
                                    >
                                        {{ event.status }}
                                    </UBadge>
                                </div>
                            </div>
                        </UCard>

                        <!-- Age Distribution -->
                        <UCard>
                            <template #header>
                                <h3 class="text-lg font-semibold">Altersverteilung</h3>
                            </template>
                            <div class="space-y-3">
                                <div v-for="item in ageDistribution" :key="item.range" class="flex items-center gap-3">
                                    <span class="font-medium text-sm w-16">{{ item.range }}</span>
                                    <div class="flex-1 h-8 bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden">
                                        <div 
                                            class="h-full bg-primary-500 rounded-md transition-all duration-300"
                                            :style="{ width: `${(item.count / 287) * 100}%` }"
                                        />
                                    </div>
                                    <span class="text-sm text-gray-500 w-24 text-right">{{ item.count }} ({{ Math.round((item.count / 287) * 100) }}%)</span>
                                </div>
                            </div>
                        </UCard>

                        <!-- Category Distribution -->
                        <UCard>
                            <template #header>
                                <h3 class="text-lg font-semibold">Veranstaltungstypen</h3>
                            </template>
                            <div class="space-y-3">
                                <div v-for="item in categoryDistribution" :key="item.category" class="flex items-center gap-3">
                                    <span class="font-medium text-sm w-24">{{ item.category }}</span>
                                    <div class="flex-1 h-8 bg-gray-100 dark:bg-gray-800 rounded-md overflow-hidden">
                                        <div 
                                            class="h-full bg-primary-500 rounded-md transition-all duration-300"
                                            :style="{ width: `${item.percentage}%` }"
                                        />
                                    </div>
                                    <span class="text-sm text-gray-500 w-16 text-right">{{ item.count }} ({{ item.percentage }}%)</span>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Additional Insights -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <UCard>
                            <div class="text-center py-4">
                                <UIcon name="i-lucide-award" class="w-8 h-8 mx-auto text-yellow-500 mb-2" />
                                <p class="text-2xl font-bold text-gray-900 dark:text-white">4.7</p>
                                <p class="text-sm text-gray-500 mt-1">Durchschnittliche Bewertung</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center py-4">
                                <UIcon name="i-lucide-repeat" class="w-8 h-8 mx-auto text-blue-500 mb-2" />
                                <p class="text-2xl font-bold text-gray-900 dark:text-white">73%</p>
                                <p class="text-sm text-gray-500 mt-1">Wiederteilnehmer-Quote</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center py-4">
                                <UIcon name="i-lucide-clock" class="w-8 h-8 mx-auto text-green-500 mb-2" />
                                <p class="text-2xl font-bold text-gray-900 dark:text-white">6.2</p>
                                <p class="text-sm text-gray-500 mt-1">Ø Tage pro Freizeit</p>
                            </div>
                        </UCard>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
