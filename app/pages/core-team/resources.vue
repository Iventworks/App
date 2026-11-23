<script setup lang="ts">
/**
 * Kernteam inventory: material and equipment of the organisation, what still has to be bought,
 * and which event has booked how many units. Overlapping bookings beyond the available quantity
 * are rejected by the API. Events book through their material list, which only shows what is free.
 */
import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import type { GetOrgResourcesResponses } from "~/api-client";
import {
	zPostOrgResourcesBody,
	zPostOrgResourcesByResourceIdBookingsBody,
} from "~/api-client/zod.gen";
import type { EventWithAccess, UserSummary } from "~/utils/types";

type Resource = GetOrgResourcesResponses["200"]["data"][number];
type Booking = Resource["bookings"][number];
type Purchase = Resource["purchases"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Material & Ressourcen | Kernteam" });

const toast = useToast();
const confirm = useConfirmDialog();

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

const { data: users } = await useAPIAsyncData("core-team-resources-users", async () => {
	const result = await useAPI((api) => api.getUsers({}));
	return result.success ? result.data : ([] as UserSummary[]);
});

/** Purchases are bought by someone from the core team. */
const buyerOptions = computed(() =>
	(users.value ?? [])
		.filter((user) => user.role === "core_team" || user.role === "admin")
		.map((user) => ({ label: user.display_name, value: user.id })),
);

const today = toDayString();

const eventOptions = computed(() =>
	(events.value ?? [])
		.filter((event) => event.end_date >= today && event.status !== "cancelled")
		.sort((a, b) => a.start_date.localeCompare(b.start_date))
		.map((event) => ({
			label: event.name,
			// A series only uses what it books on the days of its dates.
			description:
				event.type === "recurring"
					? `${eventDateLabel(event)} · ${formatDayRange(event.start_date, event.end_date)}`
					: formatDayRange(event.start_date, event.end_date),
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

const categories = computed(() => [
	...new Set((resources.value ?? []).map((resource) => resource.category)),
]);

const filters = computed(() => [
	{ column: "name" as const, type: "text" as const, placeholder: "Material suchen …" },
	{
		column: "category" as const,
		type: "multi-select" as const,
		placeholder: "Alle Kategorien",
		options: categories.value.map((value) => ({ label: value, value })),
	},
	{
		column: "location" as const,
		type: "multi-select" as const,
		placeholder: "Alle Lagerorte",
		icon: "i-lucide-map-pin",
		options: locationOptions(
			(resources.value ?? []).map((resource) => resource.location),
			"Ohne Lagerort",
		),
		filterFn: (row: { original: Resource }, _column: string, selected?: string[]) =>
			matchesLocation(row.original.location, selected),
	},
]);

function upcomingBookings(resource: Resource) {
	return resource.bookings.filter((booking) => booking.event.until >= today);
}

/** Every open purchase with its item, oldest first. */
const purchases = computed(() =>
	(resources.value ?? [])
		.flatMap((resource) => resource.purchases.map((purchase) => ({ purchase, resource })))
		.sort((a, b) => a.purchase.created_at - b.purchase.created_at),
);

// --- resource form ------------------------------------------------------------------------

const resourceSchema = zPostOrgResourcesBody;

const formOpen = ref(false);
const editing = ref<Resource | null>(null);
const saving = ref(false);
const emptyForm = () => ({
	name: "",
	category: "Allgemein",
	quantity: 1,
	location: "",
	brand: "",
	size: "",
	condition: undefined as keyof typeof RESOURCE_CONDITION_LABELS | undefined,
	consumable: false,
	notes: "",
	toBuy: false,
	purchaseQuantity: 1,
	estimate: "",
	buyer_id: undefined as number | undefined,
});
const form = reactive(emptyForm());

function openCreate() {
	editing.value = null;
	Object.assign(form, emptyForm());
	formOpen.value = true;
}

function openEdit(resource: Resource) {
	editing.value = resource;
	Object.assign(form, {
		...emptyForm(),
		name: resource.name,
		category: resource.category,
		quantity: resource.quantity,
		location: resource.location ?? "",
		brand: resource.brand ?? "",
		size: resource.size ?? "",
		condition: resource.condition ?? undefined,
		consumable: resource.consumable,
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
		brand: form.brand.trim() || null,
		size: form.size.trim() || null,
		condition: form.condition ?? null,
		consumable: form.consumable,
		notes: form.notes,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) =>
				api.putOrgResourcesByResourceId({ path: { resourceId: target.id }, body }),
			)
		: await useAPI((api) =>
				api.postOrgResources({
					body: {
						...body,
						purchase: form.toBuy
							? {
									quantity: form.purchaseQuantity,
									estimated_cents: form.estimate.trim() ? inputToCents(form.estimate) : null,
									buyer_id: form.buyer_id ?? null,
									notes: "",
								}
							: null,
					},
				}),
			);
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

// --- purchases ----------------------------------------------------------------------------

const purchaseOpen = ref(false);
const purchaseResource = ref<Resource | null>(null);
const editingPurchase = ref<Purchase | null>(null);
const savingPurchase = ref(false);
const purchaseForm = reactive({
	quantity: 1,
	estimate: "",
	buyer_id: undefined as number | undefined,
	notes: "",
});

function openPurchase(resource: Resource, purchase: Purchase | null = null) {
	purchaseResource.value = resource;
	editingPurchase.value = purchase;
	Object.assign(purchaseForm, {
		quantity: purchase?.quantity ?? 1,
		estimate: centsToInput(purchase?.estimated_cents ?? null),
		buyer_id: purchase?.buyer?.id,
		notes: purchase?.notes ?? "",
	});
	purchaseOpen.value = true;
}

async function submitPurchase() {
	const resource = purchaseResource.value;
	if (!resource) return;
	savingPurchase.value = true;
	const body = {
		quantity: purchaseForm.quantity,
		estimated_cents: purchaseForm.estimate.trim() ? inputToCents(purchaseForm.estimate) : null,
		buyer_id: purchaseForm.buyer_id ?? null,
		notes: purchaseForm.notes,
	};
	const target = editingPurchase.value;
	const result = target
		? await useAPI((api) =>
				api.putOrgResourcesPurchasesByPurchaseId({ path: { purchaseId: target.id }, body }),
			)
		: await useAPI((api) =>
				api.postOrgResourcesByResourceIdPurchases({ path: { resourceId: resource.id }, body }),
			);
	savingPurchase.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Gespeichert", color: "success", icon: "i-lucide-check" });
	purchaseOpen.value = false;
	await refresh();
}

async function markBought(purchase: Purchase, resource: Resource) {
	const result = await useAPI((api) =>
		api.postOrgResourcesPurchasesByPurchaseIdBought({ path: { purchaseId: purchase.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: `${purchase.quantity}× „${resource.name}“ gekauft`,
		description: `Jetzt ${result.data.quantity} im Bestand.`,
		color: "success",
		icon: "i-lucide-check",
	});
	await refresh();
}

async function cancelPurchase(purchase: Purchase, resource: Resource) {
	const choice = await confirm({
		title: "Einkauf streichen?",
		description: `${purchase.quantity}× „${resource.name}“ werden doch nicht gekauft.`,
		icon: "i-lucide-trash-2",
		iconColor: "error",
		confirmLabel: "Streichen",
		confirmColor: "error",
	});
	if (choice !== "confirm") return;
	const result = await useAPI((api) =>
		api.deleteOrgResourcesPurchasesByPurchaseId({ path: { purchaseId: purchase.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Streichen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	await refresh();
}

function purchaseActions(purchase: Purchase, resource: Resource): DropdownMenuItem[][] {
	return [
		[
			{
				label: "Bearbeiten",
				icon: "i-lucide-pencil",
				onSelect: () => openPurchase(resource, purchase),
			},
		],
		[
			{
				label: "Streichen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => cancelPurchase(purchase, resource),
			},
		],
	];
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

/** The booked days, when the event's material days widen its dates. */
function bookedDays(entry: Booking) {
	if (entry.event.from === entry.event.start_date && entry.event.until === entry.event.end_date)
		return null;
	return `Material: ${formatDayRange(entry.event.from, entry.event.until)}`;
}
</script>

<template>
	<UDashboardPanel id="core-team-resources">
		<template #header>
			<DashboardPageHeader
				title="Material & Ressourcen"
				icon="i-lucide-package"
				description="Inventar der Organisation, Einkäufe und Buchungen für Events"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardSectionCard
					v-if="purchases.length"
					title="Zu kaufen"
					description="Wird erst buchbar, wenn es als gekauft markiert ist."
					icon="i-lucide-shopping-cart"
				>
					<ul class="divide-y divide-slate-800">
						<li
							v-for="{ purchase, resource } in purchases"
							:key="purchase.id"
							class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
						>
							<div class="min-w-0 flex-1">
								<p class="font-medium text-white">{{ purchase.quantity }}× {{ resource.name }}</p>
								<p class="text-xs text-slate-400">
									{{ resource.category }}
									<template v-if="purchase.estimated_cents !== null"> · ca. {{ formatCents(purchase.estimated_cents) }}</template>
									<template v-if="purchase.buyer"> · kauft: {{ purchase.buyer.display_name }}</template>
								</p>
								<p v-if="purchase.notes" class="text-xs text-slate-500">{{ purchase.notes }}</p>
							</div>
							<UButton
								label="Gekauft"
								icon="i-lucide-shopping-bag"
								size="sm"
								color="neutral"
								variant="subtle"
								@click="markBought(purchase, resource)"
							/>
							<UDropdownMenu :items="purchaseActions(purchase, resource)" :ui="{ viewport: 'main-bg-color' }">
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</li>
					</ul>
				</DashboardSectionCard>

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
							<p class="flex items-center gap-1.5 font-medium text-white">
								{{ row.original.name }}
								<UBadge
									v-if="row.original.consumable"
									label="Verbrauch"
									icon="i-lucide-flame"
									color="neutral"
									variant="outline"
									size="sm"
								/>
							</p>
							<p v-if="resourceDetails(row.original)" class="text-xs text-slate-400">
								{{ resourceDetails(row.original) }}
							</p>
							<p v-if="row.original.notes" class="line-clamp-1 text-xs text-slate-500">{{ row.original.notes }}</p>
						</div>
					</template>
					<template #category-cell="{ row }">
						<UBadge :label="row.original.category" color="neutral" variant="outline" size="sm" />
					</template>
					<template #quantity-cell="{ row }">
						<span class="tabular-nums text-white">{{ row.original.quantity }}</span>
						<p v-if="row.original.on_order" class="text-xs text-amber-400">+{{ row.original.on_order }} zu kaufen</p>
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
										{ label: 'Nachkaufen', icon: 'i-lucide-shopping-cart', onSelect: () => openPurchase(row.original) },
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
					<UInput v-model="form.category" list="resource-categories" placeholder="z. B. Zelte, Technik" class="w-full" />
					<datalist id="resource-categories">
						<option v-for="category in categories" :key="category" :value="category" />
					</datalist>
				</UFormField>
				<UFormField label="Bestand (Stück)" name="quantity" :description="!editing && form.toBuy ? 'Was schon da ist' : undefined">
					<UInputNumber v-model="form.quantity" :min="0" class="w-full" />
				</UFormField>
				<UFormField label="Marke" name="brand">
					<UInput v-model="form.brand" placeholder="z. B. Tatonka" class="w-full" />
				</UFormField>
				<UFormField label="Größe / Maße" name="size">
					<UInput v-model="form.size" placeholder="z. B. 4 × 6 m" class="w-full" />
				</UFormField>
				<UFormField label="Zustand" name="condition">
					<USelect
						v-model="form.condition"
						:items="RESOURCE_CONDITION_OPTIONS"
						placeholder="Nicht angegeben"
						class="w-full"
					/>
				</UFormField>
				<UFormField label="Lagerort" name="location">
					<UInput v-model="form.location" placeholder="z. B. Keller Gemeindehaus" class="w-full" />
				</UFormField>
			</div>
			<UFormField name="consumable" description="Was ein Event als verbraucht einträgt, geht vom Bestand ab.">
				<USwitch v-model="form.consumable" label="Verbrauchsmaterial" />
			</UFormField>
			<UFormField label="Notizen" name="notes">
				<UTextarea v-model="form.notes" :rows="2" autoresize class="w-full" />
			</UFormField>

			<div v-if="!editing" class="space-y-3 rounded-lg border border-slate-800 p-3">
				<USwitch v-model="form.toBuy" label="Muss noch gekauft werden" />
				<div v-if="form.toBuy" class="grid gap-4 sm:grid-cols-3">
					<UFormField label="Anzahl">
						<UInputNumber v-model="form.purchaseQuantity" :min="1" class="w-full" />
					</UFormField>
					<UFormField label="Geschätzter Preis">
						<UInput v-model="form.estimate" inputmode="decimal" placeholder="0,00" class="w-full">
							<template #trailing><span class="text-xs text-slate-500">€</span></template>
						</UInput>
					</UFormField>
					<UFormField label="Wer kauft es">
						<USelectMenu
							v-model="form.buyer_id"
							:items="buyerOptions"
							value-key="value"
							placeholder="Noch offen"
							class="w-full"
						/>
					</UFormField>
				</div>
				<p v-if="form.toBuy" class="text-xs text-slate-500">Buchbar wird es erst, wenn es als gekauft markiert ist.</p>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardModal
		v-model:open="purchaseOpen"
		:title="editingPurchase ? 'Einkauf bearbeiten' : 'Nachkaufen'"
		:description="purchaseResource?.name"
		icon="i-lucide-shopping-cart"
	>
		<form class="space-y-4" @submit.prevent="submitPurchase">
			<div class="grid gap-4 sm:grid-cols-3">
				<UFormField label="Anzahl" required>
					<UInputNumber v-model="purchaseForm.quantity" :min="1" class="w-full" />
				</UFormField>
				<UFormField label="Geschätzter Preis">
					<UInput v-model="purchaseForm.estimate" inputmode="decimal" placeholder="0,00" class="w-full">
						<template #trailing><span class="text-xs text-slate-500">€</span></template>
					</UInput>
				</UFormField>
				<UFormField label="Wer kauft es">
					<USelectMenu
						v-model="purchaseForm.buyer_id"
						:items="buyerOptions"
						value-key="value"
						placeholder="Noch offen"
						class="w-full"
					/>
				</UFormField>
			</div>
			<UFormField label="Notizen">
				<UTextarea v-model="purchaseForm.notes" :rows="2" autoresize class="w-full" placeholder="z. B. Händler, Link" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="purchaseOpen = false" />
				<UButton type="submit" :label="editingPurchase ? 'Speichern' : 'Vormerken'" :loading="savingPurchase" />
			</div>
		</form>
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
								entry.event.until < today ? 'opacity-60' : '',
							]"
						>
							<div class="min-w-0 flex-1">
								<NuxtLink :to="`/events/${entry.event.id}/materials`" class="font-medium text-white hover:text-primary-400">
									{{ entry.event.name }}
								</NuxtLink>
								<p class="text-xs text-slate-400">
									{{ formatDayRange(entry.event.start_date, entry.event.end_date) }}
									<template v-if="entry.event.type === 'recurring'"> · an den Terminen</template>
								</p>
								<p v-if="bookedDays(entry)" class="text-xs text-slate-400">{{ bookedDays(entry) }}</p>
								<p v-if="entry.used_quantity !== null" class="text-xs text-slate-400">
									{{ entry.used_quantity }} verbraucht
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
		:warning-text="`„${deleteTarget?.name}“ wird gelöscht – mit allen Buchungen (es verschwindet von den Materiallisten der Events) und geplanten Einkäufen.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
