<script setup lang="ts">
/**
 * The organisation library ("Dokumente & Leitfäden"): guides, templates and tools for everyone in
 * the organisation. Read-only for volunteers; maintained by the Kernteam.
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Dokumente & Leitfäden",
	description: "Leitfäden, Vorlagen und Werkzeuge für alle in der Organisation",
});

const user = await useUserInfoStore().use();
const toast = useToast();

const canWrite = computed(() => hasOrgRole(user.value?.role, "core_team"));
// Share links for externals: library managers, while the org allows them.
const canShare = computed(
	() => canWrite.value && useInstance().value?.org?.file_sharing_enabled === true,
);

async function load(parentId: number | null) {
	const result = await useAPI((api) =>
		api.getOrgDocuments({ query: { parent_id: parentId ?? undefined } }),
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
		api.postOrgDocuments({ body: { file, parent_id: parentId ?? undefined } }),
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
		api.postOrgDocumentsFolders({ body: { name, parent_id: parentId } }),
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
</script>

<template>
	<UDashboardPanel id="org-documents">
		<template #header>
			<DashboardPageHeader
				title="Dokumente & Leitfäden"
				icon="i-lucide-library"
				description="Für alle in der Organisation"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<UAlert
					v-if="!canWrite"
					icon="i-lucide-info"
					color="neutral"
					variant="subtle"
					title="Nur lesen"
					description="Diese Bibliothek wird vom Kernteam gepflegt. Fehlt etwas oder ist veraltet? Sag dem Kernteam Bescheid."
				/>

				<FilesBrowser
					root-label="Bibliothek"
					:load="load"
					:upload="canWrite ? upload : undefined"
					:create-folder="canWrite ? createFolder : undefined"
					:can-write="canWrite"
					:can-manage="() => canWrite"
					:can-share="() => canShare"
					empty-description="Hier legt das Kernteam Leitfäden, Vorlagen und Werkzeuge für alle ab."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
