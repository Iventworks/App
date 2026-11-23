<script setup lang="ts">
/**
 * The event's forms: feedback, registrations, surveys — published with a link and QR code that
 * anyone can answer. The whole team creates and works on them; the Leitung can keep a form for
 * itself (the answers may hold personal data), the rest of the team then only sees that it exists.
 */
import type { FormSummary } from "~/utils/forms";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Formulare | ${event.value.name}` });

if (!can("forms:view")) {
	throw createError({
		statusCode: 403,
		statusMessage: "Du siehst die Formulare dieses Events nicht.",
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

async function create(body: { title: string; template_id: number | null; leaders_only?: boolean }) {
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
					:can-create="can('forms:create')"
					@refresh="refresh()"
					@create="createOpen = true"
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<FormsCreateModal
		v-model:open="createOpen"
		kind="form"
		:restrictable="can('forms:manage')"
		:create="create"
		@created="navigateTo(`${basePath}/${$event}`)"
	/>
</template>
