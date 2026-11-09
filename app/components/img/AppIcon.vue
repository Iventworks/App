<script setup lang="ts">
/** The org's square icon, or the Iventworks mark. */
import { DEFAULT_BRAND } from "~/composables/stores/useInstanceStore";

const instance = useInstance();
const brandName = useBrandName();
const src = computed(() => instance.value?.org?.icon_url ?? DEFAULT_BRAND.icon);
</script>

<template>
	<img :src="src" :alt="brandName" class="object-contain" />
</template>
