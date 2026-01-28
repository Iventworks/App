<script setup lang="ts">
interface Resource {
    id: number
    name: string
    type: 'template' | 'form' | 'guide' | 'document' | 'image' | 'other'
    category: string
    size: string
    uploadedBy: string
    uploadedAt: Date
    downloads: number
    shared: boolean
}

const resources = ref<Resource[]>([
    {
        id: 1,
        name: 'Freizeitleiter Handbuch 2026',
        type: 'guide',
        category: 'Schulung',
        size: '3.2 MB',
        uploadedBy: 'Lukas Pohl',
        uploadedAt: new Date('2025-12-01'),
        downloads: 45,
        shared: true
    },
    {
        id: 2,
        name: 'Anmeldeformular Vorlage',
        type: 'form',
        category: 'Organisation',
        size: '156 KB',
        uploadedBy: 'Sarah Müller',
        uploadedAt: new Date('2025-11-15'),
        downloads: 128,
        shared: true
    },
    {
        id: 3,
        name: 'Packlisten-Sammlung',
        type: 'document',
        category: 'Organisation',
        size: '425 KB',
        uploadedBy: 'Miriam Lohrey',
        uploadedAt: new Date('2026-01-05'),
        downloads: 67,
        shared: true
    },
    {
        id: 4,
        name: 'Notfallplan Template',
        type: 'template',
        category: 'Sicherheit',
        size: '312 KB',
        uploadedBy: 'Jesko Bahlcke',
        uploadedAt: new Date('2025-10-20'),
        downloads: 34,
        shared: true
    },
    {
        id: 5,
        name: 'Spielesammlung Digital',
        type: 'document',
        category: 'Programm',
        size: '2.8 MB',
        uploadedBy: 'Lisa Frischmuth',
        uploadedAt: new Date('2025-12-10'),
        downloads: 92,
        shared: true
    },
    {
        id: 6,
        name: 'Crossover Logo Pack',
        type: 'image',
        category: 'Branding',
        size: '5.1 MB',
        uploadedBy: 'Lukas Pohl',
        uploadedAt: new Date('2025-09-01'),
        downloads: 156,
        shared: true
    },
    {
        id: 7,
        name: 'Andachten Sammlung',
        type: 'document',
        category: 'Inhalt',
        size: '1.9 MB',
        uploadedBy: 'Jesko Bahlcke',
        uploadedAt: new Date('2025-11-28'),
        downloads: 78,
        shared: false
    },
    {
        id: 8,
        name: 'Budget Vorlage',
        type: 'template',
        category: 'Finanzen',
        size: '89 KB',
        uploadedBy: 'Sarah Müller',
        uploadedAt: new Date('2025-12-15'),
        downloads: 41,
        shared: true
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

const stats = computed(() => {
    const total = resources.value.length
    const shared = resources.value.filter(r => r.shared).length
    const totalDownloads = resources.value.reduce((sum, r) => sum + r.downloads, 0)
    const templates = resources.value.filter(r => r.type === 'template' || r.type === 'form').length
    
    return { total, shared, totalDownloads, templates }
})

const typeConfig = {
    template: { label: 'Vorlage', color: 'purple', icon: 'i-lucide-layout-template' },
    form: { label: 'Formular', color: 'blue', icon: 'i-lucide-file-text' },
    guide: { label: 'Leitfaden', color: 'green', icon: 'i-lucide-book-open' },
    document: { label: 'Dokument', color: 'orange', icon: 'i-lucide-file' },
    image: { label: 'Bild', color: 'pink', icon: 'i-lucide-image' },
    other: { label: 'Sonstiges', color: 'gray', icon: 'i-lucide-folder' }
}

function getTypeConfig(type: Resource['type']) {
    return typeConfig[type]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Ressourcen & Dokumente" 
                icon="i-lucide-folder"
                description="Zentrale Ressourcenverwaltung für alle Crossover Aktivitäten"
            >
                <template #actions>
                    <UButton icon="i-lucide-upload" color="primary">
                        Ressource hochladen
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
                                    <UIcon name="i-lucide-folder" class="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.total }}</p>
                                    <p class="text-sm text-gray-500">Ressourcen</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-green-100 dark:bg-green-900/20">
                                    <UIcon name="i-lucide-share-2" class="w-6 h-6 text-green-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.shared }}</p>
                                    <p class="text-sm text-gray-500">Geteilt</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                                    <UIcon name="i-lucide-download" class="w-6 h-6 text-purple-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.totalDownloads }}</p>
                                    <p class="text-sm text-gray-500">Downloads</p>
                                </div>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="flex items-center gap-3">
                                <div class="p-3 rounded-lg bg-orange-100 dark:bg-orange-900/20">
                                    <UIcon name="i-lucide-layout-template" class="w-6 h-6 text-orange-600" />
                                </div>
                                <div>
                                    <p class="text-2xl font-bold">{{ stats.templates }}</p>
                                    <p class="text-sm text-gray-500">Vorlagen</p>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-wrap items-center gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Ressourcen durchsuchen..."
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
                            :options="['all', 'template', 'form', 'guide', 'document', 'image', 'other']"
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
                                            [{ label: 'Vorschau', icon: 'i-lucide-eye' }],
                                            [{ label: 'Teilen', icon: 'i-lucide-share-2' }],
                                            [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
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

                                <div class="space-y-2">
                                    <div class="flex items-center gap-2">
                                        <UBadge color="neutral" variant="subtle" size="xs">
                                            {{ resource.category }}
                                        </UBadge>
                                        <UBadge :color="getTypeConfig(resource.type).color" variant="subtle" size="xs">
                                            {{ getTypeConfig(resource.type).label }}
                                        </UBadge>
                                        <UBadge v-if="resource.shared" color="green" variant="subtle" size="xs">
                                            <UIcon name="i-lucide-share-2" class="w-3 h-3 mr-1" />
                                            Geteilt
                                        </UBadge>
                                    </div>
                                    <div class="flex items-center gap-1 text-xs text-gray-500">
                                        <UIcon name="i-lucide-user" class="w-3 h-3" />
                                        <span>{{ resource.uploadedBy }}</span>
                                    </div>
                                    <div class="flex items-center justify-between text-xs text-gray-500">
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-calendar" class="w-3 h-3" />
                                            <span>{{ formatDate(resource.uploadedAt) }}</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <UIcon name="i-lucide-download" class="w-3 h-3" />
                                            <span>{{ resource.downloads }}x</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </UCard>

                        <div v-if="filteredResources.length === 0" class="col-span-full text-center py-12">
                            <UIcon name="i-lucide-folder-open" class="w-12 h-12 mx-auto text-gray-400 mb-3" />
                            <p class="text-gray-500">Keine Ressourcen gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
