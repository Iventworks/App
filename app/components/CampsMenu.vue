<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  collapsed?: boolean
}>()

const teams = ref([
  {
    label: 'SkiWelt Wilder Kaiser 2025',
    avatar: {
      src: `${useAppURL()}/static/logo/crossover-favicon.png`,
      alt: 'SkiWelt Wilder Kaiser 2025'
    }
  }, {
    label: 'Orchesterfreizeit im Kloster 2025',
    avatar: {
      src: `${useAppURL()}/static/logo/crossover-favicon.png`,
      alt: 'Orchesterfreizeit im Kloster 2025'
    }
  }, {
    label: 'young+free Crottendorf 2025',
    avatar: {
      src: `${useAppURL()}/static/logo/crossover-favicon.png`,
      alt: 'young+free Crottendorf 2025'
    }
  }
])
const selectedTeam = ref(teams.value[0])

const items = computed<DropdownMenuItem[][]>(() => {
  return [teams.value.map(team => ({
    ...team,
    onSelect() {
      selectedTeam.value = team
    }
  })), [{
    label: 'Freizeit Erstellen',
    icon: 'i-lucide-circle-plus'
  }, {
    label: 'Freizeit Verwalten',
    icon: 'i-lucide-cog'
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
			content: collapsed ? 'w-40' : 'w-(--reka-dropdown-menu-trigger-width)'
		}"
	>
		<UButton
			v-bind="{
				...selectedTeam,
				label: collapsed ? undefined : selectedTeam?.label,
				trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
			}"
			color="neutral"
			variant="ghost"
			block
			:square="collapsed"
			class="data-[state=open]:bg-elevated"
			:class="[!collapsed && 'py-2']"
			:ui="{
				trailingIcon: 'text-dimmed'
			}"
		/>
	</UDropdownMenu>
</template>
