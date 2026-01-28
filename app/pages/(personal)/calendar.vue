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
            endTime: new Date("2026-01-28T18:00:00").getTime(),
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
                
            </DashboardPageBody>
        </template>

    </UDashboardPanel>
</template>