<script setup lang="ts">
interface Props {
	label: string;
	value: string | number;
	icon?: string;
	color?: "primary" | "success" | "warning" | "error" | "info" | "neutral";
	description?: string;
	trend?: string;
}

const props = withDefaults(defineProps<Props>(), {
	color: "primary",
});
</script>

<template>
    <UCard>
        <div class="flex items-start justify-between">
            <div class="space-y-1">
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ label }}</p>
                <p class="text-2xl font-bold">{{ value }}</p>
                <p v-if="description" class="text-xs text-gray-500">{{ description }}</p>
            </div>
            <UIcon v-if="icon" :name="icon" :class="`text-${color}-500 w-8 h-8`" />
        </div>
        <div v-if="trend" class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p class="text-xs text-gray-600 dark:text-gray-400">{{ trend }}</p>
        </div>
    </UCard>
</template>
