<script setup lang="ts">
/**
 * Create / edit a participant (tabs: Stammdaten, Kontakt & Notfall, Gesundheit & Hinweise).
 * Emits `saved` with the participant returned by the API. Shows a hint when the server put a new
 * participant on the waitlist because the event is full.
 */
import type { FormErrorEvent } from "@nuxt/ui";
import * as z from "zod";
import type { GetEventsByEventIdParticipantsResponses } from "~/api-client";
import { zPostEventsByEventIdParticipantsBody } from "~/api-client/zod.gen";

type Participant = GetEventsByEventIdParticipantsResponses["200"]["data"][number];
type Status = Participant["status"];
type Gender = NonNullable<Participant["gender"]>;
type SwimState = "yes" | "no" | "unknown";

const props = defineProps<{
	eventId: number;
	/** The participant to edit; null creates a new one. */
	participant: Participant | null;
	rooms: { id: number; name: string }[];
}>();

const emit = defineEmits<{
	saved: [participant: { id: number; status: Status }];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();

const TABS = [
	{ label: "Stammdaten", icon: "i-lucide-id-card", slot: "base" as const, value: "base" },
	{ label: "Kontakt & Notfall", icon: "i-lucide-phone", slot: "contact" as const, value: "contact" },
	{
		label: "Gesundheit & Hinweise",
		icon: "i-lucide-heart-pulse",
		slot: "health" as const,
		value: "health",
	},
];

const FIELD_TABS: Record<string, string> = {
	first_name: "base",
	last_name: "base",
	birth_date: "base",
	gender: "base",
	status: "base",
	room_id: "base",
	fee_paid: "base",
	email: "contact",
	phone: "contact",
	address: "contact",
	guardian_name: "contact",
	guardian_phone: "contact",
	emergency_contacts: "contact",
};

const activeTab = ref("base");

// Form state uses "" for empty optional strings; `toBody()` turns them into null.
const schema = zPostEventsByEventIdParticipantsBody
	.omit({ birth_date: true, can_swim: true, email: true })
	.extend({
		birth_date: z.union([z.literal(""), z.iso.date("Bitte ein gültiges Datum angeben")]),
		email: z.union([z.literal(""), z.email("Ungültige E-Mail-Adresse")]),
		can_swim: z.enum(["yes", "no", "unknown"]),
	});

function emptyForm() {
	return {
		first_name: "",
		last_name: "",
		birth_date: "",
		gender: null as Gender | null,
		email: "",
		phone: "",
		address: "",
		guardian_name: "",
		guardian_phone: "",
		allergies: "",
		medications: "",
		dietary_requirements: "",
		medical_notes: "",
		can_swim: "unknown" as SwimState,
		photo_consent: false,
		notes: "",
		room_id: null as number | null,
		status: "registered" as Status,
		fee_paid: false,
		emergency_contacts: [] as { name: string; relation: string; phone: string }[],
	};
}

const form = reactive(emptyForm());
const saving = ref(false);

watch(open, (isOpen) => {
	if (!isOpen) return;
	activeTab.value = "base";
	const p = props.participant;
	Object.assign(
		form,
		p
			? {
					first_name: p.first_name,
					last_name: p.last_name,
					birth_date: p.birth_date ?? "",
					gender: p.gender,
					email: p.email ?? "",
					phone: p.phone ?? "",
					address: p.address ?? "",
					guardian_name: p.guardian_name ?? "",
					guardian_phone: p.guardian_phone ?? "",
					allergies: p.allergies,
					medications: p.medications,
					dietary_requirements: p.dietary_requirements,
					medical_notes: p.medical_notes,
					can_swim: p.can_swim === null ? "unknown" : p.can_swim ? "yes" : "no",
					photo_consent: p.photo_consent,
					notes: p.notes,
					room_id: p.room_id,
					status: p.status,
					fee_paid: p.fee_paid,
					emergency_contacts: p.emergency_contacts.map((contact) => ({
						name: contact.name,
						relation: contact.relation ?? "",
						phone: contact.phone,
					})),
				}
			: emptyForm(),
	);
});

const genderOptions = [{ label: "Keine Angabe", value: null }, ...GENDER_OPTIONS];
const swimOptions = [
	{ label: "Unbekannt", value: "unknown" },
	{ label: "Ja, kann schwimmen", value: "yes" },
	{ label: "Nein", value: "no" },
];
const roomOptions = computed(() => [
	{ label: "Kein Zimmer", value: null },
	...props.rooms.map((room) => ({ label: room.name, value: room.id })),
]);

function addContact() {
	if (form.emergency_contacts.length >= 5) return;
	form.emergency_contacts.push({ name: "", relation: "", phone: "" });
}

function removeContact(index: number) {
	form.emergency_contacts.splice(index, 1);
}

function nullable(value: string) {
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

/** Editing someone whose health data the caller cannot see: those fields are left untouched. */
const healthHidden = computed(() => props.participant?.medical_visible === false);

function toBody() {
	const body = {
		first_name: form.first_name.trim(),
		last_name: form.last_name.trim(),
		birth_date: form.birth_date || null,
		gender: form.gender,
		email: nullable(form.email),
		phone: nullable(form.phone),
		address: nullable(form.address),
		guardian_name: nullable(form.guardian_name),
		guardian_phone: nullable(form.guardian_phone),
		allergies: form.allergies.trim(),
		medications: form.medications.trim(),
		dietary_requirements: form.dietary_requirements.trim(),
		medical_notes: form.medical_notes.trim(),
		can_swim: form.can_swim === "unknown" ? null : form.can_swim === "yes",
		photo_consent: form.photo_consent,
		notes: form.notes.trim(),
		room_id: form.room_id,
		status: form.status,
		fee_paid: form.fee_paid,
		emergency_contacts: form.emergency_contacts
			.filter((contact) => contact.name.trim() || contact.phone.trim())
			.map((contact) => ({
				name: contact.name.trim(),
				relation: nullable(contact.relation),
				phone: contact.phone.trim(),
			})),
	};
	if (!healthHidden.value) return body;
	// The API ignores them for such callers anyway; don't send the blanks at all.
	const { allergies, medications, dietary_requirements, medical_notes, can_swim, ...rest } = body;
	return rest;
}

function onError(event: FormErrorEvent) {
	const first = event.errors[0]?.name?.split(".")[0];
	if (first && FIELD_TABS[first]) activeTab.value = FIELD_TABS[first];
	else if (first) activeTab.value = "health";
}

async function submit() {
	saving.value = true;
	const body = toBody();
	const existing = props.participant;
	const result = existing
		? await useAPI((api) =>
				api.putEventsByEventIdParticipantsByParticipantId({
					path: { eventId: props.eventId, participantId: existing.id },
					body,
				}),
			)
		: await useAPI((api) =>
				api.postEventsByEventIdParticipants({ path: { eventId: props.eventId }, body }),
			);
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}

	const name = `${result.data.first_name} ${result.data.last_name}`;
	if (!existing && body.status !== "waitlist" && result.data.status === "waitlist") {
		toast.add({
			title: `${name} steht auf der Warteliste`,
			description: "Die maximale Teilnehmendenzahl ist erreicht.",
			color: "warning",
			icon: "i-lucide-hourglass",
		});
	} else {
		toast.add({
			title: existing ? `${name} gespeichert` : `${name} angelegt`,
			color: "success",
			icon: "i-lucide-check",
		});
	}

	open.value = false;
	emit("saved", { id: result.data.id, status: result.data.status });
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="participant ? 'Teilnehmende:n bearbeiten' : 'Teilnehmende:n anlegen'"
		:icon="participant ? 'i-lucide-user-pen' : 'i-lucide-user-plus'"
		width="sm:max-w-2xl"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit" @error="onError">
			<UTabs v-model="activeTab" :items="TABS" :unmount-on-hide="false" variant="link" class="w-full">
				<template #base>
					<div class="grid gap-4 pt-4 sm:grid-cols-2">
						<UFormField label="Vorname" name="first_name" required>
							<UInput v-model="form.first_name" class="w-full" autofocus />
						</UFormField>
						<UFormField label="Nachname" name="last_name" required>
							<UInput v-model="form.last_name" class="w-full" />
						</UFormField>
						<UFormField label="Geburtsdatum" name="birth_date">
							<UInput v-model="form.birth_date" type="date" class="w-full" />
						</UFormField>
						<UFormField label="Geschlecht" name="gender">
							<USelectMenu
								v-model="form.gender"
								:items="genderOptions"
								value-key="value"
								:search-input="false"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Status" name="status">
							<USelect v-model="form.status" :items="PARTICIPANT_STATUS_OPTIONS" class="w-full" />
						</UFormField>
						<UFormField label="Zimmer" name="room_id">
							<USelectMenu v-model="form.room_id" :items="roomOptions" value-key="value" class="w-full" />
						</UFormField>
						<UFormField name="fee_paid" class="sm:col-span-2">
							<USwitch v-model="form.fee_paid" label="Teilnahmebeitrag bezahlt" />
						</UFormField>
					</div>
				</template>

				<template #contact>
					<div class="space-y-4 pt-4">
						<div class="grid gap-4 sm:grid-cols-2">
							<UFormField label="E-Mail" name="email">
								<UInput v-model="form.email" type="email" class="w-full" />
							</UFormField>
							<UFormField label="Telefon" name="phone">
								<UInput v-model="form.phone" type="tel" class="w-full" />
							</UFormField>
							<UFormField label="Adresse" name="address" class="sm:col-span-2">
								<UTextarea v-model="form.address" :rows="2" autoresize class="w-full" />
							</UFormField>
							<UFormField label="Erziehungsberechtigte:r" name="guardian_name">
								<UInput v-model="form.guardian_name" class="w-full" />
							</UFormField>
							<UFormField label="Telefon Erziehungsberechtigte:r" name="guardian_phone">
								<UInput v-model="form.guardian_phone" type="tel" class="w-full" />
							</UFormField>
						</div>

						<div class="space-y-3">
							<div class="flex items-center justify-between">
								<p class="text-sm font-medium text-slate-200">Notfallkontakte</p>
								<UButton
									label="Kontakt hinzufügen"
									icon="i-lucide-plus"
									size="xs"
									color="neutral"
									variant="subtle"
									:disabled="form.emergency_contacts.length >= 5"
									@click="addContact"
								/>
							</div>
							<p v-if="!form.emergency_contacts.length" class="text-sm text-slate-500">
								Noch keine Notfallkontakte hinterlegt.
							</p>
							<div
								v-for="(contact, index) in form.emergency_contacts"
								:key="index"
								class="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
							>
								<UFormField :name="`emergency_contacts.${index}.name`" label="Name">
									<UInput v-model="contact.name" class="w-full" />
								</UFormField>
								<UFormField :name="`emergency_contacts.${index}.relation`" label="Beziehung">
									<UInput v-model="contact.relation" placeholder="z. B. Mutter" class="w-full" />
								</UFormField>
								<UFormField :name="`emergency_contacts.${index}.phone`" label="Telefon">
									<UInput v-model="contact.phone" type="tel" class="w-full" />
								</UFormField>
								<div class="flex items-end">
									<UButton
										icon="i-lucide-trash-2"
										color="error"
										variant="ghost"
										aria-label="Kontakt entfernen"
										@click="removeContact(index)"
									/>
								</div>
							</div>
						</div>
					</div>
				</template>

				<template #health>
					<UAlert
						v-if="healthHidden"
						class="mt-4"
						icon="i-lucide-lock"
						color="neutral"
						variant="subtle"
						title="Nur für das Team sichtbar"
						description="Gesundheitsangaben dieser Person sehen nur die Mitarbeitenden der Freizeit. Beim Speichern bleiben sie unverändert."
					/>
					<div v-else class="grid gap-4 pt-4 sm:grid-cols-2">
						<UFormField label="Allergien" name="allergies" class="sm:col-span-2">
							<UTextarea v-model="form.allergies" :rows="2" autoresize class="w-full" />
						</UFormField>
						<UFormField label="Medikamente" name="medications">
							<UTextarea v-model="form.medications" :rows="2" autoresize class="w-full" />
						</UFormField>
						<UFormField label="Ernährung" name="dietary_requirements">
							<UTextarea
								v-model="form.dietary_requirements"
								:rows="2"
								autoresize
								placeholder="z. B. vegetarisch, laktosefrei"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Medizinische Hinweise" name="medical_notes" class="sm:col-span-2">
							<UTextarea v-model="form.medical_notes" :rows="2" autoresize class="w-full" />
						</UFormField>
						<UFormField label="Schwimmen" name="can_swim">
							<USelect v-model="form.can_swim" :items="swimOptions" class="w-full" />
						</UFormField>
						<UFormField label="Fotos" name="photo_consent">
							<USwitch v-model="form.photo_consent" label="Foto-Einwilligung liegt vor" class="mt-1.5" />
						</UFormField>
						<UFormField label="Weitere Hinweise" name="notes" class="sm:col-span-2">
							<UTextarea v-model="form.notes" :rows="3" autoresize class="w-full" />
						</UFormField>
					</div>
				</template>
			</UTabs>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton type="submit" :label="participant ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>
</template>
