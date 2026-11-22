<script setup lang="ts">
/**
 * "Neues Formular" / "Neue Vorlage": a title and what to start from — empty or one of the
 * templates (their questions, texts and conditions are copied; the template stays as it is).
 */
import type { FormSummary } from "~/utils/forms";

const props = defineProps<{
	/** `template`: a new template (Kernteam). */
	kind: "form" | "template";
	create: (body: { title: string; template_id: number | null }) => Promise<{ id: number } | null>;
}>();

const emit = defineEmits<{ created: [id: number] }>();
const open = defineModel<boolean>("open", { required: true });
const toast = useToast();

const templates = ref<FormSummary[]>([]);
const loadingTemplates = ref(false);
const title = ref("");
const templateId = ref<number | null>(null);
const saving = ref(false);
/** The title still is the chosen template's (or empty): picking another one replaces it. */
let titleFromTemplate = true;

watch(open, async (value) => {
	if (!value) return;
	title.value = "";
	templateId.value = null;
	titleFromTemplate = true;
	loadingTemplates.value = true;
	const result = await useAPI((api) => api.getOrgFormTemplates({}));
	loadingTemplates.value = false;
	templates.value = result.success ? result.data : [];
});

function choose(id: number | null) {
	templateId.value = id;
	if (titleFromTemplate) {
		title.value = templates.value.find((template) => template.id === id)?.title ?? "";
	}
}

function onTitleInput() {
	titleFromTemplate = title.value.trim() === "";
}

async function submit() {
	if (!title.value.trim()) return;
	saving.value = true;
	const created = await props.create({ title: title.value.trim(), template_id: templateId.value });
	saving.value = false;
	if (!created) return;
	toast.add({
		title: props.kind === "template" ? "Vorlage angelegt" : "Formular angelegt",
		icon: "i-lucide-check",
		color: "success",
	});
	open.value = false;
	emit("created", created.id);
}

const choices = computed(() => [
	{ id: null, title: "Leer", detail: "Ohne Fragen anfangen", icon: "i-lucide-file-plus" },
	...templates.value.map((template) => ({
		id: template.id,
		title: template.title,
		detail: `${template.question_count} ${template.question_count === 1 ? "Frage" : "Fragen"}`,
		icon: "i-lucide-layout-template",
	})),
]);
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="kind === 'template' ? 'Neue Vorlage' : 'Neues Formular'"
		icon="i-lucide-clipboard-plus"
		width="sm:max-w-2xl"
	>
		<form id="form-create" class="space-y-5" @submit.prevent="submit">
			<UFormField label="Beginnen mit">
				<div v-if="loadingTemplates" class="flex justify-center py-6">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
				</div>
				<div v-else class="grid gap-2 sm:grid-cols-2" role="radiogroup">
					<button
						v-for="choice in choices"
						:key="choice.id ?? 'empty'"
						type="button"
						role="radio"
						:aria-checked="templateId === choice.id"
						class="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors"
						:class="
							templateId === choice.id
								? 'border-primary-500 bg-primary-500/10'
								: 'border-slate-800 bg-slate-900/60 hover:border-slate-600'
						"
						@click="choose(choice.id)"
					>
						<UIcon :name="choice.icon" class="mt-0.5 size-5 shrink-0 text-primary-400" />
						<span class="min-w-0">
							<span class="block truncate font-medium text-white">{{ choice.title }}</span>
							<span class="block text-xs text-slate-400">{{ choice.detail }}</span>
						</span>
					</button>
				</div>
			</UFormField>

			<UFormField label="Titel" required>
				<UInput v-model="title" :maxlength="200" autofocus class="w-full" @update:model-value="onTitleInput" />
			</UFormField>
		</form>

		<template #footer>
			<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
			<UButton
				type="submit"
				form="form-create"
				:label="kind === 'template' ? 'Vorlage anlegen' : 'Formular anlegen'"
				icon="i-lucide-plus"
				:loading="saving"
				:disabled="!title.trim()"
			/>
		</template>
	</DashboardModal>
</template>
