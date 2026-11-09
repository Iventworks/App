<script setup lang="ts">
/**
 * The logo for this host: the org's uploaded logo, else its icon with its name. The system
 * dashboard (and an org still called "Iventworks") shows the Iventworks wordmark.
 */
import { DEFAULT_BRAND } from "~/composables/stores/useInstanceStore";

const instance = useInstance();
const brandName = useBrandName();

const org = computed(() => instance.value?.org ?? null);
const isSystem = computed(() => instance.value?.kind === "system");
const showWordmark = computed(
	() =>
		!org.value?.logo_url &&
		(isSystem.value || !org.value || org.value.display_name === instance.value?.app_name),
);
</script>

<template>
	<span class="inline-flex items-center gap-2">
		<img v-if="org?.logo_url" :src="org.logo_url" :alt="brandName" class="h-full w-auto object-contain" />
		<template v-else-if="showWordmark">
			<img :src="DEFAULT_BRAND.logo" :alt="instance?.app_name ?? 'Iventworks'" class="h-full w-auto" />
			<UBadge v-if="isSystem" color="neutral" variant="subtle" size="sm">System</UBadge>
		</template>
		<template v-else>
			<ImgAppIcon class="h-full w-auto" />
			<span class="flex min-w-0 flex-col leading-none">
				<span class="truncate text-xl font-bold">{{ org?.display_name }}</span>
				<span class="text-xs font-medium text-slate-400">{{ instance?.app_name }}</span>
			</span>
		</template>
	</span>
</template>
