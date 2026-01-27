<script setup lang="ts">

</script>

<template>
    <UDashboardPanel>

        <template #header>
            <DashboardPageHeader
                title="Chats"
                icon="i-lucide-message-circle"
                description="Deine Chats"
            />
        </template>

        <template #body>
            <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-3xl mx-auto">
                <NuxtPage />
            </div>
        </template>

    </UDashboardPanel>
</template>