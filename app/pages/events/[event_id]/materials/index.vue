<script setup lang="ts">
/**
 * "Liste": everything the event has — booked from the inventory, to buy or bought, and what team
 * members bring — with where it is and where it is used. The Leitung adds from the inventory and
 * plans purchases; everyone on the team adds what they bring, notes places and plans material for
 * program items.
 */
import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import type { EventMaterial } from "~/utils/types";

const {
	eventId,
	manage,
	contribute,
	recurring,
	userId,
	items,
	loading,
	refresh,
	period,
	periodDialog,
	linkWarnings,
	openCreate,
	openEdit,
	openLinks,
	openBought,
	openRequest,
	removeEntry,
	fileExpense,
} = useEventMaterials();
const { can } = await useCurrentEvent();

const columns: TableColumn<EventMaterial>[] = [
	{ accessorKey: "name", header: "Material" },
	{ accessorKey: "quantity", header: "Menge" },
	{ accessorKey: "kind", header: "Herkunft" },
	{ accessorKey: "location", header: "Wo" },
	{ id: "links", header: recurring.value ? "Eingeplant" : "Im Programm" },
	{ id: "actions", header: "" },
];

const filters = [
	{ column: "name" as const, type: "text" as const, placeholder: "Material suchen …" },
	{
		column: "kind" as const,
		type: "multi-select" as const,
		placeholder: "Alle Herkünfte",
		options: MATERIAL_KIND_OPTIONS,
	},
];

const overbooked = computed(() => items.value.filter((item) => item.overbooked));
const toBuy = computed(() =>
	items.value.filter((item) => item.kind === "purchase" && !item.bought_at),
);

const addItems = computed<DropdownMenuItem[]>(() => [
	...(manage.value
		? [
				{
					label: "Aus dem Lager",
					icon: MATERIAL_KIND_ICONS.inventory,
					onSelect: () => openCreate("inventory"),
				},
				{
					label: "Zu kaufen",
					icon: MATERIAL_KIND_ICONS.purchase,
					onSelect: () => openCreate("purchase"),
				},
			]
		: []),
	{ label: "Bringe ich mit", icon: MATERIAL_KIND_ICONS.own, onSelect: () => openCreate("own") },
]);

function linkLabel(link: EventMaterial["links"][number]) {
	const when = link.start_at
		? `${formatShortDay(link.start_at)} ${formatTime(link.start_at)}`
		: link.date
			? formatShortDay(link.date)
			: "";
	const title = link.title ?? (link.date ? "Termin" : "");
	return `${link.quantity ? `${link.quantity}× ` : ""}${title}${when ? ` (${when})` : ""}`;
}

function rowActions(entry: EventMaterial): DropdownMenuItem[][] {
	const isBuyer = entry.buyer?.id === userId();
	const groups: DropdownMenuItem[][] = [
		[
			...(entry.can_edit || contribute.value
				? [
						{
							label: entry.can_edit ? "Bearbeiten" : "Ort ändern",
							icon: entry.can_edit ? "i-lucide-pencil" : "i-lucide-map-pin",
							onSelect: () => openEdit(entry),
						},
					]
				: []),
			...(contribute.value
				? [
						{
							label: recurring.value ? "Für Termine einplanen" : "Im Programm einplanen",
							icon: "i-lucide-calendar-plus",
							onSelect: () => openLinks(entry),
						},
					]
				: []),
		],
		[
			...(entry.can_mark_bought
				? [{ label: "Gekauft", icon: "i-lucide-shopping-bag", onSelect: () => openBought(entry) }]
				: []),
			...(manage.value && entry.kind === "purchase" && entry.bought_at
				? [
						{
							label: "Ins Lager übernehmen",
							icon: "i-lucide-warehouse",
							onSelect: () => openBought(entry),
						},
					]
				: []),
			...(entry.kind === "purchase" &&
			!entry.has_expense &&
			(isBuyer || manage.value) &&
			can("expenses:submit")
				? [
						{ label: "Auslage einreichen", icon: "i-lucide-receipt", onSelect: () => fileExpense(entry) },
					]
				: []),
			...(manage.value && entry.resource?.consumable
				? [{ label: "Verbrauch eintragen", icon: "i-lucide-flame", onSelect: () => openEdit(entry) }]
				: []),
		],
		[
			...(entry.can_delete
				? [
						{
							label: "Entfernen",
							icon: "i-lucide-trash-2",
							color: "error" as const,
							onSelect: () => removeEntry(entry),
						},
					]
				: []),
		],
	];
	return groups.filter((group) => group.length);
}
</script>

<template>
	<div class="space-y-4">
		<div
			v-if="period"
			class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm"
		>
			<UIcon name="i-lucide-calendar-range" class="size-4 shrink-0 text-primary-400" />
			<span class="text-slate-300">
				Material aus dem Lager wird gebraucht vom
				<span class="font-medium text-white">{{ formatDay(period.from) }}</span>
				bis
				<span class="font-medium text-white">{{ formatDay(period.until) }}</span>
				<span v-if="period.days_before || period.days_after" class="text-slate-500">
					({{ period.days_before }} Tag(e) vorher, {{ period.days_after }} Tag(e) danach)
				</span>
			</span>
			<UButton
				v-if="manage"
				label="Ändern"
				icon="i-lucide-pencil"
				color="neutral"
				variant="ghost"
				size="xs"
				class="ml-auto"
				@click="periodDialog.open = true"
			/>
		</div>

		<UAlert
			v-if="overbooked.length"
			icon="i-lucide-triangle-alert"
			color="warning"
			variant="subtle"
			title="Im Lager überbucht"
			:description="`${overbooked.map((item) => item.name).join(', ')}: Zusammen mit anderen Events an diesen Tagen ist mehr gebucht, als da ist. Sprich mit dem Kernteam oder buche weniger.`"
		/>

		<DashboardDataTable
			:data="items"
			:columns="columns"
			:loading="loading"
			:filters="filters"
			:default-page-size="50"
			empty-title="Noch kein Material"
			:empty-description="
				manage
					? 'Buche Material aus dem Lager, plane Einkäufe oder trag ein, was jemand mitbringt.'
					: 'Trag ein, was du mitbringst, oder frag nach, was dir fehlt.'
			"
			empty-icon="i-lucide-package"
			@refresh="refresh"
		>
			<template v-if="contribute" #header-right>
				<div class="flex flex-wrap gap-2">
					<UButton
						v-if="!manage"
						label="Etwas anfragen"
						icon="i-lucide-message-circle-question"
						color="neutral"
						variant="subtle"
						@click="openRequest()"
					/>
					<UDropdownMenu v-if="manage" :items="addItems" :ui="{ viewport: 'main-bg-color' }">
						<UButton label="Hinzufügen" icon="i-lucide-plus" trailing-icon="i-lucide-chevron-down" />
					</UDropdownMenu>
					<UButton v-else label="Bringe ich mit" icon="i-lucide-plus" @click="openCreate('own')" />
				</div>
			</template>

			<template #name-cell="{ row }">
				<div class="min-w-44">
					<p class="flex items-center gap-1.5 font-medium text-white">
						{{ row.original.name }}
						<UIcon
							v-if="row.original.overbooked"
							name="i-lucide-triangle-alert"
							class="size-4 text-amber-400"
							aria-label="überbucht"
						/>
					</p>
					<p v-if="row.original.resource && resourceDetails(row.original.resource)" class="text-xs text-slate-400">
						{{ resourceDetails(row.original.resource) }}
					</p>
					<p v-if="row.original.notes" class="line-clamp-2 text-xs text-slate-500">{{ row.original.notes }}</p>
				</div>
			</template>

			<template #quantity-cell="{ row }">
				<span class="tabular-nums text-white">{{ row.original.quantity }}</span>
				<p v-if="row.original.used_quantity !== null" class="text-xs text-slate-500">
					{{ row.original.used_quantity }} verbraucht
				</p>
			</template>

			<template #kind-cell="{ row }">
				<div class="space-y-1">
					<UBadge
						:label="materialOrigin(row.original).label"
						:icon="materialOrigin(row.original).icon"
						:color="materialOrigin(row.original).color"
						variant="subtle"
						size="sm"
					/>
					<p v-if="row.original.kind === 'purchase' && row.original.buyer" class="text-xs text-slate-400">
						kauft: {{ row.original.buyer.display_name }}
					</p>
					<p
						v-if="row.original.kind === 'purchase' && row.original.estimated_cents !== null"
						class="text-xs text-slate-500"
					>
						ca. {{ formatCents(row.original.estimated_cents) }}
					</p>
					<p v-if="row.original.has_expense" class="flex items-center gap-1 text-xs text-slate-500">
						<UIcon name="i-lucide-receipt" class="size-3" /> Auslage eingereicht
					</p>
				</div>
			</template>

			<template #location-cell="{ row }">
				<span :class="row.original.location ? 'text-slate-300' : 'text-slate-600'">
					{{ row.original.location ?? "–" }}
				</span>
			</template>

			<template #links-cell="{ row }">
				<div class="max-w-64 space-y-1">
					<p
						v-for="link in row.original.links"
						:key="link.id"
						class="truncate text-xs text-slate-300"
						:title="linkLabel(link)"
					>
						{{ linkLabel(link) }}
					</p>
					<p
						v-for="warning in linkWarnings(row.original)"
						:key="warning.text"
						class="flex items-start gap-1 text-xs text-amber-400"
						:title="warning.text"
					>
						<UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3 shrink-0" /> {{ warning.short }}
					</p>
					<span v-if="!row.original.links.length" class="text-slate-600">–</span>
				</div>
			</template>

			<template #actions-cell="{ row }">
				<div class="flex justify-end">
					<UDropdownMenu
						v-if="rowActions(row.original).length"
						:items="rowActions(row.original)"
						:ui="{ viewport: 'main-bg-color' }"
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

		<p v-if="toBuy.length" class="text-sm text-slate-400">
			Noch zu kaufen: {{ toBuy.map((item) => materialLabel(item)).join(", ") }}
		</p>
	</div>
</template>
