<script setup lang="ts">
import type { GetAdminAuditLogResponses } from "~/api-client";

type AuditEntry = GetAdminAuditLogResponses["200"]["data"]["entries"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Audit-Log | Administration | CMP",
	description: "Wer hat wann was geändert",
});

const toast = useToast();

const PAGE_SIZE = 50;

const ENTITY_TYPE_LABELS: Record<string, string> = {
	event: "Event",
	event_member: "Team",
	event_group: "Gruppe",
	room: "Zimmer",
	participant: "Teilnehmende",
	participant_note: "Teilnehmer-Notiz",
	program_item: "Programmpunkt",
	responsibility: "Zuständigkeit",
	task: "Aufgabe",
	note: "Notiz",
	announcement: "Neuigkeit",
	file: "Dokument",
	expense: "Ausgabe",
	budget_item: "Budgetposten",
	resource: "Ressource",
	resource_booking: "Reservierung",
	user: "Benutzer",
	invitation: "Einladung",
};

const ACTION_LABELS: Record<string, string> = {
	create: "Angelegt",
	update: "Geändert",
	delete: "Gelöscht",
	assign: "Zugeteilt",
	unassign: "Entfernt",
	review: "Geprüft",
	invite: "Eingeladen",
	login: "Anmeldung",
};

const ACTION_ICONS: Record<string, string> = {
	create: "i-lucide-plus",
	update: "i-lucide-pencil",
	delete: "i-lucide-trash-2",
	assign: "i-lucide-user-plus",
	unassign: "i-lucide-user-minus",
	review: "i-lucide-clipboard-check",
	invite: "i-lucide-mail-plus",
	login: "i-lucide-log-in",
};

const ACTION_ICON_CLASSES: Record<string, string> = {
	create: "text-emerald-400",
	update: "text-primary-400",
	delete: "text-red-400",
	assign: "text-amber-400",
	unassign: "text-amber-400",
	review: "text-primary-400",
	invite: "text-emerald-400",
	login: "text-slate-400",
};

// --- filters --------------------------------------------------------------------------------

// Selects can't hold `null` reliably: 0 / "all" mean "no filter".
const ALL = "all";
const filters = reactive({
	event_id: 0,
	user_id: 0,
	entity_type: ALL,
	action: ALL,
});
const page = ref(1);

const { data: events } = await useAPIAsyncData("admin-audit-log-events", async () => {
	const result = await useAPI((api) =>
		api.getEvents({ query: { scope: "all", include_archived: "true" } }),
	);
	return result.success ? result.data : [];
});

const { data: users } = await useAPIAsyncData("admin-audit-log-users", async () => {
	const result = await useAPI((api) => api.getAdminUsers({}));
	return result.success ? result.data : [];
});

const eventOptions = computed(() => [
	{ label: "Alle Events", value: 0 },
	...(events.value ?? []).map((event) => ({ label: event.name, value: event.id })),
]);

const userOptions = computed(() => [
	{ label: "Alle Personen", value: 0 },
	...(users.value ?? []).map((user) => ({ label: user.display_name, value: user.id })),
]);

const entityTypeOptions = [
	{ label: "Alle Bereiche", value: ALL },
	...Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({ label, value })),
];

const actionOptions = [
	{ label: "Alle Aktionen", value: ALL },
	...Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value })),
];

const hasFilters = computed(
	() =>
		filters.event_id !== 0 ||
		filters.user_id !== 0 ||
		filters.entity_type !== ALL ||
		filters.action !== ALL,
);

function resetFilters() {
	Object.assign(filters, { event_id: 0, user_id: 0, entity_type: ALL, action: ALL });
}

// --- data -----------------------------------------------------------------------------------

const {
	data: log,
	loading,
	refresh,
} = await useAPIAsyncData("admin-audit-log", async () => {
	const result = await useAPI((api) =>
		api.getAdminAuditLog({
			query: {
				event_id: filters.event_id || undefined,
				user_id: filters.user_id || undefined,
				entity_type: filters.entity_type === ALL ? undefined : filters.entity_type,
				action: filters.action === ALL ? undefined : filters.action,
				limit: PAGE_SIZE,
				offset: (page.value - 1) * PAGE_SIZE,
			},
		}),
	);
	if (!result.success) {
		toast.add({
			title: "Audit-Log konnte nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return { total: 0, entries: [] as AuditEntry[] };
	}
	return result.data;
});

// A filter change jumps back to page 1 (which reloads); otherwise reload directly.
watch(
	() => ({ ...filters }),
	() => {
		if (page.value !== 1) page.value = 1;
		else void refresh();
	},
);
watch(page, () => refresh());

// Group entries by calendar day for readability.
const groupedEntries = computed(() => {
	const groups: { day: string; entries: AuditEntry[] }[] = [];
	for (const entry of log.value?.entries ?? []) {
		const day = toDayString(entry.created_at);
		const last = groups.at(-1);
		if (last && last.day === day) last.entries.push(entry);
		else groups.push({ day, entries: [entry] });
	}
	return groups;
});
</script>

<template>
	<UDashboardPanel id="admin-audit-log">
		<template #header>
			<DashboardPageHeader
				title="Audit-Log"
				icon="i-lucide-scroll-text"
				description="Alle Änderungen in der Organisation"
			>
				<template #right>
					<UButton
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="subtle"
						aria-label="Aktualisieren"
						:loading="loading"
						@click="refresh()"
					/>
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<div class="flex w-full flex-wrap items-center gap-2 py-1">
					<USelectMenu
						v-model="filters.event_id"
						:items="eventOptions"
						value-key="value"
						icon="i-lucide-tent"
						class="w-full sm:w-52"
					/>
					<USelectMenu
						v-model="filters.user_id"
						:items="userOptions"
						value-key="value"
						icon="i-lucide-user"
						class="w-full sm:w-48"
					/>
					<USelect
						v-model="filters.entity_type"
						:items="entityTypeOptions"
						icon="i-lucide-shapes"
						class="w-full sm:w-44"
					/>
					<USelect
						v-model="filters.action"
						:items="actionOptions"
						icon="i-lucide-activity"
						class="w-full sm:w-40"
					/>
					<UButton
						v-if="hasFilters"
						label="Filter zurücksetzen"
						icon="i-lucide-x"
						color="neutral"
						variant="ghost"
						size="sm"
						@click="resetFilters"
					/>
				</div>
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !log" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!log?.entries.length"
					icon="i-lucide-scroll-text"
					title="Keine Einträge"
					:description="hasFilters ? 'Nichts passt zu den Filtern.' : 'Bisher wurde nichts protokolliert.'"
				/>

				<template v-else>
					<div v-for="group in groupedEntries" :key="group.day" class="space-y-2">
						<p class="text-xs font-medium uppercase tracking-wide text-slate-500">
							{{ formatLongDay(group.day) }}
						</p>
						<UCard class="border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
							<ul class="divide-y divide-slate-800">
								<li
									v-for="entry in group.entries"
									:key="entry.id"
									class="flex items-start gap-3 px-4 py-3"
								>
									<div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-800">
										<UIcon
											:name="ACTION_ICONS[entry.action] ?? 'i-lucide-dot'"
											:class="['size-4', ACTION_ICON_CLASSES[entry.action] ?? 'text-slate-400']"
										/>
									</div>
									<div class="min-w-0 flex-1">
										<p class="text-sm text-white">{{ entry.summary }}</p>
										<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
											<span>{{ formatTime(entry.created_at) }}</span>
											<span>·</span>
											<span>{{ entry.user?.display_name ?? "Unbekannt / gelöscht" }}</span>
											<template v-if="entry.event">
												<span>·</span>
												<NuxtLink
													:to="`/events/${entry.event.id}`"
													class="text-primary-400 hover:underline"
												>
													{{ entry.event.name }}
												</NuxtLink>
											</template>
										</p>
									</div>
									<UBadge
										:label="ENTITY_TYPE_LABELS[entry.entity_type] ?? entry.entity_type"
										color="neutral"
										variant="outline"
										size="sm"
										class="hidden shrink-0 sm:inline-flex"
									/>
								</li>
							</ul>
						</UCard>
					</div>

					<div class="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
						<p class="text-sm text-slate-500">{{ log.total }} Einträge</p>
						<UPagination
							v-if="log.total > PAGE_SIZE"
							v-model:page="page"
							:items-per-page="PAGE_SIZE"
							:total="log.total"
							:sibling-count="1"
							show-edges
						/>
					</div>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
