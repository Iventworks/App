<script setup lang="ts">
const route = useRoute();
const campId = computed(() => route.params.id as string);

// Mock data für Camp/Event Übersicht
const campData = ref({
	id: 1,
	name: "young+free Crottendorf 2026",
	type: "Winterfreizeit",
	status: "in_planung",
	startDate: new Date("2026-02-15"),
	endDate: new Date("2026-02-21"),
	location: "Crottendorf, Erzgebirge",
	description:
		"Die young+free Winterfreizeit findet vom 15. bis 21. Februar 2026 in Crottendorf im Erzgebirge statt. Eine Woche voller Action, Gemeinschaft und geistlichem Input.",
	maxParticipants: 80,
	currentParticipants: 45,
	ageRange: "15-18 Jahre",
	price: "189 €",
	registrationDeadline: new Date("2026-02-01"),
	teamLeader: "Jesko Bahlcke",
	teamLeaderEmail: "j.bahlcke@crossoverskul.info",
});

const stats = computed(() => [
	{
		label: "Teilnehmer",
		value: campData.value.currentParticipants,
		icon: "i-lucide-users",
		color: "primary" as const,
		description: `von ${campData.value.maxParticipants} Plätzen`,
		trend: "+12 diese Woche",
	},
	{
		label: "Mitarbeiter",
		value: 15,
		icon: "i-lucide-user-check",
		color: "success" as const,
		description: "davon 8 Teamer",
		trend: "3 neue Zusagen",
	},
	{
		label: "Offene Aufgaben",
		value: 8,
		icon: "i-lucide-list-checks",
		color: "warning" as const,
		description: "von 24 gesamt",
		trend: "5 erledigt heute",
	},
	{
		label: "Budget",
		value: "85%",
		icon: "i-lucide-wallet",
		color: "info" as const,
		description: "ausgelastet",
		trend: "Im Plan",
	},
]);

const recentActivity = ref([
	{
		id: 1,
		user: "Sarah Müller",
		action: "hat die Teilnehmerliste aktualisiert",
		timestamp: new Date(Date.now() - 1000 * 60 * 15),
		icon: "i-lucide-users",
	},
	{
		id: 2,
		user: "Lukas Pohl",
		action: "hat eine neue Aufgabe erstellt: Materialbestellung",
		timestamp: new Date(Date.now() - 1000 * 60 * 45),
		icon: "i-lucide-plus-circle",
	},
	{
		id: 3,
		user: "Lisa Frischmuth",
		action: "hat das Programm für Samstag aktualisiert",
		timestamp: new Date(Date.now() - 1000 * 60 * 120),
		icon: "i-lucide-calendar",
	},
	{
		id: 4,
		user: "Jesko Bahlcke",
		action: "hat eine Datei hochgeladen: Packliste_2026.pdf",
		timestamp: new Date(Date.now() - 1000 * 60 * 180),
		icon: "i-lucide-file-up",
	},
]);

const upcomingMilestones = ref([
	{
		id: 1,
		title: "Anmeldeschluss",
		date: new Date("2026-02-01"),
		description: "Letzte Möglichkeit zur Anmeldung",
		status: "upcoming" as const,
	},
	{
		id: 2,
		title: "Team-Vorbesprechung",
		date: new Date("2026-02-08"),
		description: "Finales Planungstreffen mit allen Mitarbeitern",
		status: "upcoming" as const,
	},
	{
		id: 3,
		title: "Freizeit-Beginn",
		date: new Date("2026-02-15"),
		description: "Anreise und Check-In",
		status: "upcoming" as const,
	},
]);

function formatDate(date: Date) {
	return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(date: Date) {
	return date.toLocaleDateString("de-DE", {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function getStatusColor(status: string) {
	const colors = {
		in_planung: "warning",
		anmeldung_offen: "info",
		laufend: "success",
		abgeschlossen: "neutral",
	} as const;
	return colors[status as keyof typeof colors] || "neutral";
}

function getStatusLabel(status: string) {
	const labels = {
		in_planung: "In Planung",
		anmeldung_offen: "Anmeldung offen",
		laufend: "Laufend",
		abgeschlossen: "Abgeschlossen",
	};
	return labels[status as keyof typeof labels] || status;
}

function getDaysUntil(date: Date) {
	const now = new Date();
	const diff = date.getTime() - now.getTime();
	const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
	return days;
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                :title="campData.name" 
                icon="i-lucide-tent"
                :description="`${campData.type} • ${formatDate(campData.startDate)} - ${formatDate(campData.endDate)}`"
            >
                <template #actions>
                    <UBadge :color="getStatusColor(campData.status) as any" variant="subtle" size="md">
                        {{ getStatusLabel(campData.status) }}
                    </UBadge>
                </template>
            </DashboardPageHeader>
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Stats Cards -->
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <UCard v-for="stat in stats" :key="stat.label">
                            <div class="flex items-start justify-between">
                                <div class="space-y-1">
                                    <p class="text-sm text-gray-500 dark:text-gray-400">{{ stat.label }}</p>
                                    <p class="text-2xl font-bold">{{ stat.value }}</p>
                                    <p class="text-xs text-gray-500">{{ stat.description }}</p>
                                </div>
                                <UIcon :name="stat.icon" :class="`text-${stat.color}-500 w-8 h-8`" />
                            </div>
                            <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                <p class="text-xs text-gray-600 dark:text-gray-400">{{ stat.trend }}</p>
                            </div>
                        </UCard>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <!-- Camp Details -->
                        <div class="lg:col-span-2 space-y-6">
                            <UCard>
                                <template #header>
                                    <h3 class="text-lg font-semibold">Details zur Freizeit</h3>
                                </template>
                                <div class="space-y-4">
                                    <div>
                                        <h4 class="font-medium mb-2">Beschreibung</h4>
                                        <p class="text-gray-600 dark:text-gray-400">{{ campData.description }}</p>
                                    </div>

                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <p class="text-sm text-gray-500">Ort</p>
                                            <p class="font-medium">{{ campData.location }}</p>
                                        </div>
                                        <div>
                                            <p class="text-sm text-gray-500">Altersgruppe</p>
                                            <p class="font-medium">{{ campData.ageRange }}</p>
                                        </div>
                                        <div>
                                            <p class="text-sm text-gray-500">Preis</p>
                                            <p class="font-medium">{{ campData.price }}</p>
                                        </div>
                                        <div>
                                            <p class="text-sm text-gray-500">Anmeldeschluss</p>
                                            <p class="font-medium">{{ formatDate(campData.registrationDeadline) }}</p>
                                        </div>
                                    </div>

                                    <UDivider />

                                    <div>
                                        <h4 class="font-medium mb-2">Freizeitleitung</h4>
                                        <div class="flex items-center gap-3">
                                            <UAvatar src="https://i.pravatar.cc/150?img=12" :alt="campData.teamLeader" size="md" />
                                            <div>
                                                <p class="font-medium">{{ campData.teamLeader }}</p>
                                                <p class="text-sm text-gray-500">{{ campData.teamLeaderEmail }}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </UCard>

                            <!-- Recent Activity -->
                            <UCard>
                                <template #header>
                                    <h3 class="text-lg font-semibold">Letzte Aktivitäten</h3>
                                </template>
                                <div class="space-y-4">
                                    <div v-for="activity in recentActivity" :key="activity.id" class="flex items-start gap-3">
                                        <div class="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                                            <UIcon :name="activity.icon" class="w-4 h-4" />
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <p class="text-sm">
                                                <span class="font-medium">{{ activity.user }}</span>
                                                <span class="text-gray-600 dark:text-gray-400"> {{ activity.action }}</span>
                                            </p>
                                            <p class="text-xs text-gray-500 mt-1">{{ formatDateTime(activity.timestamp) }}</p>
                                        </div>
                                    </div>
                                </div>
                            </UCard>
                        </div>

                        <!-- Sidebar -->
                        <div class="space-y-6">
                            <!-- Upcoming Milestones -->
                            <UCard>
                                <template #header>
                                    <h3 class="text-lg font-semibold">Anstehende Meilensteine</h3>
                                </template>
                                <div class="space-y-4">
                                    <div v-for="milestone in upcomingMilestones" :key="milestone.id" 
                                         class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                                        <div class="flex items-start justify-between mb-1">
                                            <p class="font-medium text-sm">{{ milestone.title }}</p>
                                            <UBadge color="primary" variant="subtle" size="xs">
                                                in {{ getDaysUntil(milestone.date) }}d
                                            </UBadge>
                                        </div>
                                        <p class="text-xs text-gray-500 mb-1">{{ formatDate(milestone.date) }}</p>
                                        <p class="text-xs text-gray-600 dark:text-gray-400">{{ milestone.description }}</p>
                                    </div>
                                </div>
                            </UCard>

                            <!-- Quick Actions -->
                            <UCard>
                                <template #header>
                                    <h3 class="text-lg font-semibold">Schnellaktionen</h3>
                                </template>
                                <div class="space-y-2">
                                    <UButton 
                                        block 
                                        color="primary" 
                                        variant="soft"
                                        icon="i-lucide-user-plus"
                                    >
                                        Teilnehmer hinzufügen
                                    </UButton>
                                    <UButton 
                                        block 
                                        color="primary" 
                                        variant="soft"
                                        icon="i-lucide-calendar-plus"
                                    >
                                        Programmpunkt erstellen
                                    </UButton>
                                    <UButton 
                                        block 
                                        color="primary" 
                                        variant="soft"
                                        icon="i-lucide-plus-circle"
                                    >
                                        Aufgabe erstellen
                                    </UButton>
                                    <UButton 
                                        block 
                                        color="primary" 
                                        variant="soft"
                                        icon="i-lucide-file-up"
                                    >
                                        Dokument hochladen
                                    </UButton>
                                </div>
                            </UCard>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
