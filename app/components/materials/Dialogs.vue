<script setup lang="ts">
/**
 * The dialogs of the event material pages, rendered once by `/events/[event_id]/materials`; the
 * child pages open them through `useEventMaterials()`.
 */
const { manage, recurring } = useEventMaterials();
</script>

<template>
	<MaterialsEntryModal />
	<MaterialsRequestModal />
	<MaterialsBoughtModal />
	<MaterialsLinksModal />
	<template v-if="manage">
		<MaterialsDecideModal />
		<MaterialsPeriodModal v-if="!recurring" />
	</template>
</template>
