<script setup lang="ts">
const route = useRoute()
const campId = computed(() => route.params.id as string)

interface StaffMember {
    id: number
    firstName: string
    lastName: string
    email: string
    phone: string
    role: 'leader' | 'teamer' | 'tech' | 'kitchen' | 'other'
    status: 'confirmed' | 'pending' | 'declined'
    joinedAt: Date
    experience: string
    certifications: string[]
    availability: string
}

const staffMembers = ref<StaffMember[]>([
    {
        id: 1,
        firstName: 'Lukas',
        lastName: 'Pohl',
        email: 'l.pohl@crossover.info',
        phone: '+49 151 11111111',
        role: 'leader',
        status: 'confirmed',
        joinedAt: new Date('2025-12-01'),
        experience: '5+ Jahre Freizeitleitung',
        certifications: ['Erste Hilfe', 'Juleica'],
        availability: 'Volle Woche'
    },
    {
        id: 2,
        firstName: 'Sarah',
        lastName: 'Müller',
        email: 's.mueller@crossover.info',
        phone: '+49 152 22222222',
        role: 'teamer',
        status: 'confirmed',
        joinedAt: new Date('2025-12-15'),
        experience: '3 Jahre als Teamer',
        certifications: ['Erste Hilfe'],
        availability: 'Volle Woche'
    },
    {
        id: 3,
        firstName: 'Lisa',
        lastName: 'Frischmuth',
        email: 'l.frischmuth@crossover.info',
        phone: '+49 153 33333333',
        role: 'teamer',
        status: 'confirmed',
        joinedAt: new Date('2026-01-05'),
        experience: '2 Jahre Mitarbeiter',
        certifications: ['Erste Hilfe', 'Juleica'],
        availability: 'Volle Woche'
    },
    {
        id: 4,
        firstName: 'Jesko',
        lastName: 'Bahlcke',
        email: 'j.bahlcke@crossover.info',
        phone: '+49 154 44444444',
        role: 'teamer',
        status: 'confirmed',
        joinedAt: new Date('2026-01-10'),
        experience: '4 Jahre Teamarbeit',
        certifications: ['Erste Hilfe'],
        availability: 'Volle Woche'
    },
    {
        id: 5,
        firstName: 'Miriam',
        lastName: 'Lohrey',
        email: 'm.lohrey@crossover.info',
        phone: '+49 155 55555555',
        role: 'tech',
        status: 'confirmed',
        joinedAt: new Date('2026-01-12'),
        experience: 'Technik & Medien',
        certifications: [],
        availability: 'Volle Woche'
    },
    {
        id: 6,
        firstName: 'Anna',
        lastName: 'Schmidt',
        email: 'a.schmidt@crossover.info',
        phone: '+49 156 66666666',
        role: 'teamer',
        status: 'pending',
        joinedAt: new Date('2026-01-20'),
        experience: '1 Jahr Erfahrung',
        certifications: [],
        availability: 'Ab Samstag'
    },
    {
        id: 7,
        firstName: 'Küchenteam',
        lastName: 'Extern',
        email: 'kueche@extern.de',
        phone: '+49 157 77777777',
        role: 'kitchen',
        status: 'confirmed',
        joinedAt: new Date('2025-11-20'),
        experience: 'Professionelles Küchenteam',
        certifications: ['Hygieneschulung'],
        availability: 'Volle Woche'
    }
])

const searchQuery = ref('')
const selectedRole = ref('all')
const selectedStatus = ref('all')

const filteredStaff = computed(() => {
    return staffMembers.value.filter(s => {
        const matchesSearch = !searchQuery.value || 
            `${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            s.email.toLowerCase().includes(searchQuery.value.toLowerCase())
        
        const matchesRole = selectedRole.value === 'all' || s.role === selectedRole.value
        const matchesStatus = selectedStatus.value === 'all' || s.status === selectedStatus.value
        
        return matchesSearch && matchesRole && matchesStatus
    })
})

const stats = computed(() => {
    const total = staffMembers.value.length
    const confirmed = staffMembers.value.filter(s => s.status === 'confirmed').length
    const pending = staffMembers.value.filter(s => s.status === 'pending').length
    const leaders = staffMembers.value.filter(s => s.role === 'leader').length
    const teamers = staffMembers.value.filter(s => s.role === 'teamer').length
    
    return { total, confirmed, pending, leaders, teamers }
})

const roleConfig = {
    leader: { label: 'Leitung', color: 'purple', icon: 'i-lucide-crown' },
    teamer: { label: 'Teamer', color: 'blue', icon: 'i-lucide-users' },
    tech: { label: 'Technik', color: 'green', icon: 'i-lucide-settings' },
    kitchen: { label: 'Küche', color: 'orange', icon: 'i-lucide-chef-hat' },
    other: { label: 'Sonstiges', color: 'gray', icon: 'i-lucide-user' }
}

const statusConfig = {
    confirmed: { label: 'Bestätigt', color: 'green' },
    pending: { label: 'Ausstehend', color: 'orange' },
    declined: { label: 'Abgesagt', color: 'red' }
}

function getRoleConfig(role: StaffMember['role']) {
    return roleConfig[role]
}

function getStatusConfig(status: StaffMember['status']) {
    return statusConfig[status]
}

function formatDate(date: Date) {
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Mitarbeiterverwaltung" 
                icon="i-lucide-user-check"
                description="Team-Management für young+free Crottendorf 2026"
            >
                <template #actions>
                    <UButton icon="i-lucide-mail" variant="soft">
                        Team kontaktieren
                    </UButton>
                    <UButton icon="i-lucide-user-plus" color="primary">
                        Mitarbeiter hinzufügen
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
                                <p class="text-2xl font-bold text-gray-900 dark:text-white">{{ stats.total }}</p>
                                <p class="text-sm text-gray-500">Gesamt</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-green-500">{{ stats.confirmed }}</p>
                                <p class="text-sm text-gray-500">Bestätigt</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-orange-500">{{ stats.pending }}</p>
                                <p class="text-sm text-gray-500">Ausstehend</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-purple-500">{{ stats.leaders }}</p>
                                <p class="text-sm text-gray-500">Leitung</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-blue-500">{{ stats.teamers }}</p>
                                <p class="text-sm text-gray-500">Teamer</p>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-wrap items-center gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Mitarbeiter suchen..."
                            class="w-64"
                        />
                        
                        <USelectMenu
                            v-model="selectedRole"
                            :options="['all', 'leader', 'teamer', 'tech', 'kitchen', 'other']"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedRole === 'all'">Alle Rollen</span>
                                <span v-else>{{ getRoleConfig(selectedRole as StaffMember['role']).label }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Rollen</span>
                                <span v-else>{{ getRoleConfig(option as StaffMember['role']).label }}</span>
                            </template>
                        </USelectMenu>

                        <USelectMenu
                            v-model="selectedStatus"
                            :options="['all', 'confirmed', 'pending', 'declined']"
                            class="w-48"
                        >
                            <template #label>
                                <span v-if="selectedStatus === 'all'">Alle Status</span>
                                <span v-else>{{ getStatusConfig(selectedStatus as StaffMember['status']).label }}</span>
                            </template>
                            <template #option="{ option }">
                                <span v-if="option === 'all'">Alle Status</span>
                                <span v-else>{{ getStatusConfig(option as StaffMember['status']).label }}</span>
                            </template>
                        </USelectMenu>
                    </div>

                    <!-- Staff Cards -->
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <UCard
                            v-for="member in filteredStaff"
                            :key="member.id"
                            class="hover:ring-2 hover:ring-primary-500 transition-all"
                        >
                            <div class="space-y-4">
                                <div class="flex items-start justify-between">
                                    <div class="flex items-center gap-3 flex-1">
                                        <UAvatar 
                                            :alt="`${member.firstName} ${member.lastName}`" 
                                            size="lg"
                                            :src="`https://i.pravatar.cc/150?u=${member.email}`"
                                        />
                                        <div class="flex-1 min-w-0">
                                            <h3 class="font-semibold truncate">{{ member.firstName }} {{ member.lastName }}</h3>
                                            <p class="text-sm text-gray-500 truncate">{{ member.email }}</p>
                                        </div>
                                    </div>
                                    <UDropdown
                                        :items="[
                                            [{ label: 'Details', icon: 'i-lucide-eye' }],
                                            [{ label: 'Bearbeiten', icon: 'i-lucide-pencil' }],
                                            [{ label: 'E-Mail senden', icon: 'i-lucide-mail' }],
                                            [{ label: 'Entfernen', icon: 'i-lucide-user-x', class: 'text-red-500' }]
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
                                        <UBadge 
                                            :color="getRoleConfig(member.role).color" 
                                            variant="subtle"
                                            size="xs"
                                        >
                                            <UIcon :name="getRoleConfig(member.role).icon" class="w-3 h-3 mr-1" />
                                            {{ getRoleConfig(member.role).label }}
                                        </UBadge>
                                        <UBadge 
                                            :color="getStatusConfig(member.status).color" 
                                            variant="subtle"
                                            size="xs"
                                        >
                                            {{ getStatusConfig(member.status).label }}
                                        </UBadge>
                                    </div>

                                    <div class="text-sm space-y-1">
                                        <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                                            <UIcon name="i-lucide-phone" class="w-3 h-3" />
                                            <span>{{ member.phone }}</span>
                                        </div>
                                        <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                                            <UIcon name="i-lucide-star" class="w-3 h-3" />
                                            <span>{{ member.experience }}</span>
                                        </div>
                                        <div class="flex items-center gap-1 text-gray-600 dark:text-gray-400">
                                            <UIcon name="i-lucide-calendar-check" class="w-3 h-3" />
                                            <span>{{ member.availability }}</span>
                                        </div>
                                    </div>

                                    <div v-if="member.certifications.length > 0" class="flex flex-wrap gap-1">
                                        <UBadge 
                                            v-for="cert in member.certifications" 
                                            :key="cert"
                                            color="neutral" 
                                            variant="subtle"
                                            size="xs"
                                        >
                                            {{ cert }}
                                        </UBadge>
                                    </div>
                                </div>
                            </div>
                        </UCard>

                        <div v-if="filteredStaff.length === 0" class="col-span-full text-center py-12">
                            <UIcon name="i-lucide-user-x" class="w-12 h-12 mx-auto text-gray-400 mb-3" />
                            <p class="text-gray-500">Keine Mitarbeiter gefunden</p>
                        </div>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>
