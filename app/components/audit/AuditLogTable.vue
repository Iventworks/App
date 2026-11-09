<script setup lang="ts">
/**
 * Server-paginated audit log (admin: `GET /admin/audit-log`, event: `GET /events/{id}/audit-log`).
 *
 * - Fixed filters come in as props (`userId`, `entityType`, `entityId`) — e.g. the history of one
 *   account. The visible filter bar (text, action, object type, person, event, date range) adds to
 *   them; with `syncUrl` it is mirrored into the query string, so filtered views can be linked.
 * - Rows show time (absolute + relative), person, action badge, the affected object (linked where
 *   it can be opened) and the German summary; rows with metadata expand to show it.
 * - Clicking the filter icon next to a person or object narrows the log to it.
 *
 * Slot `actions`: buttons on the right of the table header. Exposes `refresh()`.
 */
import type { TableColumn } from "@nuxt/ui";
import { refDebounced } from "@vueuse/core";
import type { LocationQuery } from "vue-router";
import type { GetAdminAuditLogData } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { AuditAction, AuditEntry } from "~/utils/audit";

type Query = NonNullable<GetAdminAuditLogData["query"]>;

const props = withDefaults(
	defineProps<{
		/** Scope to one event (uses the event route, which leaders may read). */
		eventId?: number;
		userId?: number | null;
		entityType?: string | null;
		entityId?: number | null;
		/** Mirror the filter bar into the URL query (only for one table per page). */
		syncUrl?: boolean;
		showFilters?: boolean;
		/** Event column + event filter (organisation-wide log). */
		showEvent?: boolean;
		hideActor?: boolean;
		defaultPageSize?: number;
		emptyTitle?: string;
		emptyDescription?: string;
	}>(),
	{
		eventId: undefined,
		userId: null,
		entityType: null,
		entityId: null,
		syncUrl: false,
		showFilters: true,
		showEvent: false,
		hideActor: false,
		defaultPageSize: 25,
		emptyTitle: "Keine Einträge",
		emptyDescription: "Für diese Filter gibt es keine Einträge im Audit-Log.",
	},
);

const route = useRoute();
const router = useRouter();
const toast = useToast();
const user = await useUserInfoStore().use();
const isAdmin = computed(() => hasOrgRole(user.value?.role, "admin"));

// --- filter bar ---------------------------------------------------------------------------

// Selects can't hold `null` reliably: "all" / 0 mean "no filter".
const ALL = "all";

const queryString = (key: string) => (props.syncUrl ? route.query[key]?.toString() : undefined);
const queryNumber = (key: string) => Number(queryString(key)) || 0;

const filters = reactive({
	search: queryString("search") ?? "",
	action: queryString("action") ?? ALL,
	entity_type: queryString("entity_type") ?? ALL,
	entity_id: queryNumber("entity_id"),
	user_id: queryNumber("user_id"),
	event_id: queryNumber("event_id"),
	from: queryString("from") ?? "",
	to: queryString("to") ?? "",
});

// The style guide's FormDateRangePicker (as in the DataTable date filter) works on `Date`s; the
// filter (and the URL) keep `YYYY-MM-DD`.
const dateRange = computed({
	get: () => ({
		start: filters.from ? parseDay(filters.from) : null,
		end: filters.to ? parseDay(filters.to) : null,
	}),
	set: (value: { start: Date | null; end: Date | null }) => {
		filters.from = value.start ? toDayString(value.start) : "";
		filters.to = value.end ? toDayString(value.end) : "";
	},
});

const page = ref(Math.max(1, queryNumber("page")));
const pageSize = ref(props.defaultPageSize);

const searchDebounced = refDebounced(toRef(filters, "search"), 300);

const hasFilters = computed(
	() =>
		filters.search !== "" ||
		filters.action !== ALL ||
		filters.entity_type !== ALL ||
		filters.entity_id !== 0 ||
		filters.user_id !== 0 ||
		filters.event_id !== 0 ||
		filters.from !== "" ||
		filters.to !== "",
);

function resetFilters() {
	Object.assign(filters, {
		search: "",
		action: ALL,
		entity_type: ALL,
		entity_id: 0,
		user_id: 0,
		event_id: 0,
		from: "",
		to: "",
	});
}

function filterByActor(actorId: number) {
	filters.user_id = actorId;
}

function filterByObject(entry: AuditEntry) {
	filters.entity_type = entry.entity_type;
	filters.entity_id = entry.entity_id ?? 0;
}

// --- data ---------------------------------------------------------------------------------

function buildQuery(): Query {
	const dayStart = (day: string) => parseDay(day).getTime();
	const query: Query = { limit: pageSize.value, offset: (page.value - 1) * pageSize.value };

	const userId = props.userId ?? (filters.user_id || undefined);
	const entityType =
		props.entityType ?? (filters.entity_type !== ALL ? filters.entity_type : undefined);
	const entityId = props.entityId ?? (filters.entity_id || undefined);

	if (userId) query.user_id = userId;
	if (entityType) query.entity_type = entityType;
	if (entityId) query.entity_id = entityId;
	if (filters.action !== ALL) query.action = filters.action as AuditAction;
	if (searchDebounced.value.trim()) query.search = searchDebounced.value.trim();
	if (filters.from) query.from = dayStart(filters.from);
	// `to` is exclusive: the day after the last selected day.
	if (filters.to) query.to = dayStart(filters.to) + 24 * 60 * 60 * 1000;
	if (props.showEvent && filters.event_id) query.event_id = filters.event_id;
	return query;
}

const {
	data: log,
	loading,
	refresh,
} = await useAPILazyAsyncData(`audit-log-${useId()}`, async () => {
	const query = buildQuery();
	const result =
		props.eventId !== undefined
			? await useAPI((api) =>
					api.getEventsByEventIdAuditLog({
						path: { eventId: props.eventId as number },
						query: { ...query, event_id: undefined } as Omit<Query, "event_id">,
					}),
				)
			: await useAPI((api) => api.getAdminAuditLog({ query }));

	if (!result.success) {
		toast.add({
			title: "Audit-Log konnte nicht geladen werden",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return { total: 0, entries: [], actors: [] };
	}
	return result.data;
});

defineExpose({ refresh });

function reloadFromFirstPage() {
	if (page.value !== 1)
		page.value = 1; // the page watcher reloads
	else void refresh();
}

watch(
	() => [
		searchDebounced.value,
		filters.action,
		filters.entity_type,
		filters.entity_id,
		filters.user_id,
		filters.event_id,
		filters.from,
		filters.to,
		props.userId,
		props.entityType,
		props.entityId,
	],
	reloadFromFirstPage,
);
watch(page, () => refresh());
watch(pageSize, reloadFromFirstPage);

// Mirror the filter bar into the URL (page mode).
if (props.syncUrl) {
	watch(
		() => [
			searchDebounced.value,
			filters.action,
			filters.entity_type,
			filters.entity_id,
			filters.user_id,
			filters.event_id,
			filters.from,
			filters.to,
			page.value,
		],
		() => {
			const query: LocationQuery = {};
			const set = (key: string, value: string | number, empty: string | number) => {
				if (value !== empty) query[key] = String(value);
			};
			set("search", searchDebounced.value.trim(), "");
			set("action", filters.action, ALL);
			set("entity_type", filters.entity_type, ALL);
			set("entity_id", filters.entity_id, 0);
			set("user_id", filters.user_id, 0);
			set("event_id", filters.event_id, 0);
			set("from", filters.from, "");
			set("to", filters.to, "");
			set("page", page.value, 1);
			void router.replace({ query });
		},
	);
}

// --- options ------------------------------------------------------------------------------

const actionOptions = [
	{ label: "Alle Aktionen", value: ALL },
	...Object.entries(AUDIT_ACTIONS).map(([value, meta]) => ({
		label: meta.label,
		value,
		icon: meta.icon,
	})),
];

const ORG_ONLY_ENTITIES = new Set(["user", "invitation", "resource", "resource_booking"]);
const entityOptions = computed(() => [
	{ label: "Alle Bereiche", value: ALL },
	...Object.entries(AUDIT_ENTITIES)
		.filter(([value]) => props.eventId === undefined || !ORG_ONLY_ENTITIES.has(value))
		.map(([value, meta]) => ({ label: meta.label, value, icon: meta.icon }))
		.sort((a, b) => a.label.localeCompare(b.label, "de")),
]);

const actorOptions = computed(() => [
	{ label: "Alle Personen", value: 0 },
	...(log.value?.actors ?? []).map((actor) => ({ label: actor.display_name, value: actor.id })),
]);

const { data: events } = await useAPILazyAsyncData(`audit-log-events-${useId()}`, async () => {
	if (!props.showEvent) return [];
	const result = await useAPI((api) =>
		api.getEvents({ query: { scope: "all", include_archived: "true" } }),
	);
	return result.success ? result.data : [];
});

const eventOptions = computed(() => [
	{ label: "Alle Events", value: 0 },
	...(events.value ?? []).map((event) => ({ label: event.name, value: event.id })),
]);

// --- table --------------------------------------------------------------------------------

const columns = computed<TableColumn<AuditEntry>[]>(() => [
	{ id: "expand", header: "" },
	{ accessorKey: "created_at", header: "Zeit" },
	...(props.hideActor ? [] : [{ id: "actor", header: "Person" }]),
	{ accessorKey: "action", header: "Aktion" },
	{ id: "object", header: "Objekt" },
	{ accessorKey: "summary", header: "Beschreibung" },
	...(props.showEvent ? [{ id: "event", header: "Event" }] : []),
]);

const hasMetadata = (entry: AuditEntry) => Object.keys(entry.metadata ?? {}).length > 0;
const canFilterActor = computed(() => !props.userId);
const canFilterObject = computed(() => !props.entityType && !props.entityId);

const pageSizeOptions = [...new Set([props.defaultPageSize, 25, 50, 100])]
	.sort((a, b) => a - b)
	.map((size) => ({ label: `${size} pro Seite`, value: size }));

const rangeLabel = computed(() => {
	const total = log.value?.total ?? 0;
	if (!total) return "0 Einträge";
	const first = (page.value - 1) * pageSize.value + 1;
	const last = Math.min(total, page.value * pageSize.value);
	return `${first}–${last} von ${total}`;
});
</script>

<template>
	<DashboardDataTable
		:data="log?.entries ?? []"
		:columns="columns"
		:loading="loading && !log"
		:default-page-size="200"
		:empty-title="emptyTitle"
		:empty-description="emptyDescription"
		empty-icon="i-lucide-scroll-text"
		@refresh="refresh()"
	>
		<template v-if="showFilters" #header-left>
			<UInput
				v-model="filters.search"
				icon="i-lucide-search"
				placeholder="Beschreibung durchsuchen …"
				class="w-full sm:w-56"
			/>
			<USelect v-model="filters.action" :items="actionOptions" value-key="value" class="w-full sm:w-40" />
			<USelect
				v-if="!entityType"
				v-model="filters.entity_type"
				:items="entityOptions"
				value-key="value"
				class="w-full sm:w-44"
				@update:model-value="filters.entity_id = 0"
			/>
			<USelectMenu
				v-if="!userId && !hideActor"
				v-model="filters.user_id"
				:items="actorOptions"
				value-key="value"
				:search-input="{ placeholder: 'Person suchen …' }"
				class="w-full sm:w-44"
			/>
			<USelectMenu
				v-if="showEvent"
				v-model="filters.event_id"
				:items="eventOptions"
				value-key="value"
				:search-input="{ placeholder: 'Event suchen …' }"
				class="w-full sm:w-44"
			/>
			<FormDateRangePicker v-model="dateRange" class="w-full sm:w-auto sm:min-w-40" />
			<UBadge
				v-if="filters.entity_id && !entityId"
				color="neutral"
				variant="subtle"
				:label="`${auditEntity(filters.entity_type).label} #${filters.entity_id}`"
				trailing-icon="i-lucide-x"
				class="cursor-pointer"
				@click="filters.entity_id = 0"
			/>
			<UButton
				v-if="hasFilters"
				label="Zurücksetzen"
				icon="i-lucide-filter-x"
				color="neutral"
				variant="ghost"
				@click="resetFilters"
			/>
		</template>

		<template v-if="$slots.actions" #header-right>
			<slot name="actions" />
		</template>

		<template #expand-cell="{ row }">
			<UButton
				v-if="hasMetadata(row.original)"
				icon="i-lucide-chevron-right"
				color="neutral"
				variant="ghost"
				size="xs"
				:aria-label="row.getIsExpanded() ? 'Details ausblenden' : 'Details anzeigen'"
				:class="['transition-transform', { 'rotate-90': row.getIsExpanded() }]"
				@click="row.toggleExpanded()"
			/>
		</template>

		<template #created_at-cell="{ row }">
			<div class="whitespace-nowrap">
				<p class="text-sm text-slate-200">{{ formatDate(row.original.created_at) }}</p>
				<p class="text-xs text-slate-500">{{ formatRelative(row.original.created_at) }}</p>
			</div>
		</template>

		<template #actor-cell="{ row }">
			<div v-if="row.original.user" class="group flex items-center gap-1">
				<NuxtLink
					v-if="isAdmin"
					:to="`/admin/users/${row.original.user.id}`"
					class="font-medium text-primary-400 hover:underline"
				>
					{{ row.original.user.display_name }}
				</NuxtLink>
				<span v-else class="font-medium text-slate-200">{{ row.original.user.display_name }}</span>
				<UButton
					v-if="canFilterActor && filters.user_id !== row.original.user.id"
					icon="i-lucide-filter"
					color="neutral"
					variant="ghost"
					size="xs"
					class="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
					:aria-label="`Nur Einträge von ${row.original.user.display_name}`"
					@click="filterByActor(row.original.user.id)"
				/>
			</div>
			<span v-else class="text-sm text-slate-500">System</span>
		</template>

		<template #action-cell="{ row }">
			<UBadge
				:color="AUDIT_ACTIONS[row.original.action]?.color ?? 'neutral'"
				:icon="AUDIT_ACTIONS[row.original.action]?.icon"
				variant="soft"
			>
				{{ AUDIT_ACTIONS[row.original.action]?.label ?? row.original.action }}
			</UBadge>
		</template>

		<template #object-cell="{ row }">
			<div class="group flex min-w-0 items-center gap-2">
				<UIcon :name="auditEntity(row.original.entity_type).icon" class="size-4 shrink-0 text-slate-400" />
				<NuxtLink
					v-if="auditObjectLink(row.original, { isAdmin })"
					:to="auditObjectLink(row.original, { isAdmin }) ?? undefined"
					class="truncate text-primary-400 hover:underline"
				>
					{{ auditEntity(row.original.entity_type).label }}
				</NuxtLink>
				<span v-else class="truncate text-slate-300">{{ auditEntity(row.original.entity_type).label }}</span>
				<span v-if="row.original.entity_id" class="text-xs text-slate-500">#{{ row.original.entity_id }}</span>
				<UButton
					v-if="canFilterObject && row.original.entity_id"
					icon="i-lucide-filter"
					color="neutral"
					variant="ghost"
					size="xs"
					class="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
					aria-label="Alle Einträge zu diesem Objekt"
					@click="filterByObject(row.original)"
				/>
			</div>
		</template>

		<template #summary-cell="{ row }">
			<p class="min-w-64 whitespace-normal text-sm text-slate-200">{{ row.original.summary }}</p>
		</template>

		<template #event-cell="{ row }">
			<NuxtLink
				v-if="row.original.event"
				:to="`/events/${row.original.event.id}`"
				class="text-sm text-primary-400 hover:underline"
			>
				{{ row.original.event.name }}
			</NuxtLink>
			<span v-else class="text-sm text-slate-500">Organisation</span>
		</template>

		<template #expanded="{ row }">
			<dl class="grid gap-x-6 gap-y-1 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs sm:grid-cols-[max-content_1fr]">
				<template v-for="item in auditMetadataRows(row.original.metadata)" :key="item.key">
					<dt class="font-mono text-slate-500">{{ item.key }}</dt>
					<dd class="break-all font-mono text-slate-300">{{ item.value }}</dd>
				</template>
			</dl>
		</template>

		<template #footer-left>
			<span>{{ rangeLabel }}</span>
			<USelect
				v-model="pageSize"
				:items="pageSizeOptions"
				value-key="value"
				size="sm"
				class="w-32"
			/>
		</template>

		<template #footer-right>
			<UPagination
				v-model:page="page"
				:total="log?.total ?? 0"
				:items-per-page="pageSize"
				:sibling-count="1"
				show-edges
			/>
		</template>
	</DashboardDataTable>
</template>
