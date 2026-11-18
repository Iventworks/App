<script setup lang="ts">
/**
 * Event documents: folders and files of the event's team. Everyone on the team may view and
 * upload unless a folder or file has its own access list ("Zugriff": only the Leitung, groups or
 * single people); uploaders may rename, move and delete their own files. The Leitung (and the
 * Kernteam) may do everything, change access and create share links.
 */
definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();

useSeoMeta({ title: `Dokumente | ${event.value.name}` });

// Share links for externals: only the Leitung creates them, while the org allows them.
const sharingEnabled = computed(() => useInstance().value?.org?.file_sharing_enabled === true);

const library = useDocumentLibrary({ scope: "event", eventId: () => eventId.value });
</script>

<template>
	<UDashboardPanel id="event-documents">
		<template #header>
			<DashboardPageHeader title="Dokumente" icon="i-lucide-folder" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<FilesBrowser
					scope="event"
					:root-label="`Dokumente – ${event.name}`"
					v-bind="library"
					:manage-access="can('files:manage_all')"
					:sharing-enabled="sharingEnabled"
					empty-description="Lade Ablaufpläne, Präsentationen, Listen oder Fotos für das Team hoch."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
