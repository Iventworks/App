<script setup lang="ts">
/** Event audit log for leaders: who changed what in this event; filters live in the URL. */
definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();

useSeoMeta({ title: `Audit-Log | ${event.value.name}` });

if (!can("audit_log:view")) {
	throw createError({
		statusCode: 403,
		statusMessage: "Das Audit-Log ist nur für die Leitung sichtbar.",
		fatal: true,
	});
}
</script>

<template>
	<UDashboardPanel id="event-audit-log">
		<template #header>
			<DashboardPageHeader title="Audit-Log" icon="i-lucide-scroll-text" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<AuditLogTable :event-id="eventId" sync-url />
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
