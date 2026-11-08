<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";

const route = useRoute();
const campId = computed(() => route.params.id as string);

interface Participant {
	id: number;
	firstName: string;
	lastName: string;
	email: string;
	phone: string;
	age: number;
	gender: "male" | "female" | "other";
	registrationDate: Date;
	paymentStatus: "pending" | "partial" | "paid";
	medicalInfo: string;
	emergencyContact: string;
	emergencyPhone: string;
	dietaryRequirements: string;
	status: "registered" | "confirmed" | "cancelled";
}

const participants = ref<Participant[]>([
	{
		id: 1,
		firstName: "Anna",
		lastName: "Schmidt",
		email: "anna.schmidt@example.com",
		phone: "+49 151 12345678",
		age: 15,
		gender: "female",
		registrationDate: new Date("2026-01-10"),
		paymentStatus: "paid",
		medicalInfo: "Keine Allergien",
		emergencyContact: "Maria Schmidt",
		emergencyPhone: "+49 151 98765432",
		dietaryRequirements: "Vegetarisch",
		status: "confirmed",
	},
	{
		id: 2,
		firstName: "Max",
		lastName: "Müller",
		email: "max.mueller@example.com",
		phone: "+49 152 23456789",
		age: 16,
		gender: "male",
		registrationDate: new Date("2026-01-12"),
		paymentStatus: "paid",
		medicalInfo: "Asthma (Medikation vorhanden)",
		emergencyContact: "Thomas Müller",
		emergencyPhone: "+49 152 87654321",
		dietaryRequirements: "Keine",
		status: "confirmed",
	},
	{
		id: 3,
		firstName: "Sophie",
		lastName: "Weber",
		email: "sophie.weber@example.com",
		phone: "+49 153 34567890",
		age: 14,
		gender: "female",
		registrationDate: new Date("2026-01-15"),
		paymentStatus: "partial",
		medicalInfo: "Laktoseintoleranz",
		emergencyContact: "Julia Weber",
		emergencyPhone: "+49 153 76543210",
		dietaryRequirements: "Laktosefrei",
		status: "registered",
	},
	{
		id: 4,
		firstName: "Leon",
		lastName: "Fischer",
		email: "leon.fischer@example.com",
		phone: "+49 154 45678901",
		age: 17,
		gender: "male",
		registrationDate: new Date("2026-01-18"),
		paymentStatus: "pending",
		medicalInfo: "Keine",
		emergencyContact: "Sandra Fischer",
		emergencyPhone: "+49 154 65432109",
		dietaryRequirements: "Keine",
		status: "registered",
	},
	{
		id: 5,
		firstName: "Emma",
		lastName: "Wagner",
		email: "emma.wagner@example.com",
		phone: "+49 155 56789012",
		age: 13,
		gender: "female",
		registrationDate: new Date("2026-01-20"),
		paymentStatus: "paid",
		medicalInfo: "Nussallergie",
		emergencyContact: "Michael Wagner",
		emergencyPhone: "+49 155 54321098",
		dietaryRequirements: "Keine Nüsse",
		status: "confirmed",
	},
]);

const searchQuery = ref("");
const selectedStatus = ref("all");
const selectedPaymentStatus = ref("all");

// Modalsteuerung
const isActionsModalOpen = ref(false);
const isDeleteModalOpen = ref(false);
const isEditMode = ref(false);
const selectedParticipant = ref<Participant | null>(null);
const editedParticipant = ref<Participant | null>(null);

// Aktionen
function openActionsModal(participant: Participant) {
	selectedParticipant.value = participant;
	editedParticipant.value = { ...participant };
	isEditMode.value = false;
	isActionsModalOpen.value = true;
}

function enableEditMode() {
	isEditMode.value = true;
}

function cancelEdit() {
	if (selectedParticipant.value) {
		editedParticipant.value = { ...selectedParticipant.value };
	}
	isEditMode.value = false;
}

function sendEmail(participant: Participant) {
	window.location.href = `mailto:${participant.email}?subject=young+free Crottendorf 2026`;
}

function confirmDelete() {
	isDeleteModalOpen.value = true;
}

function deleteParticipant() {
	if (selectedParticipant.value) {
		participants.value = participants.value.filter((p) => p.id !== selectedParticipant.value!.id);
		selectedParticipant.value = null;
		editedParticipant.value = null;
		isActionsModalOpen.value = false;
	}
}

function saveParticipant() {
	if (selectedParticipant.value && editedParticipant.value) {
		const index = participants.value.findIndex((p) => p.id === selectedParticipant.value!.id);
		if (index !== -1) {
			participants.value[index] = { ...editedParticipant.value };
			selectedParticipant.value = { ...editedParticipant.value };
		}
		isEditMode.value = false;
	}
}

const filteredParticipants = computed(() => {
	return participants.value.filter((p) => {
		const matchesSearch =
			!searchQuery.value ||
			`${p.firstName} ${p.lastName}`.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
			p.email.toLowerCase().includes(searchQuery.value.toLowerCase());

		const matchesStatus = selectedStatus.value === "all" || p.status === selectedStatus.value;
		const matchesPayment =
			selectedPaymentStatus.value === "all" || p.paymentStatus === selectedPaymentStatus.value;

		return matchesSearch && matchesStatus && matchesPayment;
	});
});

const stats = computed(() => {
	const total = participants.value.length;
	const confirmed = participants.value.filter((p) => p.status === "confirmed").length;
	const registered = participants.value.filter((p) => p.status === "registered").length;
	const paid = participants.value.filter((p) => p.paymentStatus === "paid").length;
	const pending = participants.value.filter((p) => p.paymentStatus === "pending").length;

	return { total, confirmed, registered, paid, pending };
});

const paymentStatusConfig = {
	pending: { label: "Ausstehend", color: "error" },
	partial: { label: "Teilweise", color: "warning" },
	paid: { label: "Bezahlt", color: "success" },
} as const;

const statusConfig = {
	registered: { label: "Angemeldet", color: "primary" },
	confirmed: { label: "Bestätigt", color: "success" },
	cancelled: { label: "Abgesagt", color: "error" },
} as const;

function formatDate(date: Date) {
	return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const columns: TableColumn<Participant>[] = [
	{ id: "name", header: "Name" },
	{ accessorKey: "age", header: "Alter" },
	{ accessorKey: "contact", header: "Kontakt" },
	{ accessorKey: "status", header: "Status" },
	{ accessorKey: "payment", header: "Zahlung" },
	{ id: "actions", header: "" },
];
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader 
                title="Teilnehmerverwaltung" 
                icon="i-lucide-users"
                description="Verwaltung der Teilnehmer für young+free Crottendorf 2026"
            >
                <template #actions>
                    <UButton icon="i-lucide-download" variant="soft">
                        Exportieren
                    </UButton>
                    <UButton icon="i-lucide-user-plus" color="primary">
                        Teilnehmer hinzufügen
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
                                <p class="text-2xl font-bold text-blue-500">{{ stats.registered }}</p>
                                <p class="text-sm text-gray-500">Angemeldet</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-green-500">{{ stats.paid }}</p>
                                <p class="text-sm text-gray-500">Bezahlt</p>
                            </div>
                        </UCard>
                        <UCard>
                            <div class="text-center">
                                <p class="text-2xl font-bold text-red-500">{{ stats.pending }}</p>
                                <p class="text-sm text-gray-500">Ausstehend</p>
                            </div>
                        </UCard>
                    </div>

                    <!-- Filters -->
                    <div class="flex flex-col gap-4">
                        <UInput
                            v-model="searchQuery"
                            icon="i-lucide-search"
                            placeholder="Teilnehmer suchen..."
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
                                        :variant="selectedStatus === 'registered' ? 'solid' : 'soft'"
                                        :color="selectedStatus === 'registered' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedStatus = 'registered'"
                                    >
                                        Angemeldet
                                    </UButton>
                                    <UButton
                                        :variant="selectedStatus === 'confirmed' ? 'solid' : 'soft'"
                                        :color="selectedStatus === 'confirmed' ? 'success' : 'neutral'"
                                        size="sm"
                                        @click="selectedStatus = 'confirmed'"
                                    >
                                        Bestätigt
                                    </UButton>
                                    <UButton
                                        :variant="selectedStatus === 'cancelled' ? 'solid' : 'soft'"
                                        :color="selectedStatus === 'cancelled' ? 'error' : 'neutral'"
                                        size="sm"
                                        @click="selectedStatus = 'cancelled'"
                                    >
                                        Abgesagt
                                    </UButton>
                                </div>
                            </div>

                            <div>
                                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Zahlung</label>
                                <div class="flex flex-wrap gap-2">
                                    <UButton
                                        :variant="selectedPaymentStatus === 'all' ? 'solid' : 'soft'"
                                        :color="selectedPaymentStatus === 'all' ? 'primary' : 'neutral'"
                                        size="sm"
                                        @click="selectedPaymentStatus = 'all'"
                                    >
                                        Alle
                                    </UButton>
                                    <UButton
                                        :variant="selectedPaymentStatus === 'pending' ? 'solid' : 'soft'"
                                        :color="selectedPaymentStatus === 'pending' ? 'error' : 'neutral'"
                                        size="sm"
                                        @click="selectedPaymentStatus = 'pending'"
                                    >
                                        Ausstehend
                                    </UButton>
                                    <UButton
                                        :variant="selectedPaymentStatus === 'partial' ? 'solid' : 'soft'"
                                        :color="selectedPaymentStatus === 'partial' ? 'warning' : 'neutral'"
                                        size="sm"
                                        @click="selectedPaymentStatus = 'partial'"
                                    >
                                        Teilweise
                                    </UButton>
                                    <UButton
                                        :variant="selectedPaymentStatus === 'paid' ? 'solid' : 'soft'"
                                        :color="selectedPaymentStatus === 'paid' ? 'success' : 'neutral'"
                                        size="sm"
                                        @click="selectedPaymentStatus = 'paid'"
                                    >
                                        Bezahlt
                                    </UButton>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Participants Table -->
                    <UCard>
                        <UTable :columns="columns" :data="filteredParticipants">
                            <template #name-cell="{ row }">
                                <div class="flex items-center gap-3">
                                    <UAvatar :alt="`${row.original.firstName} ${row.original.lastName}`" size="sm" />
                                    <div>
                                        <p class="font-medium">{{ row.original.firstName }} {{ row.original.lastName }}</p>
                                        <p class="text-xs text-gray-500">{{ row.original.email }}</p>
                                    </div>
                                </div>
                            </template>

                            <template #age-cell="{ row }">
                                <span>{{ row.original.age }} Jahre</span>
                            </template>

                            <template #contact-cell="{ row }">
                                <div class="text-sm">
                                    <p>{{ row.original.phone }}</p>
                                    <p class="text-xs text-gray-500">Notfall: {{ row.original.emergencyContact }}</p>
                                </div>
                            </template>

                            <template #status-cell="{ row }">
                                <UBadge 
                                    :color="statusConfig[row.original.status].color as any" 
                                    variant="subtle"
                                    size="xs"
                                >
                                    {{ statusConfig[row.original.status].label }}
                                </UBadge>
                            </template>

                            <template #payment-cell="{ row }">
                                <UBadge 
                                    :color="paymentStatusConfig[row.original.paymentStatus].color as any" 
                                    variant="subtle"
                                    size="xs"
                                >
                                    {{ paymentStatusConfig[row.original.paymentStatus].label }}
                                </UBadge>
                            </template>

                            <template #actions-cell="{ row }">
                                <UButton 
                                    icon="i-lucide-settings" 
                                    variant="ghost" 
                                    color="neutral"
                                    size="xs"
                                    @click="openActionsModal(row.original)"
                                />
                            </template>
                        </UTable>
                    </UCard>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>

    <!-- Actions Modal -->
    <DashboardModal
        v-model:open="isActionsModalOpen"
        :title="isEditMode ? 'Teilnehmer bearbeiten' : 'Teilnehmer verwalten'"
        :icon="isEditMode ? 'i-lucide-pencil' : 'i-lucide-user'"
        icon-color="sky"
    >
        <div v-if="selectedParticipant && editedParticipant" class="space-y-6">
            <!-- View Mode -->
            <template v-if="!isEditMode">
                <div class="flex items-center gap-4">
                    <UAvatar :alt="`${selectedParticipant.firstName} ${selectedParticipant.lastName}`" size="lg" />
                    <div>
                        <h3 class="text-xl font-bold">{{ selectedParticipant.firstName }} {{ selectedParticipant.lastName }}</h3>
                        <p class="text-sm text-gray-500">{{ selectedParticipant.age }} Jahre</p>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="text-sm font-medium text-gray-500">E-Mail</label>
                        <p class="mt-1">{{ selectedParticipant.email }}</p>
                    </div>

                    <div>
                        <label class="text-sm font-medium text-gray-500">Telefon</label>
                        <p class="mt-1">{{ selectedParticipant.phone }}</p>
                    </div>

                    <div>
                        <label class="text-sm font-medium text-gray-500">Geschlecht</label>
                        <p class="mt-1">{{ selectedParticipant.gender === 'male' ? 'Männlich' : selectedParticipant.gender === 'female' ? 'Weiblich' : 'Divers' }}</p>
                    </div>

                    <div>
                        <label class="text-sm font-medium text-gray-500">Anmeldedatum</label>
                        <p class="mt-1">{{ formatDate(selectedParticipant.registrationDate) }}</p>
                    </div>

                    <div>
                        <label class="text-sm font-medium text-gray-500">Status</label>
                        <div class="mt-1">
                            <UBadge :color="statusConfig[selectedParticipant.status].color" variant="subtle">
                                {{ statusConfig[selectedParticipant.status].label }}
                            </UBadge>
                        </div>
                    </div>

                    <div>
                        <label class="text-sm font-medium text-gray-500">Zahlungsstatus</label>
                        <div class="mt-1">
                            <UBadge :color="paymentStatusConfig[selectedParticipant.paymentStatus].color" variant="subtle">
                                {{ paymentStatusConfig[selectedParticipant.paymentStatus].label }}
                            </UBadge>
                        </div>
                    </div>

                    <div class="col-span-2">
                        <label class="text-sm font-medium text-gray-500">Notfallkontakt</label>
                        <p class="mt-1">{{ selectedParticipant.emergencyContact }} ({{ selectedParticipant.emergencyPhone }})</p>
                    </div>

                    <div class="col-span-2">
                        <label class="text-sm font-medium text-gray-500">Medizinische Informationen</label>
                        <p class="mt-1">{{ selectedParticipant.medicalInfo }}</p>
                    </div>

                    <div class="col-span-2">
                        <label class="text-sm font-medium text-gray-500">Ernährungswünsche</label>
                        <p class="mt-1">{{ selectedParticipant.dietaryRequirements }}</p>
                    </div>
                </div>
            </template>

            <!-- Edit Mode -->
            <template v-else>
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <UFormField label="Vorname" required>
                            <UInput v-model="editedParticipant.firstName" />
                        </UFormField>
                        <UFormField label="Nachname" required>
                            <UInput v-model="editedParticipant.lastName" />
                        </UFormField>
                    </div>

                    <UFormField label="E-Mail" required>
                        <UInput v-model="editedParticipant.email" type="email" class="w-full" />
                    </UFormField>

                    <UFormField label="Telefon">
                        <UInput v-model="editedParticipant.phone" class="w-full" />
                    </UFormField>

                    <div class="grid grid-cols-2 gap-4">
                        <UFormField label="Alter" required>
                            <UInput v-model.number="editedParticipant.age" type="number" />
                        </UFormField>
                        <UFormField label="Geschlecht">
                            <USelect v-model="editedParticipant.gender" :items="[
                                { label: 'Männlich', value: 'male' },
                                { label: 'Weiblich', value: 'female' },
                                { label: 'Divers', value: 'other' }
                            ]" />
                        </UFormField>
                    </div>

                    <UFormField label="Status">
                        <USelect v-model="editedParticipant.status" :items="[
                            { label: 'Angemeldet', value: 'registered' },
                            { label: 'Bestätigt', value: 'confirmed' },
                            { label: 'Abgesagt', value: 'cancelled' }
                        ]" />
                    </UFormField>

                    <UFormField label="Zahlungsstatus">
                        <USelect v-model="editedParticipant.paymentStatus" :items="[
                            { label: 'Ausstehend', value: 'pending' },
                            { label: 'Teilweise', value: 'partial' },
                            { label: 'Bezahlt', value: 'paid' }
                        ]" />
                    </UFormField>

                    <UFormField label="Notfallkontakt">
                        <UInput v-model="editedParticipant.emergencyContact" />
                    </UFormField>

                    <UFormField label="Notfall-Telefon">
                        <UInput v-model="editedParticipant.emergencyPhone" />
                    </UFormField>

                    <UFormField label="Medizinische Informationen">
                        <UTextarea v-model="editedParticipant.medicalInfo" :rows="3" />
                    </UFormField>

                    <UFormField label="Ernährungswünsche">
                        <UTextarea v-model="editedParticipant.dietaryRequirements" :rows="2" />
                    </UFormField>
                </div>
            </template>
        </div>


        <template #footer>
            <!-- View Mode Actions -->
            <div v-if="!isEditMode" class="flex justify-between w-full">
                <UButton
                    label="Löschen"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="soft"
                    @click="confirmDelete"
                />
                <div class="flex gap-2">
                    <UButton
                        label="Schließen"
                        color="neutral"
                        variant="ghost"
                        @click="isActionsModalOpen = false"
                    />
                    <UButton
                        label="E-Mail senden"
                        icon="i-lucide-mail"
                        variant="soft"
                        @click="sendEmail(selectedParticipant!)"
                    />
                    <UButton
                        label="Bearbeiten"
                        icon="i-lucide-pencil"
                        color="primary"
                        @click="enableEditMode"
                    />
                </div>
            </div>
            <!-- Edit Mode Actions -->
            <div v-else class="flex justify-end gap-2">
                <UButton
                    label="Abbrechen"
                    color="neutral"
                    variant="ghost"
                    @click="cancelEdit"
                />
                <UButton
                    label="Speichern"
                    icon="i-lucide-save"
                    color="primary"
                    @click="saveParticipant"
                />
            </div>
        </template>
    </DashboardModal>

        <!-- Delete Modal -->
        <DashboardDeleteModal
            v-model:open="isDeleteModalOpen"
            title="Teilnehmer löschen"
            :warning-text="`Teilnehmer ${selectedParticipant?.firstName} ${selectedParticipant?.lastName} wird permanent gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`"
            :on-delete="deleteParticipant"
        />
</template>
