<script setup lang="ts">
const route = useRoute();
const campId = computed(() => route.params.id as string);

type ProgramCategory = "workshop" | "sport" | "worship" | "freetime" | "meal" | "other";

interface ProgramItem {
	id: number;
	day: string;
	time: string;
	title: string;
	description: string;
	location: string;
	responsible: string;
	category: ProgramCategory;
	duration: number; // in minutes
}

const programItems = ref<ProgramItem[]>([
	{
		id: 1,
		day: "Samstag, 15.02.2026",
		time: "14:00",
		title: "Anreise & Check-In",
		description: "Ankunft der Teilnehmer, Zimmerverteilung",
		location: "Haupteingang",
		responsible: "Lukas Pohl",
		category: "other",
		duration: 120,
	},
	{
		id: 2,
		day: "Samstag, 15.02.2026",
		time: "16:00",
		title: "Kennenlernspiele",
		description: "Gemeinsame Spiele zum Kennenlernen",
		location: "Sporthalle",
		responsible: "Sarah Müller",
		category: "sport",
		duration: 90,
	},
	{
		id: 3,
		day: "Samstag, 15.02.2026",
		time: "18:00",
		title: "Abendessen",
		description: "Gemeinsames Abendessen",
		location: "Speisesaal",
		responsible: "Küchenteam",
		category: "meal",
		duration: 60,
	},
	{
		id: 4,
		day: "Samstag, 15.02.2026",
		time: "19:30",
		title: "Eröffnungsgottesdienst",
		description: "Gemeinsamer Start in die Freizeit mit Lobpreis und Andacht",
		location: "Kapelle",
		responsible: "Jesko Bahlcke",
		category: "worship",
		duration: 90,
	},
	{
		id: 5,
		day: "Sonntag, 16.02.2026",
		time: "08:00",
		title: "Frühstück",
		description: "Gemeinsames Frühstück",
		location: "Speisesaal",
		responsible: "Küchenteam",
		category: "meal",
		duration: 60,
	},
	{
		id: 6,
		day: "Sonntag, 16.02.2026",
		time: "10:00",
		title: "Morgengottesdienst",
		description: "Lobpreis und Predigt",
		location: "Kapelle",
		responsible: "Lukas Pohl",
		category: "worship",
		duration: 90,
	},
	{
		id: 7,
		day: "Sonntag, 16.02.2026",
		time: "12:00",
		title: "Mittagessen",
		description: "Gemeinsames Mittagessen",
		location: "Speisesaal",
		responsible: "Küchenteam",
		category: "meal",
		duration: 60,
	},
	{
		id: 8,
		day: "Sonntag, 16.02.2026",
		time: "14:00",
		title: "Workshops",
		description: "Verschiedene Workshops zur Auswahl: Kreativ, Sport, Musik",
		location: "Verschiedene Räume",
		responsible: "Lisa Frischmuth",
		category: "workshop",
		duration: 120,
	},
	{
		id: 9,
		day: "Sonntag, 16.02.2026",
		time: "16:30",
		title: "Freie Zeit",
		description: "Zeit zur freien Verfügung",
		location: "-",
		responsible: "-",
		category: "freetime",
		duration: 90,
	},
]);

const selectedDay = ref<string>("all");

const days = computed(() => {
	const uniqueDays = [...new Set(programItems.value.map((item) => item.day))];
	return ["all", ...uniqueDays];
});

const filteredProgram = computed(() => {
	if (selectedDay.value === "all") {
		return programItems.value;
	}
	return programItems.value.filter((item) => item.day === selectedDay.value);
});

const groupedProgram = computed(() => {
	const grouped: Record<string, ProgramItem[]> = {};
	filteredProgram.value.forEach((item) => {
		if (!grouped[item.day]) {
			grouped[item.day] = [];
		}
		grouped[item.day]!.push(item);
	});
	return grouped;
});

const categoryConfig = {
	workshop: { label: "Workshop", color: "purple", icon: "i-lucide-presentation" },
	sport: { label: "Sport", color: "blue", icon: "i-lucide-activity" },
	worship: { label: "Gottesdienst", color: "green", icon: "i-lucide-church" },
	freetime: { label: "Freizeit", color: "gray", icon: "i-lucide-sun" },
	meal: { label: "Mahlzeit", color: "orange", icon: "i-lucide-utensils" },
	other: { label: "Sonstiges", color: "neutral", icon: "i-lucide-calendar" },
};

function getCategoryConfig(category: ProgramItem["category"]) {
	return categoryConfig[category];
}

function getDayLabel(day: string) {
	if (day === "all") return "Alle Tage";
	return day;
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Programm" 
                icon="i-lucide-calendar"
                description="Programmplanung für young+free Crottendorf 2026"
            >
                <template #actions>
                    <UButton icon="i-lucide-plus" color="primary">
                        Programmpunkt hinzufügen
                    </UButton>
                </template>
            </DashboardPageHeader>
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Filter -->
                    <div class="flex flex-col sm:flex-row gap-4">
                        <div class="flex flex-wrap gap-2">
                            <UButton 
                                v-for="day in days" 
                                :key="day"
                                :variant="selectedDay === day ? 'solid' : 'soft'"
                                :color="selectedDay === day ? 'primary' : 'neutral'"
                                size="sm"
                                @click="selectedDay = day"
                            >
                                {{ getDayLabel(day) }}
                            </UButton>
                        </div>

                        <div class="flex gap-2 sm:ml-auto">
                            <UButton variant="soft" icon="i-lucide-download" size="sm">
                                Exportieren
                            </UButton>
                            <UButton variant="soft" icon="i-lucide-printer" size="sm">
                                Drucken
                            </UButton>
                        </div>
                    </div>

                    <!-- Program Timeline -->
                    <div v-for="(items, day) in groupedProgram" :key="day" class="space-y-4">
                        <div class="flex items-center gap-3 py-3 border-b border-gray-200 dark:border-gray-700">
                            <UIcon name="i-lucide-calendar" class="w-5 h-5 text-primary-500" />
                            <h2 class="text-lg font-bold text-gray-900 dark:text-white">
                                {{ day }}
                            </h2>
                            <UBadge color="neutral" variant="subtle" size="xs" class="ml-2">
                                {{ items.length }} {{ items.length === 1 ? 'Programmpunkt' : 'Programmpunkte' }}
                            </UBadge>
                        </div>
                        
                        <div class="space-y-2">
                            <div
                                v-for="item in items"
                                :key="item.id"
                                class="group p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 transition-all cursor-pointer bg-white dark:bg-gray-900"
                            >
                                <div class="flex gap-4">
                                    <!-- Time Badge -->
                                    <div class="shrink-0">
                                        <div class="px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-center min-w-20">
                                            <p class="text-base font-bold text-primary-600 dark:text-primary-400">{{ item.time }}</p>
                                            <p class="text-xs text-primary-600/70 dark:text-primary-400/70">{{ item.duration }}min</p>
                                        </div>
                                    </div>

                                    <!-- Content -->
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-start justify-between gap-3 mb-2">
                                            <div class="flex-1">
                                                <div class="flex flex-wrap items-center gap-2 mb-1">
                                                    <h3 class="font-semibold text-gray-900 dark:text-white">{{ item.title }}</h3>
                                                    <UBadge
                                                        :color="getCategoryConfig(item.category).color as any"
                                                        variant="subtle"
                                                        size="xs"
                                                    >
                                                        <UIcon :name="getCategoryConfig(item.category).icon" class="w-3 h-3 mr-1" />
                                                        {{ getCategoryConfig(item.category).label }}
                                                    </UBadge>
                                                </div>
                                                <p class="text-sm text-gray-600 dark:text-gray-400">{{ item.description }}</p>
                                            </div>
                                            <UDropdown
                                                :items="[
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
                                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                            <div class="flex items-center gap-1">
                                                <UIcon name="i-lucide-map-pin" class="w-3 h-3" />
                                                <span>{{ item.location }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <UIcon name="i-lucide-user" class="w-3 h-3" />
                                                <span>{{ item.responsible }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
