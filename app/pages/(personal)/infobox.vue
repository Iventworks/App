<script setup lang="ts">
interface InfoItem {
	id: number;
	title: string;
	content: string;
	category: "announcement" | "reminder" | "info" | "important" | "event";
	date: Date;
	author: string;
	read: boolean;
	attachments?: { name: string; size: string }[];
}

const infoItems = ref<InfoItem[]>([
	{
		id: 1,
		title: "Wichtig: Anmeldefrist für young+free Crottendorf 2026",
		content:
			"Die Anmeldefrist für Teilnehmer läuft am 5. Februar ab. Bitte stellt sicher, dass alle Anmeldungen bis dahin eingegangen sind und die Teilnehmerliste aktualisiert wurde.",
		category: "important",
		date: new Date("2026-01-27"),
		author: "Lukas Pohl",
		read: false,
	},
	{
		id: 2,
		title: "Team-Meeting am 30. Januar",
		content:
			"Unser nächstes Team-Meeting findet am Donnerstag, den 30. Januar um 19:00 Uhr online statt. Agenda: Letzte Vorbereitungen, Materialplanung und Programmablauf. Zoom-Link folgt per E-Mail.",
		category: "event",
		date: new Date("2026-01-26"),
		author: "Sarah Müller",
		read: true,
		attachments: [{ name: "Agenda_Team-Meeting.pdf", size: "245 KB" }],
	},
	{
		id: 3,
		title: "Neue Hygiene-Vorschriften für 2026",
		content:
			"Das Gesundheitsamt hat aktualisierte Hygiene-Vorschriften für Gruppenunterkünfte herausgegeben. Bitte lest euch das beigefügte Dokument durch und beachtet die neuen Regelungen bei der Planung.",
		category: "info",
		date: new Date("2026-01-25"),
		author: "Miriam Lohrey",
		read: true,
		attachments: [{ name: "Hygiene-Vorschriften_2026.pdf", size: "1.2 MB" }],
	},
	{
		id: 4,
		title: "Erinnerung: Erste-Hilfe-Kurs Auffrischung",
		content:
			"Alle Teamer sollten ihre Erste-Hilfe-Bescheinigung vor Beginn der Freizeit auffrischen. Es sind noch Plätze im Kurs am 8. Februar frei. Anmeldung über den Link im Anhang.",
		category: "reminder",
		date: new Date("2026-01-24"),
		author: "Lisa Frischmuth",
		read: false,
	},
	{
		id: 5,
		title: "Ankündigung: Neue Freizeit im Sommer",
		content:
			"Wir planen eine neue Sommerfreizeit vom 15.-22. Juli 2026 am Bodensee. Erste Informationen und die Möglichkeit zur Interessensbekundung als Teamer findet ihr im Portal.",
		category: "announcement",
		date: new Date("2026-01-23"),
		author: "Jesko Bahlcke",
		read: true,
	},
	{
		id: 6,
		title: "Materialbestellung abgeschlossen",
		content:
			"Die Bestellung für Bastelmaterial und Spiele ist eingegangen. Alles wurde geprüft und ist vollständig. Die Materialien werden vor Ort verfügbar sein.",
		category: "info",
		date: new Date("2026-01-22"),
		author: "Lisa Frischmuth",
		read: true,
	},
]);

const selectedCategory = ref("all");
const searchQuery = ref("");
const showUnreadOnly = ref(false);

const filteredItems = computed(() => {
	return infoItems.value.filter((item) => {
		const matchesCategory =
			selectedCategory.value === "all" || item.category === selectedCategory.value;
		const matchesSearch =
			!searchQuery.value ||
			item.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
			item.content.toLowerCase().includes(searchQuery.value.toLowerCase());
		const matchesRead = !showUnreadOnly.value || !item.read;

		return matchesCategory && matchesSearch && matchesRead;
	});
});

const stats = computed(() => {
	const total = infoItems.value.length;
	const unread = infoItems.value.filter((i) => !i.read).length;
	const important = infoItems.value.filter((i) => i.category === "important").length;

	return { total, unread, important };
});

const categoryConfig = {
	announcement: { label: "Ankündigung", color: "primary", icon: "i-lucide-megaphone" },
	reminder: { label: "Erinnerung", color: "warning", icon: "i-lucide-bell" },
	info: { label: "Information", color: "info", icon: "i-lucide-info" },
	important: { label: "Wichtig", color: "error", icon: "i-lucide-alert-triangle" },
	event: { label: "Termin", color: "success", icon: "i-lucide-calendar" },
};

function getCategoryConfig(category: InfoItem["category"]) {
	return categoryConfig[category];
}

function formatDate(date: Date) {
	return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(date: Date) {
	return date.toLocaleDateString("de-DE", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function markAsRead(item: InfoItem) {
	item.read = true;
}

function markAllAsRead() {
	infoItems.value.forEach((item) => {
		item.read = true;
	});
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader
                title="InfoBox"
                icon="i-lucide-info"
                description="Wichtige Informationen, Ankündigungen und Erinnerungen"
            >
                <template #actions>
                    <UButton 
                        icon="i-lucide-check-check" 
                        variant="soft"
                        @click="markAllAsRead"
                    >
                        Alle als gelesen markieren
                    </UButton>
                </template>
            </DashboardPageHeader>
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="space-y-6">
                    <!-- Stats -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-primary-100 dark:bg-primary-900/20">
                                    <UIcon name="i-lucide-inbox" class="w-6 h-6 text-primary-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.total }}</p>
                                    <p class="text-sm text-gray-500">Nachrichten</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-warning-100 dark:bg-warning-900/20">
                                    <UIcon name="i-lucide-mail" class="w-6 h-6 text-warning-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.unread }}</p>
                                    <p class="text-sm text-gray-500">Ungelesen</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-red-100 dark:bg-red-900/20">
                                    <UIcon name="i-lucide-alert-triangle" class="w-6 h-6 text-red-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.important }}</p>
                                    <p class="text-sm text-gray-500">Wichtig</p>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-col gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Nachrichten durchsuchen..."
                            size="lg"
                        />
                        
                        <div class="flex flex-wrap items-center gap-3">
                            <div class="flex flex-wrap gap-2">
                                <UButton
                                    :variant="selectedCategory === 'all' ? 'solid' : 'soft'"
                                    :color="selectedCategory === 'all' ? 'primary' : 'neutral'"
                                    size="sm"
                                    @click="selectedCategory = 'all'"
                                >
                                    Alle
                                </UButton>
                                <UButton
                                    v-for="(config, cat) in categoryConfig"
                                    :key="cat"
                                    :variant="selectedCategory === cat ? 'solid' : 'soft'"
                                    :color="selectedCategory === cat ? config.color as any : 'neutral'"
                                    size="sm"
                                    @click="selectedCategory = cat"
                                >
                                    <UIcon :name="config.icon" class="w-3 h-3 mr-1" />
                                    {{ config.label }}
                                </UButton>
                            </div>

                            <div class="ml-auto">
                                <UCheckbox 
                                    v-model="showUnreadOnly" 
                                    label="Nur ungelesene"
                                />
                            </div>
                        </div>
                    </div>

                    <!-- Info Items List -->
                    <div class="space-y-3">
                        <UCard
                            v-for="item in filteredItems"
                            :key="item.id"
                            class="cursor-pointer transition-all"
                            :class="!item.read ? 'ring-2 ring-primary-500 bg-primary-50/50 dark:bg-primary-900/10' : 'hover:ring-2 hover:ring-gray-300'"
                            @click="markAsRead(item)"
                        >
                            <div class="space-y-3">
                                <div class="flex items-start justify-between gap-3">
                                    <div class="flex-1">
                                        <div class="flex items-center gap-2 mb-2">
                                            <UBadge
                                                :color="getCategoryConfig(item.category).color as any"
                                                variant="subtle"
                                                size="sm"
                                            >
                                                <UIcon :name="getCategoryConfig(item.category).icon" class="w-3 h-3 mr-1" />
                                                {{ getCategoryConfig(item.category).label }}
                                            </UBadge>
                                            <UBadge v-if="!item.read" color="primary" variant="solid" size="xs">
                                                Neu
                                            </UBadge>
                                        </div>
                                        <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                                            {{ item.title }}
                                        </h3>
                                        <p class="text-sm text-gray-600 dark:text-gray-400">
                                            {{ item.content }}
                                        </p>
                                    </div>
                                    <UDropdown
                                        :items="[
                                            [{ label: item.read ? 'Als ungelesen markieren' : 'Als gelesen markieren', icon: item.read ? 'i-lucide-mail' : 'i-lucide-mail-open' }],
                                            [{ label: 'Details', icon: 'i-lucide-eye' }],
                                            [{ label: 'Löschen', icon: 'i-lucide-trash-2', class: 'text-red-500' }]
                                        ]"
                                    >
                                        <UButton 
                                            icon="i-lucide-more-horizontal" 
                                            variant="ghost" 
                                            color="neutral"
                                            size="xs"
                                            @click.stop
                                        />
                                    </UDropdown>
                                </div>

                                <UDivider />

                                <div class="flex items-center justify-between text-sm text-gray-500">
                                    <div class="flex items-center gap-4">
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-user" class="w-4 h-4" />
                                            <span>{{ item.author }}</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-calendar" class="w-4 h-4" />
                                            <span>{{ formatDate(item.date) }}</span>
                                        </div>
                                    </div>
                                    
                                    <div v-if="item.attachments && item.attachments.length > 0" class="flex items-center gap-1">
                                        <UIcon name="i-lucide-paperclip" class="w-4 h-4" />
                                        <span>{{ item.attachments.length }} Anhang{{ item.attachments.length > 1 ? 'e' : '' }}</span>
                                    </div>
                                </div>

                                <div v-if="item.attachments && item.attachments.length > 0" class="space-y-2">
                                    <UDivider />
                                    <div class="flex flex-wrap gap-2">
                                        <UButton
                                            v-for="(attachment, idx) in item.attachments"
                                            :key="idx"
                                            variant="soft"
                                            color="neutral"
                                            size="xs"
                                            icon="i-lucide-file"
                                        >
                                            {{ attachment.name }} ({{ attachment.size }})
                                        </UButton>
                                    </div>
                                </div>
                            </div>
                        </UCard>

                        <div v-if="filteredItems.length === 0" class="text-center py-12">
                            <UIcon name="i-lucide-inbox" class="w-12 h-12 mx-auto text-gray-400 mb-3" />
                            <p class="text-gray-500">Keine Nachrichten gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>