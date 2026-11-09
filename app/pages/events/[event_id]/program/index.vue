<script setup lang="ts">
/** "Wochenplan": the program as a week grid (the agenda on phones). */
definePageMeta({ layout: "dashboard" });

const { days, visibleItems, isNarrow, editable, openItem, openCreate, onMove } =
	useEventProgramView();
</script>

<template>
	<ProgramAgendaView v-if="isNarrow" />

	<div v-else class="space-y-6">
		<p v-if="editable" class="program-no-print text-sm text-slate-400">
			Ziehe Programmpunkte, um sie zu verschieben, am unteren Rand, um die Dauer zu ändern, oder
			in einen freien Bereich, um einen neuen anzulegen.
		</p>

		<ProgramWeekGrid
			:days="days"
			:items="visibleItems"
			:editable="editable"
			@open="openItem"
			@create="openCreate"
			@move="onMove"
		/>
	</div>
</template>
