<script setup lang="ts">
interface Props {
    searchPlaceholder?: string
    showSearch?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    searchPlaceholder: 'Suchen...',
    showSearch: true
})

const emit = defineEmits<{
    'update:search': [value: string]
}>()

const searchQuery = ref('')

watch(searchQuery, (value) => {
    emit('update:search', value)
})
</script>

<template>
    <div class="flex flex-wrap items-center gap-4">
        <UInput
            v-if="showSearch"
            v-model="searchQuery"
            icon="i-lucide-search"
            :placeholder="searchPlaceholder"
            class="w-64"
        />
        
        <slot name="filters" />
        
        <div v-if="$slots.actions" class="ml-auto flex gap-2">
            <slot name="actions" />
        </div>
    </div>
</template>
