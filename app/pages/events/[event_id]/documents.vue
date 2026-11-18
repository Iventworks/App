<script setup lang="ts">
/**
 * Event documents: folders and files of the event's team. Everyone on the team may view and
 * upload unless a folder or file has its own access list ("Zugriff": only the Leitung, groups or
 * single people); uploaders may rename, move and delete their own files. The Leitung (and the
 * Kernteam) may do everything, change access and create share links.
 */
definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Dokumente | ${event.value.name}` });

async function load(parentId: number | null) {
	const result = await useAPI((api) =>
		api.getEventsByEventIdFiles({
			path: { eventId: eventId.value },
			query: { parent_id: parentId ?? undefined },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Dokumente konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data;
}

async function upload(file: File, parentId: number | null) {
	const result = await useAPI((api) =>
		api.postEventsByEventIdFiles({
			path: { eventId: eventId.value },
			body: { file, parent_id: parentId ?? undefined },
		}),
	);
	if (!result.success) {
		toast.add({
			title: `„${file.name}“ konnte nicht hochgeladen werden`,
			description: result.message,
			color: "error",
		});
	}
	return result.success;
}

async function createFolder(name: string, parentId: number | null) {
	const result = await useAPI((api) =>
		api.postEventsByEventIdFilesFolders({
			path: { eventId: eventId.value },
			body: { name, parent_id: parentId },
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Ordner konnte nicht angelegt werden",
			description: result.message,
			color: "error",
		});
	}
	return result.success;
}

// Share links for externals: only the Leitung creates them, while the org allows them.
const sharingEnabled = computed(() => useInstance().value?.org?.file_sharing_enabled === true);
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
					:load="load"
					:upload="upload"
					:create-folder="createFolder"
					:manage-access="can('files:manage_all')"
					:sharing-enabled="sharingEnabled"
					empty-description="Lade Ablaufpläne, Präsentationen, Listen oder Fotos für das Team hoch."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
