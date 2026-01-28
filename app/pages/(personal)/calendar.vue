<script setup lang="ts">

export interface CalendarEntry {
    id: number;
    title: string;
    description?: string;
    
    // Timestamps in milliseconds
    startTime: number;
    endTime: number;
}

interface CalendarData {
    // Key format: "YYYY-MM-DD"
    // Value: Array of entries falling on that day
    [startDateKey: string]: CalendarEntry[];
}

// mock data structure
const calendarData = ref<CalendarData>({
    ["2026-01-16"]: [
        {
            id: 1,
            title: "young+free Crottendorf Planungstreffen",
            description: "Planungstreffen für die young+free Crottendorf Winterfreizeit 2026",
            startTime: new Date("2026-01-16T18:00:00").getTime(),
            endTime: new Date("2026-01-17T18:00:00").getTime(),
        }
    ],
    ["2026-01-28"]: [
        {
            id: 2,
            title: "Meeting mit Lukas Pohl",
            description: "Meeting mit Lukas Pohl bezüglich des neuen Projekts",
            startTime: new Date("2026-01-28T18:00:00").getTime(),
            endTime: new Date("2026-01-28T19:30:00").getTime(),
        }
    ],
    ["2026-02-15"]: [
        {
            id: 3,
            title: "young+free Crottendorf 2026",
            description: "young+free Crottendorf Winterfreizeit 2026",
            startTime: new Date("2026-02-15T00:00:00").getTime(),
            endTime: new Date("2026-02-21T23:59:59").getTime()
        }
    ]
});

// Current view state
const currentDate = ref(new Date());
const selectedDate = ref<Date | null>(null);

// Computed properties
const currentMonth = computed(() => currentDate.value.getMonth());
const currentYear = computed(() => currentDate.value.getFullYear());

const monthName = computed(() => {
    return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(currentDate.value);
});

const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Get calendar days for the current month view
const calendarDays = computed(() => {
    const year = currentYear.value;
    const month = currentMonth.value;
    
    // First day of the month
    const firstDay = new Date(year, month, 1);
    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);
    
    // Get the day of week (0 = Sunday, 1 = Monday, etc.)
    // Convert to Monday-based (0 = Monday)
    let firstDayOfWeek = firstDay.getDay() - 1;
    if (firstDayOfWeek < 0) firstDayOfWeek = 6;
    
    const days: Array<{
        date: Date;
        dateKey: string;
        isCurrentMonth: boolean;
        isToday: boolean;
        isSelected: boolean;
        events: CalendarEntry[];
    }> = [];
    
    // Add days from previous month
    const prevMonthLastDay = new Date(year, month, 0);
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
        const date = new Date(year, month - 1, prevMonthLastDay.getDate() - i);
        const dateKey = formatDateKey(date);
        days.push({
            date,
            dateKey,
            isCurrentMonth: false,
            isToday: false,
            isSelected: false,
            events: calendarData.value[dateKey] || []
        });
    }
    
    // Add days from current month
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateKey = formatDateKey(date);
        const isToday = date.getTime() === today.getTime();
        const isSelected = selectedDate.value ? date.getTime() === new Date(selectedDate.value).setHours(0, 0, 0, 0) : false;
        
        days.push({
            date,
            dateKey,
            isCurrentMonth: true,
            isToday,
            isSelected,
            events: getEventsForDate(dateKey)
        });
    }
    
    // Add days from next month to fill the grid
    const remainingDays = 42 - days.length; // 6 weeks * 7 days
    for (let day = 1; day <= remainingDays; day++) {
        const date = new Date(year, month + 1, day);
        const dateKey = formatDateKey(date);
        days.push({
            date,
            dateKey,
            isCurrentMonth: false,
            isToday: false,
            isSelected: false,
            events: calendarData.value[dateKey] || []
        });
    }
    
    return days;
});

// Get events that occur on or span across a specific date
function getEventsForDate(dateKey: string): CalendarEntry[] {
    const date = new Date(dateKey);
    date.setHours(0, 0, 0, 0);
    const dayStart = date.getTime();
    const dayEnd = new Date(date).setHours(23, 59, 59, 999);
    
    const allEvents: CalendarEntry[] = [];
    
    // Check all events to see if they occur on this day
    for (const [key, events] of Object.entries(calendarData.value)) {
        for (const event of events) {
            // Event spans or touches this day
            if (event.startTime <= dayEnd && event.endTime >= dayStart) {
                allEvents.push(event);
            }
        }
    }
    
    return allEvents;
}

// Selected day events
const selectedDayEvents = computed(() => {
    if (!selectedDate.value) return [];
    const dateKey = formatDateKey(selectedDate.value);
    return getEventsForDate(dateKey);
});

// Helper functions
function formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
    }).format(new Date(timestamp));
}

function formatEventDate(event: CalendarEntry): string {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    
    const isSameDay = start.toDateString() === end.toDateString();
    
    if (isSameDay) {
        // Check if it's an all-day event (00:00 to 23:59)
        if (start.getHours() === 0 && start.getMinutes() === 0 && 
            end.getHours() === 23 && end.getMinutes() === 59) {
            return 'Ganztägig';
        }
        return `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`;
    } else {
        return `${start.toLocaleDateString('de-DE')} - ${end.toLocaleDateString('de-DE')}`;
    }
}

// Navigation functions
function previousMonth() {
    currentDate.value = new Date(currentYear.value, currentMonth.value - 1, 1);
}

function nextMonth() {
    currentDate.value = new Date(currentYear.value, currentMonth.value + 1, 1);
}

function goToToday() {
    currentDate.value = new Date();
    selectedDate.value = new Date();
}

function selectDate(date: Date) {
    selectedDate.value = date;
}

function isMultiDayEvent(event: CalendarEntry): boolean {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return end.getTime() > start.getTime();
}

// Initialize selected date to today
onMounted(() => {
    selectedDate.value = new Date();
});

</script>

<template>
    <UDashboardPanel>
        <template #header>
            <DashboardPageHeader
                title="Mein Kalender"
                icon="i-lucide-calendar"
                description="Eine Übersicht Ihrer Kalendertermine"
            />
        </template>

        <template #body>
            <DashboardPageBody>
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <!-- Calendar View -->
                    <div class="lg:col-span-2">
                        <UCard>
                            <!-- Calendar Header -->
                            <template #header>
                                <div class="flex items-center justify-between">
                                    <h2 class="text-xl font-semibold capitalize">{{ monthName }}</h2>
                                    <div class="flex items-center gap-2">
                                        <UButton
                                            icon="i-lucide-calendar-days"
                                            color="neutral"
                                            variant="soft"
                                            @click="goToToday"
                                            size="sm"
                                        >
                                            Heute
                                        </UButton>
                                        <UButton
                                            icon="i-lucide-chevron-left"
                                            color="neutral"
                                            variant="ghost"
                                            @click="previousMonth"
                                            size="sm"
                                        />
                                        <UButton
                                            icon="i-lucide-chevron-right"
                                            color="neutral"
                                            variant="ghost"
                                            @click="nextMonth"
                                            size="sm"
                                        />
                                    </div>
                                </div>
                            </template>

                            <!-- Calendar Grid -->
                            <div class="calendar-grid">
                                <!-- Week day headers -->
                                <div class="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-800 border-b">
                                    <div
                                        v-for="day in weekDays"
                                        :key="day"
                                        class="bg-gray-50 dark:bg-gray-900 py-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300"
                                    >
                                        {{ day }}
                                    </div>
                                </div>

                                <!-- Calendar days -->
                                <div class="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-800">
                                    <div
                                        v-for="day in calendarDays"
                                        :key="day.dateKey"
                                        class="min-h-25 bg-white dark:bg-gray-950 p-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors relative"
                                        :class="{
                                            'bg-primary-50 dark:bg-primary-950 hover:bg-primary-100 dark:hover:bg-primary-900': day.isSelected,
                                            'ring-2 ring-primary-500 ring-inset': day.isToday
                                        }"
                                        @click="selectDate(day.date)"
                                    >
                                        <!-- Day number -->
                                        <div class="flex items-center justify-between mb-1">
                                            <span
                                                class="text-sm font-medium"
                                                :class="{
                                                    'text-gray-400 dark:text-gray-600': !day.isCurrentMonth,
                                                    'text-primary-600 dark:text-primary-400 font-bold': day.isToday,
                                                    'text-gray-900 dark:text-gray-100': day.isCurrentMonth && !day.isToday
                                                }"
                                            >
                                                {{ day.date.getDate() }}
                                            </span>
                                            <UBadge
                                                v-if="day.events.length > 0"
                                                color="primary"
                                                variant="solid"
                                                size="xs"
                                            >
                                                {{ day.events.length }}
                                            </UBadge>
                                        </div>

                                        <!-- Events -->
                                        <div class="space-y-1">
                                            <div
                                                v-for="(event, idx) in day.events.slice(0, 2)"
                                                :key="event.id"
                                                class="text-xs px-1.5 py-0.5 rounded truncate"
                                                :class="{
                                                    'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300': isMultiDayEvent(event),
                                                    'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300': !isMultiDayEvent(event)
                                                }"
                                                :title="event.title"
                                            >
                                                {{ event.title }}
                                            </div>
                                            <div
                                                v-if="day.events.length > 2"
                                                class="text-xs text-gray-500 dark:text-gray-400 px-1.5"
                                            >
                                                +{{ day.events.length - 2 }} weitere
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </UCard>
                    </div>

                    <!-- Event Details Sidebar -->
                    <div class="lg:col-span-1">
                        <UCard>
                            <template #header>
                                <div class="flex items-center gap-2">
                                    <UIcon name="i-lucide-calendar-check" class="w-5 h-5" />
                                    <h3 class="font-semibold">
                                        {{ selectedDate ? new Intl.DateTimeFormat('de-DE', { 
                                            day: 'numeric', 
                                            month: 'long', 
                                            year: 'numeric' 
                                        }).format(selectedDate) : 'Datum auswählen' }}
                                    </h3>
                                </div>
                            </template>

                            <div v-if="selectedDayEvents.length === 0" class="text-center py-8">
                                <UIcon name="i-lucide-calendar-x" class="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600 mb-3" />
                                <p class="text-gray-500 dark:text-gray-400 text-sm">
                                    Keine Termine für diesen Tag
                                </p>
                            </div>

                            <div v-else class="space-y-3">
                                <UCard
                                    v-for="event in selectedDayEvents"
                                    :key="event.id"
                                    :ui="{ 
                                        body: 'p-3',
                                        root: 'ring-1 ring-gray-200 dark:ring-gray-800'
                                    }"
                                >
                                    <div class="space-y-2">
                                        <div class="flex items-start justify-between gap-2">
                                            <h4 class="font-medium text-sm line-clamp-2">{{ event.title }}</h4>
                                            <UBadge
                                                :color="isMultiDayEvent(event) ? 'primary' : 'info'"
                                                variant="subtle"
                                                size="xs"
                                            >
                                                {{ isMultiDayEvent(event) ? 'Mehrtägig' : 'Eintägig' }}
                                            </UBadge>
                                        </div>
                                        
                                        <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                                            <UIcon name="i-lucide-clock" class="w-3.5 h-3.5" />
                                            <span>{{ formatEventDate(event) }}</span>
                                        </div>
                                        
                                        <p v-if="event.description" class="text-xs text-gray-600 dark:text-gray-400 line-clamp-3">
                                            {{ event.description }}
                                        </p>
                                    </div>
                                </UCard>
                            </div>
                        </UCard>

                        <!-- Quick Stats Card -->
                        <UCard class="mt-4">
                            <template #header>
                                <div class="flex items-center gap-2">
                                    <UIcon name="i-lucide-info" class="w-5 h-5" />
                                    <h3 class="font-semibold">Übersicht</h3>
                                </div>
                            </template>

                            <div class="space-y-3">
                                <div class="flex items-center justify-between">
                                    <span class="text-sm text-gray-600 dark:text-gray-400">Termine diesen Monat</span>
                                    <UBadge color="primary" variant="subtle">
                                        {{ Object.values(calendarData).flat().filter(e => {
                                            const eventDate = new Date(e.startTime);
                                            return eventDate.getMonth() === currentMonth && eventDate.getFullYear() === currentYear;
                                        }).length }}
                                    </UBadge>
                                </div>
                                <div class="flex items-center justify-between">
                                    <span class="text-sm text-gray-600 dark:text-gray-400">Termine heute</span>
                                    <UBadge color="info" variant="subtle">
                                        {{ getEventsForDate(formatDateKey(new Date())).length }}
                                    </UBadge>
                                </div>
                            </div>
                        </UCard>
                    </div>
                </div>
            </DashboardPageBody>
        </template>
    </UDashboardPanel>
</template>

<style scoped>
.calendar-grid {
    overflow: hidden;
    border-radius: 0.5rem;
    border: 1px solid rgb(229 231 235);
}

:global(.dark) .calendar-grid {
    border-color: rgb(31 41 55);
}
</style>