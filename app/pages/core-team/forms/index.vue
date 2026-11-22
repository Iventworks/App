<script setup lang="ts">
/**
 * Kernteam: its forms and the templates every form can start from (events too). A form gets a
 * link and a QR code once it is published; anyone with it can answer, without an account.
 */
import type { FormSummary } from "~/utils/forms";

definePageMeta({ layout: "dashboard" });

const toast = useToast();

const { value: type, items: typeItems } = useQueryFilter("type", [
	{ value: "forms", label: "Formulare", icon: "i-lucide-clipboard-list" },
	{ value: "templates", label: "Vorlagen", icon: "i-lucide-layout-template" },
]);
const templates = computed(() => type.value === "templates");

useSeoMeta({ title: () => `${templates.value ? "Formularvorlagen" : "Formulare"} | Kernteam` });

const {
	data: forms,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-forms", async () => {
	const [own, shared] = await Promise.all([
		useAPI((api) => api.getOrgForms({})),
		useAPI((api) => api.getOrgFormTemplates({})),
	]);
	if (!own.success || !shared.success) {
		toast.add({
			title: "Formulare konnten nicht geladen werden",
			description: (own.success ? shared : own).message,
			color: "error",
		});
	}
	return {
		forms: own.success ? own.data : ([] as FormSummary[]),
		templates: shared.success ? shared.data : ([] as FormSummary[]),
	};
});

const createOpen = ref(false);

async function create(body: { title: string; template_id: number | null }) {
	const result = templates.value
		? await useAPI((api) => api.postOrgFormTemplates({ body }))
		: await useAPI((api) => api.postOrgForms({ body }));
	if (!result.success) {
		toast.add({ title: "Anlegen fehlgeschlagen", description: result.message, color: "error" });
		return null;
	}
	return result.data;
}
</script>

<template>
	<UDashboardPanel id="core-team-forms">
		<template #header>
			<DashboardPageHeader
				title="Formulare"
				icon="i-lucide-clipboard-list"
				description="Umfragen, Anmeldungen und Feedback – per Link und QR-Code für alle"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<FormsList
					:key="type"
					:forms="(templates ? forms?.templates : forms?.forms) ?? []"
					:loading="loading"
					base-path="/core-team/forms"
					:templates="templates"
					@refresh="refresh()"
					@create="createOpen = true"
				>
					<template #header-left>
						<USelect v-model="type" :items="typeItems" class="w-full sm:w-44" />
					</template>
				</FormsList>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<FormsCreateModal
		v-model:open="createOpen"
		:kind="templates ? 'template' : 'form'"
		:create="create"
		@created="navigateTo(`/core-team/forms/${$event}`)"
	/>
</template>
