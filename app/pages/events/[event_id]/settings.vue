<script setup lang="ts">
/**
 * Event settings (leaders): master data, dates (for a recurring event: its rule), status, limits
 * and money. The core team can also copy and delete the event.
 */
import * as z from "zod";
import { zPutEventsByEventIdBody } from "~/api-client/zod.gen";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();
const user = await useUserInfoStore().use();

useSeoMeta({ title: `Einstellungen | ${event.value.name}` });

const canEdit = computed(() => can("event:edit"));
const isCoreTeam = computed(() => hasOrgRole(user.value?.role, "core_team"));

// --- form ---------------------------------------------------------------------------------

const moneyField = z
	.string()
	.refine(
		(value) => value.trim() === "" || (inputToCents(value) ?? -1) >= 0,
		"Bitte einen gültigen Betrag eingeben",
	);

// The API takes integers/cents and nullable strings; the form edits text fields.
const schema = zPutEventsByEventIdBody
	.omit({
		location: true,
		start_date: true,
		end_date: true,
		max_participants: true,
		participant_fee_cents: true,
		budget_cents: true,
	})
	.extend({
		name: z.string().trim().min(1, "Bitte einen Namen eingeben").max(120),
		location: z.string().max(200),
		start_date: z.iso.date("Bitte ein gültiges Datum wählen"),
		end_date: z.iso.date("Bitte ein gültiges Datum wählen"),
		max_participants: z.string().regex(/^\d*$/, "Bitte eine ganze Zahl eingeben"),
		participant_fee: moneyField,
		budget: moneyField,
	})
	.refine((data) => data.start_date <= data.end_date, {
		message: "Das Ende darf nicht vor dem Beginn liegen",
		path: ["end_date"],
	});

function stateFromEvent() {
	return {
		name: event.value.name,
		type: event.value.type,
		status: event.value.status,
		description: event.value.description,
		location: event.value.location ?? "",
		start_date: event.value.start_date,
		end_date: event.value.end_date,
		color: event.value.color,
		max_participants:
			event.value.max_participants === null ? "" : String(event.value.max_participants),
		participant_fee: centsToInput(event.value.participant_fee_cents),
		budget: centsToInput(event.value.budget_cents),
		// Only sent for recurring events; a rule to start from when the type is switched to one.
		recurrence: event.value.recurrence ?? defaultRecurrence(event.value.start_date),
	};
}

const form = reactive(stateFromEvent());
const saving = ref(false);

function reset() {
	Object.assign(form, stateFromEvent());
}

async function submit() {
	saving.value = true;
	const result = await useAPI((api) =>
		api.putEventsByEventId({
			path: { eventId: eventId.value },
			body: {
				name: form.name.trim(),
				type: form.type,
				status: form.status,
				description: form.description,
				location: form.location.trim() || null,
				start_date: form.start_date,
				end_date: form.end_date,
				color: form.color,
				max_participants: form.max_participants === "" ? null : Number(form.max_participants),
				participant_fee_cents:
					form.participant_fee.trim() === "" ? null : inputToCents(form.participant_fee),
				budget_cents: inputToCents(form.budget) ?? 0,
				recurrence:
					form.type === "recurring" ? normalizeRecurrence(form.recurrence, form.start_date) : null,
			},
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	await Promise.all([loadEventDetails(eventId.value, true), useMyEventsStore().refresh()]);
	reset();
	toast.add({ title: "Einstellungen gespeichert", color: "success", icon: "i-lucide-check" });
}

const fieldClass =
	"flex max-sm:flex-col justify-between items-start gap-4 py-4 first:pt-0 last:pb-0";
const fieldUi = { root: "w-full sm:w-auto", container: "w-full sm:w-auto" };

// --- copy (core team) --------------------------------------------------------------------

const copyOpen = ref(false);

// --- delete (core team) ------------------------------------------------------------------

const deleteOpen = ref(false);

async function deleteEvent() {
	const id = eventId.value;
	const result = await useAPI((api) => api.deleteEventsByEventId({ path: { eventId: id } }));
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}

	toast.add({ title: `„${event.value.name}“ wurde gelöscht`, color: "success" });
	useLastEventCookie().value = null;
	await useMyEventsStore().refresh();
	// Leave the page first: it renders from the cached event details.
	await navigateTo("/events");
	clearEventDetails(id);
}
</script>

<template>
	<UDashboardPanel id="event-settings">
		<template #header>
			<DashboardPageHeader title="Einstellungen" icon="i-lucide-settings-2" :description="event.name" />
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<UEmpty
					v-if="!canEdit"
					icon="i-lucide-lock"
					title="Kein Zugriff"
					description="Nur die Leitung des Events kann die Einstellungen ändern."
				>
					<template #actions>
						<UButton :to="`/events/${eventId}`" label="Zur Übersicht" color="neutral" variant="subtle" />
					</template>
				</UEmpty>

				<template v-else>
					<UForm :schema="schema" :state="form" class="space-y-6" @submit="submit">
					<DashboardSectionCard
						title="Stammdaten"
						description="Name, Art, Status, Zeitraum und Beschreibung"
						icon="i-lucide-tent"
					>
						<div class="divide-y divide-slate-800">
							<UFormField name="name" label="Name" required :class="fieldClass" :ui="fieldUi">
								<UInput v-model="form.name" class="w-full sm:w-80" />
							</UFormField>

							<UFormField
								name="type"
								label="Art"
								:description="EVENT_TYPE_HINTS[form.type]"
								:class="fieldClass"
								:ui="fieldUi"
							>
								<USelect v-model="form.type" :items="EVENT_TYPE_OPTIONS" class="w-full sm:w-80" />
							</UFormField>

							<UFormField
								name="status"
								label="Status"
								description="Archivierte Events verschwinden aus den Listen."
								:class="fieldClass"
								:ui="fieldUi"
							>
								<USelect v-model="form.status" :items="EVENT_STATUS_OPTIONS" class="w-full sm:w-80" />
							</UFormField>

							<UFormField
								name="start_date"
								:label="form.type === 'recurring' ? 'Erster Termin' : 'Beginn'"
								required
								:class="fieldClass"
								:ui="fieldUi"
							>
								<FormDatePicker v-model="form.start_date" class="w-full sm:w-80" />
							</UFormField>

							<UFormField
								name="end_date"
								:label="form.type === 'recurring' ? 'Serie endet am' : 'Ende'"
								required
								:class="fieldClass"
								:ui="fieldUi"
							>
								<FormDatePicker v-model="form.end_date" :min="form.start_date || undefined" class="w-full sm:w-80" />
							</UFormField>

							<div v-if="form.type === 'recurring'" class="space-y-3 py-4">
								<div>
									<p class="text-sm font-medium text-slate-200">Wiederholung</p>
									<p class="text-sm text-slate-400">
										Aus der Regel entstehen die Termine. Änderst du sie, werden künftige Termine angepasst —
										Termine mit Thema, Notiz, eigener Uhrzeit oder Besetzung und abgesagte Termine bleiben.
									</p>
								</div>
								<EventRecurrenceFields
									v-model="form.recurrence"
									:start-date="form.start_date"
									:end-date="form.end_date"
								/>
								<UButton
									v-if="event.type === 'recurring'"
									:to="`/events/${eventId}/occurrences`"
									label="Zu den Terminen"
									icon="i-lucide-calendar-check"
									color="neutral"
									variant="subtle"
									size="sm"
								/>
							</div>

							<UFormField name="location" label="Ort" :class="fieldClass" :ui="fieldUi">
								<UInput v-model="form.location" placeholder="z. B. Freizeitheim Waldblick" class="w-full sm:w-80" />
							</UFormField>

							<UFormField
								name="color"
								label="Farbe"
								description="Für Kalender und Übersichten."
								:class="fieldClass"
								:ui="fieldUi"
							>
								<div class="flex w-full flex-wrap gap-2 sm:w-80">
									<button
										type="button"
										:class="[
											'flex size-7 items-center justify-center rounded-full border border-slate-700 text-slate-400',
											form.color === null ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : '',
										]"
										aria-label="Keine Farbe"
										@click="form.color = null"
									>
										<UIcon name="i-lucide-ban" class="size-4" />
									</button>
									<button
										v-for="color in COLOR_PRESETS"
										:key="color"
										type="button"
										:class="[
											'size-7 rounded-full',
											form.color === color ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : '',
										]"
										:style="{ backgroundColor: color }"
										:aria-label="`Farbe ${color}`"
										@click="form.color = color"
									/>
								</div>
							</UFormField>

							<UFormField name="description" label="Beschreibung" class="space-y-2 py-4">
								<FormMarkdownEditor v-model="form.description" placeholder="Worum geht es bei diesem Event?" />
							</UFormField>
						</div>
					</DashboardSectionCard>

					<DashboardSectionCard
						title="Teilnahme & Finanzen"
						description="Plätze, Teilnahmebeitrag und Budget"
						icon="i-lucide-wallet"
					>
						<div class="divide-y divide-slate-800">
							<UFormField
								name="max_participants"
								label="Maximale Teilnehmerzahl"
								description="Leer lassen für unbegrenzt. Weitere Anmeldungen landen auf der Warteliste."
								:class="fieldClass"
								:ui="fieldUi"
							>
								<UInput v-model="form.max_participants" inputmode="numeric" placeholder="unbegrenzt" class="w-full sm:w-80" />
							</UFormField>

							<UFormField
								name="participant_fee"
								label="Teilnahmebeitrag"
								description="Pro Person, in Euro."
								:class="fieldClass"
								:ui="fieldUi"
							>
								<UInput
									v-model="form.participant_fee"
									inputmode="decimal"
									placeholder="z. B. 249,00"
									trailing-icon="i-lucide-euro"
									class="w-full sm:w-80"
								/>
							</UFormField>

							<UFormField
								name="budget"
								label="Budget"
								description="Gesamtbudget des Events, in Euro."
								:class="fieldClass"
								:ui="fieldUi"
							>
								<UInput
									v-model="form.budget"
									inputmode="decimal"
									placeholder="0,00"
									trailing-icon="i-lucide-euro"
									class="w-full sm:w-80"
								/>
							</UFormField>
						</div>
					</DashboardSectionCard>

					<div class="flex flex-wrap justify-end gap-2">
						<UButton label="Zurücksetzen" color="neutral" variant="ghost" @click="reset" />
						<UButton type="submit" label="Änderungen speichern" icon="i-lucide-save" :loading="saving" />
					</div>
					</UForm>

					<DashboardSectionCard
						v-if="isCoreTeam"
						title="Event kopieren"
						description="Nur für das Kernteam"
						icon="i-lucide-copy"
					>
						<div class="flex flex-wrap items-center justify-between gap-3">
							<p class="max-w-lg text-sm text-slate-400">
								Legt ein neues Event nach dieser Vorlage an — zum Beispiel dieselbe Freizeit im nächsten
								Jahr. Du wählst, was übernommen wird: Team, Gruppen, Zimmer, Zuständigkeiten, Programm,
								Aufgaben, Dokumente und mehr.
							</p>
							<UButton label="Kopieren …" icon="i-lucide-copy" color="neutral" variant="subtle" @click="copyOpen = true" />
						</div>
					</DashboardSectionCard>

					<DashboardSectionCard
						v-if="isCoreTeam"
						title="Event löschen"
						description="Nur für das Kernteam"
						icon="i-lucide-trash-2"
						tone="danger"
					>
						<div class="flex flex-wrap items-center justify-between gap-3">
							<p class="max-w-lg text-sm text-slate-400">
								Löscht das Event mit allen Teilnehmenden, Programmpunkten, Dokumenten, Ausgaben und
								Chats endgültig. Zum Abschließen lieber den Status „Archiviert“ verwenden.
							</p>
							<UButton label="Event löschen" color="error" icon="i-lucide-trash-2" @click="deleteOpen = true" />
						</div>
					</DashboardSectionCard>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<EventCopyModal
		v-if="isCoreTeam"
		v-model:open="copyOpen"
		:event="event"
		@copied="navigateTo(`/events/${$event.id}`)"
	/>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Event löschen"
		:warning-text="`„${event?.name}“ wird mit allen Daten unwiderruflich gelöscht.`"
		:on-delete="deleteEvent"
	/>
</template>
