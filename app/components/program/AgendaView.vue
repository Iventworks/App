<script setup lang="ts">
/**
 * The program as an agenda per day, or its empty state. Used by the "Liste" view and by the
 * "Wochenplan" view on phones; reads the shared state of the program page.
 */
const { listDays, visibleItems, showEmpty, onlyMine, editable, openItem } = useEventProgramView();
</script>

<template>
	<UEmpty
		v-if="showEmpty"
		icon="i-lucide-calendar-range"
		:title="onlyMine ? 'Dir ist kein Programmpunkt zugeteilt' : 'Noch kein Programm'"
		:description="editable ? 'Lege den ersten Programmpunkt an.' : 'Die Leitung plant das Programm hier.'"
	/>
	<ProgramAgendaList v-else :days="listDays" :items="visibleItems" @open="openItem" />
</template>
