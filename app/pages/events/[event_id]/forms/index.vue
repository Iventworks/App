<script setup lang="ts">
/**
 * The event's forms, for its Leitung: feedback, registrations, surveys — published with a link
 * and QR code that anyone can answer. The answers may hold personal data, so the rest of the team
 * doesn't see them.
 */
import type { FormSummary } from "~/utils/forms";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Formulare | ${event.value.name}` });

if (!can("forms:manage")) {
	throw createError({
		statusCode: 403,
		statusMessage: "Formulare sind nur für die Leitung.",
		fatal: true,
	});
}

const basePath = computed(() => `/events/${eventId.value}/forms`);

const {
	data: forms,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-forms`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdForms({ path: { eventId: eventId.value } }),
	);
	if (!result.success) {
		toast.add({
			title: "Formulare konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as FormSummary[];
	}
	return result.data;
});

const createOpen = ref(false);

async function create(body: { title: string; template_id: number | null }) {
	const result = await useAPI((api) =>
		api.postEventsByEventIdForms({ path: { eventId: eventId.value }, body }),
	);
	if (!result.success) {
		toast.add({ title: "Anlegen fehlgeschlagen", description: result.message, color: "error" });
		return null;
	}
	return result.data;
}
</script>

<template>
	<UDashboardPanel id="event-forms">
		<template #header>
			<DashboardPageHeader title="Formulare" icon="i-lucide-clipboard-list" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody>
				<FormsList
					:forms="forms ?? []"
					:loading="loading"
					:base-path="basePath"
					@refresh="refresh()"
					@create="createOpen = true"
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<FormsCreateModal
		v-model:open="createOpen"
		kind="form"
		:create="create"
		@created="navigateTo(`${basePath}/${$event}`)"
	/>
</template>
