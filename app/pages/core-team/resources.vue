<script setup lang="ts">
/**
 * Kernteam inventory: material and equipment of the organisation and which event has booked
 * how many units. Overlapping bookings beyond the available quantity are rejected by the API.
 */
import type { TableColumn } from "@nuxt/ui";
import type { GetOrgResourcesResponses } from "~/api-client";
import {
	zPostOrgResourcesBody,
	zPostOrgResourcesByResourceIdBookingsBody,
} from "~/api-client/zod.gen";
import type { EventWithAccess } from "~/utils/types";

type Resource = GetOrgResourcesResponses["200"]["data"][number];
type Booking = Resource["bookings"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Material & Ressourcen | Kernteam | CMP" });

const toast = useToast();

const {
	data: resources,
	loading,
	refresh,
} = await useAPIAsyncData("core-team-resources", async () => {
	const result = await useAPI((api) => api.getOrgResources({}));
	if (!result.success) {
		toast.add({
			title: "Ressourcen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Resource[];
	}
	return result.data;
});

const { data: events } = await useAPIAsyncData("core-team-resources-events", async () => {
	const result = await useAPI((api) =>
		api.getEvents({ query: { scope: "all", include_archived: "false" } }),
	);
	return result.success ? result.data : ([] as EventWithAccess[]);
});

const today = toDayString();

const eventOptions = computed(() =>
	(events.value ?? [])
		.filter((event) => event.end_date >= today && event.status !== "cancelled")
		.sort((a, b) => a.start_date.localeCompare(b.start_date))
		.map((event) => ({
			label: event.name,
			description: formatDayRange(event.start_date, event.end_date),
			value: event.id,
		})),
);

const columns: TableColumn<Resource>[] = [
	{ accessorKey: "name", header: "Material" },
	{ accessorKey: "category", header: "Kategorie" },
	{ accessorKey: "quantity", header: "Bestand" },
	{ accessorKey: "booked_now", header: "Gerade im Einsatz" },
	{ id: "upcoming", header: "Buchungen" },
	{ accessorKey: "location", header: "Lagerort" },
	{ id: "actions", header: "" },
];

const filters = computed(() => [
	{ column: "name" as const, type: "text" as const, placeholder: "Material suchen …" },
	{
		column: "category" as const,
		type: "select" as const,
		placeholder: "Alle Kategorien",
		options: [...new Set((resources.value ?? []).map((resource) => resource.category))].map(
			(value) => ({ label: value, value }),
		),
	},
]);

function upcomingBookings(resource: Resource) {
	return resource.bookings.filter((booking) => booking.event.end_date >= today);
}

// --- resource form ------------------------------------------------------------------------

const resourceSchema = zPostOrgResourcesBody;

const formOpen = ref(false);
const editing = ref<Resource | null>(null);
const saving = ref(false);
const form = reactive({
	name: "",
	category: "Allgemein",
	quantity: 1,
	location: "",
	notes: "",
});

function openCreate() {
	editing.value = null;
	Object.assign(form, { name: "", category: "Allgemein", quantity: 1, location: "", notes: "" });
	formOpen.value = true;
}

function openEdit(resource: Resource) {
	editing.value = resource;
	Object.assign(form, {
		name: resource.name,
		category: resource.category,
		quantity: resource.quantity,
		location: resource.location ?? "",
		notes: resource.notes,
	});
	formOpen.value = true;
}

async function submit() {
	saving.value = true;
	const body = {
		name: form.name,
		category: form.category || "Allgemein",
		quantity: form.quantity,
		location: form.location.trim() || null,
		notes: form.notes,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putOrgResourcesByResourceId({ path: { resourceId: target.id }, body }),
			)
		: await useAPI((api) => api.postOrgResources({ body }));
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Gespeichert", color: "success", icon: "i-lucide-check" });
	formOpen.value = false;
	await refresh();
}

const deleteTarget = ref<Resource | null>(null);
const deleteOpen = ref(false);

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteOrgResourcesByResourceId({ path: { resourceId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `„${target.name}“ gelöscht`, color: "success" });
	await refresh();
}

// --- bookings -------------------------------------------------------------------------------

const bookingsOpen = ref(false);
const bookingsResourceId = ref<number | null>(null);
const bookingsResource = computed(
	() => (resources.value ?? []).find((resource) => resource.id === bookingsResourceId.value) ?? null,
);

function openBookings(resource: Resource) {
	bookingsResourceId.value = resource.id;
	Object.assign(bookingForm, { event_id: undefined, quantity: 1, notes: "" });
	bookingsOpen.value = true;
}

const bookingSchema = zPostOrgResourcesByResourceIdBookingsBody;
const booking = ref(false);
const bookingForm = reactive({
	event_id: undefined as number | undefined,
	quantity: 1,
	notes: "",
});

async function submitBooking() {
	const resource = bookingsResource.value;
	const eventId = bookingForm.event_id;
	if (!resource || !eventId) return;
	booking.value = true;
	const result = await useAPI((api) =>
		api.postOrgResourcesByResourceIdBookings({
			path: { resourceId: resource.id },
			body: { event_id: eventId, quantity: bookingForm.quantity, notes: bookingForm.notes },
		}),
	);
	booking.value = false;
	if (!result.success) {
		toast.add({
			title: (result.code as number) === 409 ? "Nicht genug verfügbar" : "Buchung fehlgeschlagen",
			description:
				(result.code as number) === 409
					? "In diesem Zeitraum sind bereits zu viele Einheiten für andere Events gebucht."
					: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Gebucht", color: "success", icon: "i-lucide-check" });
	Object.assign(bookingForm, { event_id: undefined, quantity: 1, notes: "" });
	await refresh();
}

async function removeBooking(entry: Booking) {
	const result = await useAPI((api) =>
		api.deleteOrgResourcesBookingsByBookingId({ path: { bookingId: entry.id } }),
	);
	if (!result.success) {
		toast.add({
			title: "Buchung konnte nicht entfernt werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Buchung entfernt", color: "success" });
	await refresh();
}
</script>

<template>
	<UDashboardPanel id="core-team-resources">
		<template #header>
			<DashboardPageHeader
				title="Material & Ressourcen"
				icon="i-lucide-package"
				description="Inventar der Organisation und Buchungen für Events"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					:data="resources ?? []"
					:columns="columns"
					:loading="loading"
					:filters="filters"
					empty-title="Noch kein Material erfasst"
					empty-description="Erfasse Zelte, Technik, Spielmaterial & Co., um sie für Events zu buchen."
					empty-icon="i-lucide-package"
					@refresh="refresh"
				>
					<template #header-right>
						<UButton label="Material anlegen" icon="i-lucide-plus" @click="openCreate" />
					</template>

					<template #name-cell="{ row }">
						<div class="min-w-40">
							<p class="font-medium text-white">{{ row.original.name }}</p>
							<p v-if="row.original.notes" class="line-clamp-1 text-xs text-slate-500">{{ row.original.notes }}</p>
						</div>
					</template>
					<template #category-cell="{ row }">
						<UBadge :label="row.original.category" color="neutral" variant="outline" size="sm" />
					</template>
					<template #quantity-cell="{ row }">
						<span class="tabular-nums text-white">{{ row.original.quantity }}</span>
					</template>
					<template #booked_now-cell="{ row }">
						<span
							:class="[
								'tabular-nums',
								row.original.booked_now >= row.original.quantity && row.original.quantity > 0
									? 'text-amber-400'
									: 'text-slate-300',
							]"
						>
							{{ row.original.booked_now }} / {{ row.original.quantity }}
						</span>
					</template>
					<template #upcoming-cell="{ row }">
						<UButton
							:label="
								upcomingBookings(row.original).length
									? `${upcomingBookings(row.original).length} geplant`
									: 'Buchen'
							"
							:icon="upcomingBookings(row.original).length ? 'i-lucide-calendar-check' : 'i-lucide-calendar-plus'"
							color="neutral"
							variant="subtle"
							size="xs"
							@click="openBookings(row.original)"
						/>
					</template>
					<template #location-cell="{ row }">
						<span class="text-slate-400">{{ row.original.location ?? "–" }}</span>
					</template>
					<template #actions-cell="{ row }">
						<div class="flex justify-end">
							<UDropdownMenu
								:ui="{ viewport: 'main-bg-color' }"
								:items="[
									[
										{ label: 'Buchungen', icon: 'i-lucide-calendar-check', onSelect: () => openBookings(row.original) },
										{ label: 'Bearbeiten', icon: 'i-lucide-pencil', onSelect: () => openEdit(row.original) },
									],
									[
										{
											label: 'Löschen',
											icon: 'i-lucide-trash-2',
											color: 'error' as const,
											onSelect: () => {
												deleteTarget = row.original;
												deleteOpen = true;
											},
										},
									],
								]"
							>
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									size="xs"
									aria-label="Aktionen"
								/>
							</UDropdownMenu>
						</div>
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Material bearbeiten' : 'Material anlegen'"
		icon="i-lucide-package"
	>
		<UForm :schema="resourceSchema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Bezeichnung" name="name" required>
				<UInput v-model="form.name" placeholder="z. B. Gruppenzelt 8 Personen" class="w-full" autofocus />
			</UFormField>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Kategorie" name="category">
					<UInput v-model="form.category" placeholder="z. B. Zelte, Technik" class="w-full" />
				</UFormField>
				<UFormField label="Bestand (Stück)" name="quantity">
					<UInputNumber v-model="form.quantity" :min="0" class="w-full" />
				</UFormField>
			</div>
			<UFormField label="Lagerort" name="location">
				<UInput v-model="form.location" placeholder="z. B. Keller Gemeindehaus" class="w-full" />
			</UFormField>
			<UFormField label="Notizen" name="notes">
				<UTextarea v-model="form.notes" :rows="2" autoresize class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<USlideover
		v-model:open="bookingsOpen"
		:title="bookingsResource ? `Buchungen: ${bookingsResource.name}` : 'Buchungen'"
		:description="bookingsResource ? `Bestand: ${bookingsResource.quantity} Stück` : undefined"
	>
		<template #body>
			<div v-if="bookingsResource" class="space-y-6">
				<UForm :schema="bookingSchema" :state="bookingForm" class="space-y-3" @submit="submitBooking">
					<p class="text-sm font-medium text-white">Für ein Event buchen</p>
					<UFormField label="Event" name="event_id" required>
						<USelectMenu
							v-model="bookingForm.event_id"
							:items="eventOptions"
							value-key="value"
							placeholder="Event wählen"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Anzahl" name="quantity">
						<UInputNumber v-model="bookingForm.quantity" :min="1" :max="bookingsResource.quantity || undefined" class="w-full" />
					</UFormField>
					<UFormField label="Notiz" name="notes">
						<UInput v-model="bookingForm.notes" placeholder="optional" class="w-full" />
					</UFormField>
					<UButton
						type="submit"
						label="Buchen"
						icon="i-lucide-calendar-plus"
						:loading="booking"
						:disabled="!bookingForm.event_id"
						block
					/>
				</UForm>

				<USeparator />

				<div class="space-y-2">
					<p class="text-sm font-medium text-white">Gebucht</p>
					<p v-if="!bookingsResource.bookings.length" class="text-sm text-slate-500">Noch keine Buchungen.</p>
					<ul v-else class="space-y-2">
						<li
							v-for="entry in bookingsResource.bookings"
							:key="entry.id"
							:class="[
								'flex items-start gap-3 rounded-lg border border-slate-800 p-3',
								entry.event.end_date < today ? 'opacity-60' : '',
							]"
						>
							<div class="min-w-0 flex-1">
								<NuxtLink :to="`/events/${entry.event.id}`" class="font-medium text-white hover:text-primary-400">
									{{ entry.event.name }}
								</NuxtLink>
								<p class="text-xs text-slate-400">
									{{ formatDayRange(entry.event.start_date, entry.event.end_date) }}
								</p>
								<p v-if="entry.notes" class="mt-1 text-xs text-slate-500">{{ entry.notes }}</p>
							</div>
							<UBadge :label="`${entry.quantity} Stk.`" color="neutral" variant="subtle" size="sm" />
							<UButton
								icon="i-lucide-x"
								color="neutral"
								variant="ghost"
								size="xs"
								aria-label="Buchung entfernen"
								@click="removeBooking(entry)"
							/>
						</li>
					</ul>
				</div>
			</div>
		</template>
	</USlideover>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Material löschen"
		:warning-text="`„${deleteTarget?.name}“ und alle Buchungen dafür werden gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
