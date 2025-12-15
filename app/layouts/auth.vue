<script setup lang="ts">

</script>

<template>
    <div class="app-layout">
        <!-- Navigation -->
        <Header />

        <!-- Main Content -->
        <UMain class="main-content">
            <UPageCard class="w-full max-w-md border-slate-800">
                <slot />
            </UPageCard>
        </UMain>

        <!-- Footer -->
        <Footer />
    </div>
</template>

<style scoped>
.app-layout {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

.main-content {
    flex: 1;
}
</style>