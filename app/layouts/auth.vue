<script setup lang="ts">

</script>

<template>
    <UMain class="main-content">
        <div class="app-layout">
            <!-- Main Content -->
            <UPageCard class="w-full max-w-md border-slate-800">
                <slot />
            </UPageCard>

        </div>
    </UMain>
</template>

<style scoped>
.app-layout {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin-top: -2rem;
}

.main-content {
    flex: 1;
}
</style>