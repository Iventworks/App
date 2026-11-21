<script setup lang="ts">
/**
 * Kernteam: the organisation library with everything in it. New items are Kernteam-only; "Zugriff"
 * opens them to all members, org groups or single people (with the share-link presets), "Teilen"
 * creates links for people without an account. Members see the result under /documents.
 */
definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Dokumente verwalten | Kernteam" });

const library = useDocumentLibrary({ scope: "org" });
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
					v-bind="library"
					empty-description="Neue Ordner und Dateien sieht zuerst nur das Kernteam. Über „Zugriff“ gibst du sie für alle Mitglieder, Gruppen oder einzelne Personen frei."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
