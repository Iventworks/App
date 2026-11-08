<script setup lang="ts">
/**
 * Event documents: folders and files shared with the event's staff. Everyone on the team may
 * upload; uploaders and leaders may rename, move and delete.
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { FileItem } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const user = await useUserInfoStore().use();
const toast = useToast();

useSeoMeta({ title: `Dokumente | ${event.value.name} | CMP` });

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

function canManage(item: FileItem) {
	return can("files:manage_all") || (can("files:upload") && item.uploaded_by === user.value?.id);
}
</script>

<template>
	<UDashboardPanel id="event-documents">
		<template #header>
			<DashboardPageHeader title="Dokumente" icon="i-lucide-folder" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<FilesBrowser
					:root-label="`Dokumente – ${event.name}`"
					:load="load"
					:upload="upload"
					:create-folder="createFolder"
					:can-write="can('files:upload')"
					:can-manage="canManage"
					empty-description="Lade Ablaufpläne, Präsentationen, Listen oder Fotos für das Team hoch."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
