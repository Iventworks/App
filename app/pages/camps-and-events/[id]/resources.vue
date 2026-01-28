<script setup lang="ts">
const route = useRoute()
const campId = computed(() => route.params.id as string)

interface Resource {
    id: number
    name: string
    type: 'document' | 'image' | 'video' | 'other'
    category: string
    size: string
    uploadedBy: string
    uploadedAt: Date
    url: string
}

const resources = ref<Resource[]>([
    {
        id: 1,
        name: 'Packliste_2026.pdf',
        type: 'document',
        category: 'Organisation',
        size: '245 KB',
        uploadedBy: 'Lukas Pohl',
        uploadedAt: new Date('2026-01-15'),
        url: '#'
    },
    {
        id: 2,
        name: 'Programmablauf_Woche.pdf',
        type: 'document',
        category: 'Programm',
        size: '512 KB',
        uploadedBy: 'Sarah Müller',
        uploadedAt: new Date('2026-01-18'),
        url: '#'
    },
    {
        id: 3,
        name: 'Teamleitfaden.pdf',
        type: 'document',
        category: 'Team',
        size: '1.2 MB',
        uploadedBy: 'Lukas Pohl',
        uploadedAt: new Date('2026-01-10'),
        url: '#'
    },
    {
        id: 4,
        name: 'Anmeldeformular.pdf',
        type: 'document',
        category: 'Organisation',
        size: '156 KB',
        uploadedBy: 'Miriam Lohrey',
        uploadedAt: new Date('2026-01-08'),
        url: '#'
    },
    {
        id: 5,
        name: 'Notfallplan.pdf',
        type: 'document',
        category: 'Sicherheit',
        size: '328 KB',
        uploadedBy: 'Jesko Bahlcke',
        uploadedAt: new Date('2026-01-12'),
        url: '#'
    },
    {
        id: 6,
        name: 'Veranstaltungsort_Fotos.zip',
        type: 'other',
        category: 'Medien',
        size: '15.4 MB',
        uploadedBy: 'Lisa Frischmuth',
        uploadedAt: new Date('2026-01-20'),
        url: '#'
    },
    {
        id: 7,
        name: 'Workshop_Materialien.pdf',
        type: 'document',
        category: 'Programm',
        size: '892 KB',
        uploadedBy: 'Lisa Frischmuth',
        uploadedAt: new Date('2026-01-22'),
        url: '#'
    },
    {
        id: 8,
        name: 'Teilnehmerliste_Stand_Jan.xlsx',
        type: 'other',
        category: 'Organisation',
        size: '68 KB',
        uploadedBy: 'Sarah Müller',
        uploadedAt: new Date('2026-01-25'),
        url: '#'
    }
])

const searchQuery = ref('')
const selectedCategory = ref('all')
const selectedType = ref('all')

const filteredResources = computed(() => {
    return resources.value.filter(r => {
        const matchesSearch = !searchQuery.value || 
            r.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            r.category.toLowerCase().includes(searchQuery.value.toLowerCase())
        
        const matchesCategory = selectedCategory.value === 'all' || r.category === selectedCategory.value
        const matchesType = selectedType.value === 'all' || r.type === selectedType.value
        
        return matchesSearch && matchesCategory && matchesType
    })
})

const categories = computed(() => {
    const cats = [...new Set(resources.value.map(r => r.category))]
    return ['all', ...cats]
})

const typeConfig = {
    document: { label: 'Dokument', icon: 'i-lucide-file-text', color: 'blue' },
    image: { label: 'Bild', icon: 'i-lucide-image', color: 'green' },
    video: { label: 'Video', icon: 'i-lucide-video', color: 'purple' },
    other: { label: 'Sonstiges', icon: 'i-lucide-file', color: 'gray' }
}

function getTypeConfig(type: Resource['type']) {
    return typeConfig[type]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const stats = computed(() => {
    const total = resources.value.length
    const documents = resources.value.filter(r => r.type === 'document').length
    const images = resources.value.filter(r => r.type === 'image').length
    const videos = resources.value.filter(r => r.type === 'video').length
    
    return { total, documents, images, videos }
})
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Ressourcen & Dokumente" 
                icon="i-lucide-folder"
                description="Dateiverwaltung für young+free Crottendorf 2026"
            >
                <template #actions>
                    <UButton icon="i-lucide-upload" color="primary">
                        Datei hochladen
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
                                <div class="p-3 rounded-lg bg-gray-100 dark:bg-gray-800">
                                    <UIcon name="i-lucide-folder" class="w-6 h-6 text-gray-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.total }}</p>
                                    <p class="text-sm text-gray-500">Gesamt</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                                    <UIcon name="i-lucide-file-text" class="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.documents }}</p>
                                    <p class="text-sm text-gray-500">Dokumente</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-green-100 dark:bg-green-900/20">
                                    <UIcon name="i-lucide-image" class="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.images }}</p>
                                    <p class="text-sm text-gray-500">Bilder</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                                    <UIcon name="i-lucide-video" class="w-6 h-6 text-purple-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.videos }}</p>
                                    <p class="text-sm text-gray-500">Videos</p>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-wrap items-center gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Dateien durchsuchen..."
                            class="w-64"
                        />
                        
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
                            v-model="selectedType"
                            :options="['all', 'document', 'image', 'video', 'other']"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedType === 'all'">Alle Typen</span>
                                <span v-else>{{ getTypeConfig(selectedType as Resource['type']).label }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Typen</span>
                                <span v-else>{{ getTypeConfig(option as Resource['type']).label }}</span>
                            </template>
                        </USelectMenu>
                    </div>

                    <!-- Resources Grid -->
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <UCard
                            v-for="resource in filteredResources"
                            :key="resource.id"
                            class="hover:ring-2 hover:ring-primary-500 transition-all cursor-pointer"
                        >
                            <div class="space-y-3">
                                <div class="flex items-start justify-between">
                                    <div class="flex items-center gap-3 flex-1 min-w-0">
                                        <div class="p-2 rounded-lg"
                                             :class="`bg-${getTypeConfig(resource.type).color}-100 dark:bg-${getTypeConfig(resource.type).color}-900/20`">
                                            <UIcon 
                                                :name="getTypeConfig(resource.type).icon" 
                                                :class="`w-6 h-6 text-${getTypeConfig(resource.type).color}-600`"
                                            />
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <h3 class="font-semibold text-sm truncate">{{ resource.name }}</h3>
                                            <p class="text-xs text-gray-500">{{ resource.size }}</p>
                                        </div>
                                    </div>
                                    <UDropdown
                                        :items="[
                                            [{ label: 'Herunterladen', icon: 'i-lucide-download' }],
                                            [{ label: 'Umbenennen', icon: 'i-lucide-pencil' }],
                                            [{ label: 'Link kopieren', icon: 'i-lucide-link' }],
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
                                </div>

                                <UDivider />

                                <div class="space-y-1">
                                    <div class="flex items-center gap-2">
                                        <UBadge color="neutral" variant="subtle" size="xs">
                                            {{ resource.category }}
                                        </UBadge>
                                        <UBadge :color="getTypeConfig(resource.type).color" variant="subtle" size="xs">
                                            {{ getTypeConfig(resource.type).label }}
                                        </UBadge>
                                    </div>
                                    <div class="flex items-center gap-1 text-xs text-gray-500">
                                        <UIcon name="i-lucide-user" class="w-3 h-3" />
                                        <span>{{ resource.uploadedBy }}</span>
                                    </div>
                                    <div class="flex items-center gap-1 text-xs text-gray-500">
                                        <UIcon name="i-lucide-calendar" class="w-3 h-3" />
                                        <span>{{ formatDate(resource.uploadedAt) }}</span>
                                    </div>
                                </div>
                            </div>
                        </UCard>

                        <div v-if="filteredResources.length === 0" class="col-span-full text-center py-12">
                            <UIcon name="i-lucide-folder-open" class="w-12 h-12 mx-auto text-gray-400 mb-3" />
                            <p class="text-gray-500">Keine Dateien gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
