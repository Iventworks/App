<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
    error: NuxtError
}>()

</script>

<template>
    <div class="app-layout">
        <!-- Navigation -->
        <Header />

        <!-- Main Content -->
        <UMain class="main-content">
            <UError :error="error" />
        </UMain>

        <!-- Footer -->
        <Footer />
    </div>
</template>

<style scoped>
.app-layout {
    min-height: 100vh;
    background-color: rgb(0 0 0);
    display: flex;
    flex-direction: column;
}

.main-content {
    flex: 1;
}
</style>