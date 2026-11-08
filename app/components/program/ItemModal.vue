<script setup lang="ts">
/**
 * Program item details. Staff see a read-only view (time, place, description, responsible people,
 * linked documents); leaders (`editable`) edit it, duplicate it to another slot or delete it.
 * Pass `item` to edit an existing item or `draft` (start/end) to create one.
 */
import * as z from "zod";
import type { GetEventsByEventIdProgramResponses } from "~/api-client";
import { zPostEventsByEventIdProgramBody } from "~/api-client/zod.gen";
import type { EventMember, FileItem } from "~/utils/types";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];

const props = defineProps<{
	eventId: number;
	item: ProgramItem | null;
	draft: { start_at: number; end_at: number } | null;
	editable: boolean;
	members: EventMember[];
}>();

const emit = defineEmits<{
	saved: [];
	deleted: [];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const fileURL = useFileURL();

// The API takes unix ms; the form edits `datetime-local` strings. Linked files are handled
// outside the form fields.
const schema = zPostEventsByEventIdProgramBody
	.omit({ start_at: true, end_at: true, file_ids: true })
	.extend({
		start: z.string().min(1, "Beginn ist erforderlich"),
		end: z.string().min(1, "Ende ist erforderlich"),
	});

const form = reactive({
	title: "",
	description: "",
	location: "",
	category: "",
	color: COLOR_PRESETS[0] as string | null,
	start: "",
	end: "",
	responsible_user_ids: [] as number[],
});
const files = ref<FileItem[]>([]);
const saving = ref(false);
const pickerOpen = ref(false);
const duplicateStart = ref("");
const duplicating = ref(false);
const deleteOpen = ref(false);

watch(open, (isOpen) => {
	if (!isOpen) return;
	const item = props.item;
	const start = item?.start_at ?? props.draft?.start_at ?? Date.now();
	const end = item?.end_at ?? props.draft?.end_at ?? start + 60 * 60_000;
	Object.assign(form, {
		title: item?.title ?? "",
		description: item?.description ?? "",
		location: item?.location ?? "",
		category: item?.category ?? "",
		color: item ? item.color : COLOR_PRESETS[0],
		start: toDateTimeInput(start),
		end: toDateTimeInput(end),
		responsible_user_ids: item?.responsible.map((person) => person.id) ?? [],
	});
	files.value = item ? [...item.files] : [];
	duplicateStart.value = toDateTimeInput(start + 24 * 60 * 60_000);
});

function validate(state: { start?: string; end?: string }) {
	const start = fromDateTimeInput(state.start ?? "");
	const end = fromDateTimeInput(state.end ?? "");
	if (start !== null && end !== null && end <= start) {
		return [{ name: "end", message: "Das Ende muss nach dem Beginn liegen" }];
	}
	return [];
}

const memberOptions = computed(() =>
	props.members.map((member) => ({
		label: member.user.display_name,
		value: member.user.id,
		description: member.position ?? undefined,
	})),
);

const categorySuggestions = [
	"Programm",
	"Andacht",
	"Essen",
	"Workshop",
	"Freizeit",
	"Spiel",
	"Orga",
];

async function submit() {
	const start_at = fromDateTimeInput(form.start);
	const end_at = fromDateTimeInput(form.end);
	if (start_at === null || end_at === null) return;

	saving.value = true;
	const body = {
		title: form.title.trim(),
		description: form.description,
		location: form.location.trim() || null,
		category: form.category.trim() || null,
		color: form.color,
		start_at,
		end_at,
		responsible_user_ids: form.responsible_user_ids,
		file_ids: files.value.map((file) => file.id),
	};

	const item = props.item;
	const result = item
		? await useAPI((api) =>
				api.putEventsByEventIdProgramByProgramItemId({
					path: { eventId: props.eventId, programItemId: item.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdProgram({ path: { eventId: props.eventId }, body }),
			);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	toast.add({
		title: item ? "Programmpunkt gespeichert" : "Programmpunkt angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	open.value = false;
	emit("saved");
}

async function duplicate() {
	const item = props.item;
	const start_at = fromDateTimeInput(duplicateStart.value);
	if (!item || start_at === null) return;

	duplicating.value = true;
	const result = await useAPI((api) =>
		api.postEventsByEventIdProgramByProgramItemIdDuplicate({
			path: { eventId: props.eventId, programItemId: item.id },
			body: { start_at },
		}),
	);
	duplicating.value = false;

	if (!result.success) {
		toast.add({ title: "Duplizieren fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Programmpunkt dupliziert", color: "success", icon: "i-lucide-copy" });
	open.value = false;
	emit("saved");
}

async function confirmDelete() {
	const item = props.item;
	if (!item) return;
	const result = await useAPI((api) =>
		api.deleteEventsByEventIdProgramByProgramItemId({
			path: { eventId: props.eventId, programItemId: item.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Programmpunkt gelöscht", color: "success" });
	open.value = false;
	emit("deleted");
}

function removeFile(file: FileItem) {
	files.value = files.value.filter((entry) => entry.id !== file.id);
}

function fileLink(file: FileItem) {
	if (file.kind === "folder") {
		return file.scope === "org"
			? `/documents?folder=${file.id}`
			: `/events/${props.eventId}/documents?folder=${file.id}`;
	}
	return fileURL(file.download_token);
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="editable ? (item ? 'Programmpunkt bearbeiten' : 'Neuer Programmpunkt') : (item?.title ?? 'Programmpunkt')"
		:icon="editable ? (item ? 'i-lucide-pencil' : 'i-lucide-calendar-plus') : 'i-lucide-calendar-clock'"
		width="sm:max-w-2xl"
	>
		<!-- read-only view for staff -->
		<div v-if="!editable && item" class="space-y-5">
			<div class="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
				<span class="flex items-center gap-2">
					<UIcon name="i-lucide-calendar" class="size-4 text-slate-500" />
					{{ formatLongDay(item.start_at) }}
				</span>
				<span class="flex items-center gap-2 tabular-nums">
					<UIcon name="i-lucide-clock" class="size-4 text-slate-500" />
					{{ formatTimeRange(item.start_at, item.end_at) }}
				</span>
				<span v-if="item.location" class="flex items-center gap-2">
					<UIcon name="i-lucide-map-pin" class="size-4 text-slate-500" />
					{{ item.location }}
				</span>
				<UBadge v-if="item.category" :label="item.category" color="neutral" variant="subtle" />
				<UBadge v-if="item.is_mine" label="Du bist zuständig" color="primary" variant="subtle" />
			</div>

			<ContentMarkdownView v-if="item.description" :content="item.description" />

			<div v-if="item.responsible.length">
				<p class="mb-2 text-sm font-medium text-slate-300">Zuständig</p>
				<div class="flex flex-wrap gap-2">
					<UBadge
						v-for="person in item.responsible"
						:key="person.id"
						color="neutral"
						variant="subtle"
						:avatar="{ text: initials(person.display_name), alt: person.display_name }"
						:label="person.display_name"
					/>
				</div>
			</div>

			<div v-if="item.files.length">
				<p class="mb-2 text-sm font-medium text-slate-300">Dokumente</p>
				<ul class="space-y-1">
					<li v-for="file in item.files" :key="file.id">
						<ULink
							:to="fileLink(file)"
							:target="file.kind === 'file' ? '_blank' : undefined"
							class="flex items-center gap-2 text-sm text-primary-300 hover:underline"
						>
							<UIcon :name="file.kind === 'folder' ? 'i-lucide-folder' : 'i-lucide-file'" class="size-4" />
							{{ file.name }}
						</ULink>
					</li>
				</ul>
			</div>
		</div>

		<!-- edit form for leaders -->
		<UForm v-else :schema="schema" :state="form" :validate="validate" class="space-y-4" @submit="submit">
			<UFormField label="Titel" name="title" required>
				<UInput v-model="form.title" class="w-full" autofocus placeholder="z. B. Geländespiel" />
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Beginn" name="start" required>
					<UInput v-model="form.start" type="datetime-local" class="w-full" />
				</UFormField>
				<UFormField label="Ende" name="end" required>
					<UInput v-model="form.end" type="datetime-local" class="w-full" />
				</UFormField>
				<UFormField label="Ort" name="location">
					<UInput v-model="form.location" icon="i-lucide-map-pin" class="w-full" placeholder="z. B. Saal" />
				</UFormField>
				<UFormField label="Kategorie" name="category">
					<UInputMenu
						v-model="form.category"
						:items="categorySuggestions"
						create-item
						class="w-full"
						placeholder="z. B. Workshop"
						@create="(value: string) => (form.category = value)"
					/>
				</UFormField>
			</div>

			<UFormField label="Farbe" name="color">
				<div class="flex flex-wrap gap-2">
					<button
						v-for="color in COLOR_PRESETS"
						:key="color"
						type="button"
						:aria-label="`Farbe ${color}`"
						:class="[
							'size-7 rounded-full ring-offset-2 ring-offset-slate-900 transition',
							form.color === color ? 'ring-2 ring-white' : 'hover:scale-110',
						]"
						:style="{ backgroundColor: color }"
						@click="form.color = color"
					/>
				</div>
			</UFormField>

			<UFormField label="Zuständige Personen" name="responsible_user_ids">
				<USelectMenu
					v-model="form.responsible_user_ids"
					:items="memberOptions"
					value-key="value"
					multiple
					placeholder="Mitarbeitende auswählen"
					icon="i-lucide-users"
					class="w-full"
				/>
			</UFormField>

			<UFormField label="Beschreibung / Ablauf" name="description">
				<FormMarkdownEditor v-model="form.description" placeholder="Ablauf, Material, Hinweise …" min-height="min-h-32" />
			</UFormField>

			<div>
				<div class="mb-2 flex items-center justify-between">
					<p class="text-sm font-medium text-slate-300">Verknüpfte Dokumente</p>
					<UButton
						label="Dokumente verknüpfen"
						icon="i-lucide-paperclip"
						color="neutral"
						variant="subtle"
						size="sm"
						@click="pickerOpen = true"
					/>
				</div>
				<p v-if="!files.length" class="text-sm text-slate-500">
					Noch nichts verknüpft — z. B. Präsentation, Regeln oder Ablaufplan.
				</p>
				<ul v-else class="space-y-1">
					<li
						v-for="file in files"
						:key="file.id"
						class="flex items-center gap-2 rounded-md bg-slate-800/40 px-2 py-1.5 text-sm"
					>
						<UIcon
							:name="file.kind === 'folder' ? 'i-lucide-folder' : 'i-lucide-file'"
							:class="['size-4', file.kind === 'folder' ? 'text-amber-400' : 'text-slate-400']"
						/>
						<span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
						<UBadge v-if="file.scope === 'org'" label="Organisation" color="neutral" variant="outline" size="sm" />
						<UButton
							:to="fileLink(file)"
							:target="file.kind === 'file' ? '_blank' : undefined"
							icon="i-lucide-external-link"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Öffnen"
						/>
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Verknüpfung entfernen"
							@click="removeFile(file)"
						/>
					</li>
				</ul>
			</div>

			<div
				v-if="item"
				class="flex flex-col gap-2 rounded-lg border border-slate-800 p-3 sm:flex-row sm:items-end"
			>
				<UFormField label="Duplizieren nach" class="flex-1">
					<UInput v-model="duplicateStart" type="datetime-local" class="w-full" />
				</UFormField>
				<UButton
					label="Duplizieren"
					icon="i-lucide-copy"
					color="neutral"
					variant="subtle"
					:loading="duplicating"
					@click="duplicate"
				/>
			</div>

			<div class="flex flex-wrap justify-between gap-2 pt-2">
				<UButton
					v-if="item"
					label="Löschen"
					icon="i-lucide-trash-2"
					color="error"
					variant="ghost"
					@click="deleteOpen = true"
				/>
				<span v-else />
				<div class="flex gap-2">
					<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
					<UButton type="submit" :label="item ? 'Speichern' : 'Anlegen'" :loading="saving" />
				</div>
			</div>
		</UForm>

		<template v-if="!editable" #footer>
			<UButton label="Schließen" color="neutral" variant="subtle" @click="open = false" />
		</template>
	</DashboardModal>

	<ProgramFilePicker v-model:open="pickerOpen" v-model:selected="files" :event-id="eventId" />

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Programmpunkt löschen"
		:warning-text="`„${item?.title}“ wird aus dem Programm entfernt. Verknüpfte Dokumente bleiben erhalten.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
