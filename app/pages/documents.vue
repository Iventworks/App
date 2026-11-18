<script setup lang="ts">
/**
 * The organisation library ("Dokumente & Leitfäden") as members see it: what the Kernteam opened
 * to everyone, to their groups or to them — with what they may do there. The Kernteam manages
 * the library (access, share links, Kernteam-only items) under /core-team/documents; here it sees
 * the member view too (`view=member`).
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Dokumente & Leitfäden",
	description: "Leitfäden, Vorlagen und Werkzeuge für alle in der Organisation",
});

const user = await useUserInfoStore().use();
const toast = useToast();

const canManage = computed(() => hasOrgRole(user.value?.role, "core_team"));

async function load(parentId: number | null) {
	const result = await useAPI((api) =>
		api.getOrgDocuments({ query: { parent_id: parentId ?? undefined, view: "member" } }),
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
async function createMarkdown(name: string, parentId: number | null) {
	const result = await useAPI((api) =>
		api.postOrgDocumentsMarkdown({ body: { name, parent_id: parentId } }),
	);
	if (!result.success) {
		toast.add({
			title: "Dokument konnte nicht angelegt werden",
			description: result.message,
			color: "error",
		});
		return null;
	}
	return result.data;
}
</script>

<template>
	<UDashboardPanel id="org-documents">
		<template #header>
			<DashboardPageHeader
				title="Dokumente & Leitfäden"
				icon="i-lucide-library"
				description="Aus der Organisation"
			>
				<template #right>
					<UButton
						v-if="canManage"
						label="Verwalten"
						icon="i-lucide-settings-2"
						color="neutral"
						variant="subtle"
						to="/core-team/documents"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody>
				<FilesBrowser
					scope="org"
					root-label="Bibliothek"
					:load="load"
					:upload="upload"
					:create-folder="createFolder"
					:create-markdown="createMarkdown"
					empty-description="Hier legt das Kernteam Leitfäden, Vorlagen und Werkzeuge ab. Fehlt etwas oder ist veraltet? Sag dem Kernteam Bescheid."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
