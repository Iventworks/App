<script setup lang="ts">
/**
 * "Fragen": the form's title, description and questions, edited as a copy and saved together.
 * Leaving with unsaved changes asks first. Templates are edited the same way.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import type { FormField } from "~/utils/forms";
import { FormFields } from "~~/server/lib/forms/fields";

const detail = useFormDetail();
const { form, isTemplate } = detail;
const toast = useToast();
const askUnsaved = useUnsavedChangesDialog();

function snapshotOf(source: { title: string; description: string; fields: FormField[] }) {
	return JSON.stringify([source.title, source.description, source.fields]);
}

const title = ref(form.value.title);
const description = ref(form.value.description);
const fields = ref<FormField[]>(structuredClone(toRaw(form.value.fields)));
const saved = ref(snapshotOf(form.value));

const dirty = computed(
	() =>
		snapshotOf({ title: title.value, description: description.value, fields: fields.value }) !==
		saved.value,
);
const problems = computed(() => formFieldProblems(fields.value));

watch(dirty, (value) => (detail.dirty.value = value), { immediate: true });
watch(fields, (value) => (detail.draftFields.value = value), { deep: true, immediate: true });
onUnmounted(() => {
	detail.dirty.value = false;
	detail.draftFields.value = null;
});

const MAX_FIELDS = FormFields.MAX_FIELDS;
const list = ref<HTMLElement | null>(null);

async function focusQuestion(id: string) {
	await nextTick();
	const card = list.value?.querySelector(`[data-question="${id}"]`);
	card?.scrollIntoView({ behavior: "smooth", block: "center" });
	card?.querySelector("input")?.focus({ preventScroll: true });
}

function add(type: FormFields.Type) {
	const field = newFormField(type);
	fields.value.push(field);
	void focusQuestion(field.id);
}

const addItems = computed<DropdownMenuItem[][]>(() =>
	FORM_FIELD_GROUPS.map((group) =>
		group.map((type) => ({
			label: FORM_FIELD_TYPES[type].label,
			icon: FORM_FIELD_TYPES[type].icon,
			onSelect: () => add(type),
		})),
	),
);

function move(index: number, delta: -1 | 1) {
	const target = index + delta;
	if (target < 0 || target >= fields.value.length) return;
	const [field] = fields.value.splice(index, 1);
	if (field) fields.value.splice(target, 0, field);
}

function duplicate(index: number) {
	const source = fields.value[index];
	if (!source) return;
	const copy = duplicateFormField(source);
	fields.value.splice(index + 1, 0, copy);
	void focusQuestion(copy.id);
}

/** Removing a question also removes the conditions that named it. */
function remove(index: number) {
	const [removed] = fields.value.splice(index, 1);
	if (!removed) return;
	const dependents = fields.value.filter((field) => field.condition?.field_id === removed.id);
	for (const field of dependents) field.condition = null;
	if (dependents.length) {
		toast.add({
			title:
				dependents.length === 1
					? "Eine Bedingung wurde entfernt"
					: `${dependents.length} Bedingungen wurden entfernt`,
			description: "Sie bezogen sich auf die gelöschte Frage.",
			icon: "i-lucide-git-branch",
			color: "info",
		});
	}
}

const saving = ref(false);

async function save() {
	if (!title.value.trim()) {
		toast.add({ title: "Das Formular braucht einen Titel", color: "warning" });
		return false;
	}
	const first = fields.value.find((field) => problems.value[field.id]);
	if (first) {
		toast.add({ title: "Bitte prüfe die markierten Fragen", color: "warning" });
		void focusQuestion(first.id);
		return false;
	}
	saving.value = true;
	const ok = await detail.save({
		title: title.value.trim(),
		description: description.value,
		fields: fields.value,
	});
	saving.value = false;
	if (!ok) return false;
	saved.value = snapshotOf({
		title: title.value,
		description: description.value,
		fields: fields.value,
	});
	toast.add({ title: "Gespeichert", icon: "i-lucide-check", color: "success" });
	return true;
}

function discard() {
	title.value = form.value.title;
	description.value = form.value.description;
	fields.value = structuredClone(toRaw(form.value.fields));
}

onBeforeRouteLeave(async () => {
	if (!dirty.value) return true;
	const choice = await askUnsaved("Die Fragen haben ungespeicherte Änderungen.");
	if (choice === "save") return await save();
	return choice === "discard";
});
</script>

<template>
	<div class="mx-auto w-full max-w-3xl space-y-6 pb-24">
		<UAlert
			v-if="!isTemplate && form.response_count > 0"
			icon="i-lucide-info"
			color="info"
			variant="subtle"
			:title="`Es gibt schon ${form.response_count === 1 ? 'eine Antwort' : `${form.response_count} Antworten`}`"
			description="Änderungen gelten für neue Antworten. Antworten zu gelöschten Fragen werden in der Auswertung nicht mehr angezeigt."
		/>

		<DashboardSectionCard :title="isTemplate ? 'Vorlage' : 'Formular'" icon="i-lucide-clipboard-list">
			<div class="space-y-4">
				<UFormField label="Titel" required>
					<UInput v-model="title" :maxlength="200" size="lg" class="w-full" />
				</UFormField>
				<UFormField label="Beschreibung" help="Steht über den Fragen, z. B. worum es geht und bis wann.">
					<FormMarkdownEditor v-model="description" placeholder="Worum geht es?" min-height="min-h-24" />
				</UFormField>
			</div>
		</DashboardSectionCard>

		<div ref="list" class="space-y-4">
			<FormsFieldEditor
				v-for="(field, index) in fields"
				:key="field.id"
				v-model="fields[index]!"
				:index="index"
				:count="fields.length"
				:earlier="fields.slice(0, index)"
				:problem="problems[field.id]"
				@move="move(index, $event)"
				@duplicate="duplicate(index)"
				@remove="remove(index)"
			/>
		</div>

		<UEmpty
			v-if="!fields.length"
			icon="i-lucide-list-plus"
			title="Noch keine Fragen"
			description="Füge die erste Frage hinzu – zum Beispiel eine kurze Antwort oder eine Auswahl."
		/>

		<!-- Left: the save bar sticks to the bottom right. -->
		<div class="flex">
			<UDropdownMenu :items="addItems" :content="{ align: 'start' }">
				<UButton
					label="Frage hinzufügen"
					icon="i-lucide-plus"
					color="neutral"
					variant="outline"
					size="lg"
					:disabled="fields.length >= MAX_FIELDS"
				/>
			</UDropdownMenu>
		</div>

		<div v-if="dirty" class="sticky bottom-4 z-10 flex justify-end">
			<div class="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/95 p-2 pl-4 shadow-lg backdrop-blur">
				<span class="mr-2 hidden text-sm text-slate-300 sm:inline">Ungespeicherte Änderungen</span>
				<UButton label="Verwerfen" color="neutral" variant="ghost" @click="discard" />
				<UButton label="Speichern" icon="i-lucide-save" :loading="saving" @click="save" />
			</div>
		</div>
	</div>
</template>
