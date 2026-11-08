<script setup lang="ts">
/** Organisation-wide audit log for admins; filters live in the URL so views can be shared. */
definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Audit-Log | Administration | CMP",
	description: "Wer hat wann was geändert",
});
</script>

<template>
	<UDashboardPanel id="admin-audit-log">
		<template #header>
			<DashboardPageHeader
				title="Audit-Log"
				icon="i-lucide-scroll-text"
				description="Alle Änderungen in der Organisation"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<AuditLogTable sync-url show-event />
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
