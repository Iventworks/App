<script setup lang="ts">

</script>

<template>
    <UDashboardPanel>

        <template #header>
            <DashboardPageHeader
                title="Meine Aufgaben"
                icon="i-lucide-list-checks"
                description="Eine Übersicht Ihrer aktuellen Aufgaben"
            />
        </template>

        <template #body>
            <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-3xl mx-auto">
                <NuxtPage />
            </div>
        </template>

    </UDashboardPanel>
</template>