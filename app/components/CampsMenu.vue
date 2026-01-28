<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useRuntimeAppConfigs } from '~/composables/useRuntimeAppConfigs';

defineProps<{
	collapsed?: boolean
}>()

const teams = ref([
	{
		id: 1,
		label: 'SkiWelt Wilder Kaiser 2025',
		avatar: {
			src: `${useRuntimeAppConfigs().appUrl}/static/logo/crossover-favicon.png`,
			alt: 'SkiWelt Wilder Kaiser 2025'
		}
	},
	{
		id: 2,
		label: 'Orchesterfreizeit im Kloster 2025',
		avatar: {
			src: `${useRuntimeAppConfigs().appUrl}/static/logo/crossover-favicon.png`,
			alt: 'Orchesterfreizeit im Kloster 2025'
		}
	},
	{
		id: 3,
		label: 'young+free Crottendorf 2025',
		avatar: {
			src: `${useRuntimeAppConfigs().appUrl}/static/logo/crossover-favicon.png`,
			alt: 'young+free Crottendorf 2025'
		}
	}
])
const selectedCampOrEvent = useSelectedCampOrEvent();
if (!selectedCampOrEvent.value) {
	selectedCampOrEvent.value = teams.value[0] || null;
}

const items = computed<DropdownMenuItem[][]>(() => {
	return [teams.value.map(team => ({
		...team,
		onSelect() {
			selectedCampOrEvent.value = team
		}
	})), [{
		label: 'Freizeit Erstellen',
		icon: 'i-lucide-circle-plus'
	}, {
		label: 'Event Erstellen',
		icon: 'i-lucide-circle-plus'
	}]]
})
</script>

<template>
	<UDropdownMenu
		:items="items"
		:content="{
			align: 'center',
			collisionPadding: 12
		}"
		:ui="{
			viewport: 'main-bg-color',
			content: collapsed ? 'w-40' : 'w-(--reka-dropdown-menu-trigger-width)'
		}"
	>
		<UButton
			v-bind="{
				...selectedCampOrEvent,
				label: collapsed ? undefined : selectedCampOrEvent?.label,
				trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
			}"
			color="neutral" variant="ghost" block :square="collapsed" class="data-[state=open]:bg-elevated"
			:class="[!collapsed && 'py-2']"
			:ui="{
				trailingIcon: 'text-dimmed'
			}"
		/>
	</UDropdownMenu>
</template>
