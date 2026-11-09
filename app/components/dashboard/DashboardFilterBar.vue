<script setup lang="ts">
/**
 * Filters and the primary action above content that is not a `DashboardDataTable` (card grids,
 * calendars, task lists). Same card and layout as the DataTable header, so every list page reads
 * the same: filters `#left`, the primary action ("Neue Aufgabe") `#right`. Filters never go into
 * the `UDashboardToolbar` and create buttons never into the page header.
 */
</script>

<template>
	<!-- `shrink-0`: full-height pages (calendar, notes) lay the body out as a flex column. -->
	<UCard class="shrink-0 border-slate-800 bg-slate-900/60" :ui="{ body: 'p-4 sm:px-6 sm:py-4' }">
		<div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
			<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
				<slot name="left" />
			</div>
			<div v-if="$slots.right" class="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
				<slot name="right" />
			</div>
		</div>
	</UCard>
</template>
