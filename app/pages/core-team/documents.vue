<script setup lang="ts">
/**
 * Kernteam: the organisation library with everything in it. New items are Kernteam-only; "Zugriff"
 * opens them to all members, org groups or single people (with the share-link presets), "Teilen"
 * creates links for people without an account. Members see the result under /documents.
 */
definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Dokumente verwalten | Kernteam" });

const toast = useToast();
const sharingEnabled = computed(() => useInstance().value?.org?.file_sharing_enabled === true);

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
	<UDashboardPanel id="core-team-documents">
		<template #header>
			<DashboardPageHeader
				title="Dokumente verwalten"
				icon="i-lucide-library"
				description="Ablage des Kernteams – und was Mitglieder davon sehen"
			>
				<template #right>
					<UButton
						label="Mitgliederansicht"
						icon="i-lucide-eye"
						color="neutral"
						variant="subtle"
						to="/documents"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<FilesBrowser
					scope="org"
					root-label="Ablage"
					:load="load"
					:upload="upload"
					:create-folder="createFolder"
					manage-access
					:sharing-enabled="sharingEnabled"
					empty-description="Neue Ordner und Dateien sieht zuerst nur das Kernteam. Über „Zugriff“ gibst du sie für alle Mitglieder, Gruppen oder einzelne Personen frei."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
