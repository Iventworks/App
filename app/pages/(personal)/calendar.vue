<script setup lang="ts">
import { type DateValue, getLocalTimeZone, today } from "@internationalized/date";

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
		},
	],
	["2026-01-28"]: [
		{
			id: 2,
			title: "Meeting mit Lukas Pohl",
			description: "Meeting mit Lukas Pohl bezüglich des neuen Projekts",
			startTime: new Date("2026-01-28T18:00:00").getTime(),
			endTime: new Date("2026-01-28T19:30:00").getTime(),
		},
	],
	["2026-02-15"]: [
		{
			id: 3,
			title: "young+free Crottendorf 2026",
			description: "young+free Crottendorf Winterfreizeit 2026",
			startTime: new Date("2026-02-15T00:00:00").getTime(),
			endTime: new Date("2026-02-21T23:59:59").getTime(),
		},
	],
});

const timeZone = getLocalTimeZone();

// Current view state: the month shown by UCalendar and the selected day
const displayedMonth = shallowRef<DateValue>(today(timeZone));
const selectedDay = shallowRef<DateValue | undefined>(today(timeZone));

const selectedDate = computed(() => selectedDay.value?.toDate(timeZone) ?? null);

// Computed properties
const currentMonth = computed(() => displayedMonth.value.month - 1);
const currentYear = computed(() => displayedMonth.value.year);

const monthName = computed(() => {
	return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
		displayedMonth.value.toDate(timeZone),
	);
});

function eventsForDay(day: DateValue): CalendarEntry[] {
	// DateValue.toString() is "YYYY-MM-DD", the same format as the calendarData keys
	return getEventsForDate(day.toString());
}

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
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatTime(timestamp: number): string {
	return new Intl.DateTimeFormat("de-DE", {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(timestamp));
}

function formatEventDate(event: CalendarEntry): string {
	const start = new Date(event.startTime);
	const end = new Date(event.endTime);

	const isSameDay = start.toDateString() === end.toDateString();

	if (isSameDay) {
		// Check if it's an all-day event (00:00 to 23:59)
		if (
			start.getHours() === 0 &&
			start.getMinutes() === 0 &&
			end.getHours() === 23 &&
			end.getMinutes() === 59
		) {
			return "Ganztägig";
		}
		return `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`;
	} else {
		return `${start.toLocaleDateString("de-DE")} - ${end.toLocaleDateString("de-DE")}`;
	}
}

// Navigation functions
function previousMonth() {
	displayedMonth.value = displayedMonth.value.subtract({ months: 1 }).set({ day: 1 });
}

function nextMonth() {
	displayedMonth.value = displayedMonth.value.add({ months: 1 }).set({ day: 1 });
}

function goToToday() {
	displayedMonth.value = today(timeZone);
	selectedDay.value = today(timeZone);
}

function isMultiDayEvent(event: CalendarEntry): boolean {
	const start = new Date(event.startTime);
	const end = new Date(event.endTime);
	start.setHours(0, 0, 0, 0);
	end.setHours(0, 0, 0, 0);
	return end.getTime() > start.getTime();
}
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
                            <UCalendar
                                v-model="selectedDay"
                                v-model:placeholder="displayedMonth"
                                locale="de-DE"
                                :week-starts-on="1"
                                weekday-format="short"
                                fixed-weeks
                                color="primary"
                                variant="soft"
                                :ui="{
                                    root: 'w-full',
                                    header: 'hidden',
                                    body: 'pt-0',
                                    grid: 'space-y-0 overflow-hidden rounded-lg border border-default',
                                    gridWeekDaysRow: 'mb-0 gap-px border-b border-default bg-elevated/50',
                                    headCell: 'py-2 text-center text-sm font-medium text-toned',
                                    gridBody: 'gap-px bg-accented',
                                    gridRow: 'gap-px place-items-stretch',
                                    cell: 'w-full bg-default text-left',
                                    cellTrigger: 'm-0 size-auto w-full min-h-14 sm:min-h-25 flex-col items-stretch justify-start gap-1 rounded-none p-1 sm:p-2 whitespace-normal cursor-pointer data-today:ring-2 data-today:ring-inset data-today:ring-primary-500',
                                }"
                            >
                                <!-- "Mo." → "Mo", as in the previous grid -->
                                <template #week-day="{ day }">
                                    {{ day.replace(".", "") }}
                                </template>

                                <template #day="{ day }">
                                    <!-- Day number -->
                                    <div class="flex items-center justify-center sm:justify-between">
                                        <span class="text-sm font-medium">{{ day.day }}</span>
                                        <UBadge
                                            v-if="eventsForDay(day).length > 0"
                                            color="primary"
                                            variant="solid"
                                            size="xs"
                                            class="hidden sm:inline-flex"
                                        >
                                            {{ eventsForDay(day).length }}
                                        </UBadge>
                                    </div>

                                    <!-- Events (titles from sm, dots on phones) -->
                                    <div class="hidden sm:block space-y-1">
                                        <div
                                            v-for="event in eventsForDay(day).slice(0, 2)"
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
                                            v-if="eventsForDay(day).length > 2"
                                            class="text-xs text-gray-500 dark:text-gray-400 px-1.5"
                                        >
                                            +{{ eventsForDay(day).length - 2 }} weitere
                                        </div>
                                    </div>
                                    <div v-if="eventsForDay(day).length > 0" class="flex sm:hidden justify-center gap-0.5">
                                        <span
                                            v-for="event in eventsForDay(day).slice(0, 3)"
                                            :key="event.id"
                                            class="size-1.5 rounded-full"
                                            :class="isMultiDayEvent(event) ? 'bg-primary-500' : 'bg-sky-500'"
                                        />
                                    </div>
                                </template>
                            </UCalendar>
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
