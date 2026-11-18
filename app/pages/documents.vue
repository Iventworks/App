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

const canManage = computed(() => hasOrgRole(user.value?.role, "core_team"));

const library = useDocumentLibrary({ scope: "org", memberView: true });
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
					v-bind="library"
					empty-description="Hier legt das Kernteam Leitfäden, Vorlagen und Werkzeuge ab. Fehlt etwas oder ist veraltet? Sag dem Kernteam Bescheid."
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
