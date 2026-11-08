<script setup lang="ts">
/** Event audit log for leaders: who changed what, newest first, paginated. */
import type { GetEventsByEventIdAuditLogResponses } from "~/api-client";

type AuditEntry = GetEventsByEventIdAuditLogResponses["200"]["data"]["entries"][number];

definePageMeta({ layout: "dashboard" });

const { event, eventId, can } = await useCurrentEvent();
const toast = useToast();

useSeoMeta({ title: `Audit-Log | ${event.value.name} | CMP` });

if (!can("audit_log:view")) {
	throw createError({
		statusCode: 403,
		statusMessage: "Das Audit-Log ist nur für die Leitung sichtbar.",
		fatal: true,
	});
}

const PAGE_SIZE = 50;

const ENTITY_TYPE_LABELS: Record<string, string> = {
	event: "Event",
	event_member: "Team",
	event_group: "Gruppen",
	room: "Zimmer",
	participant: "Teilnehmende",
	participant_note: "Teilnehmer-Notizen",
	program_item: "Programm",
	responsibility: "Zuständigkeiten",
	task: "Aufgaben",
	note: "Notizen",
	announcement: "Neuigkeiten",
	file: "Dokumente",
	expense: "Ausgaben",
	budget_item: "Budget",
};

const ACTION_ICONS: Record<string, string> = {
	create: "i-lucide-plus",
	update: "i-lucide-pencil",
	delete: "i-lucide-trash-2",
	assign: "i-lucide-user-plus",
	unassign: "i-lucide-user-minus",
	review: "i-lucide-scan-search",
	invite: "i-lucide-mail-plus",
	login: "i-lucide-log-in",
};

const ACTION_CLASSES: Record<string, string> = {
	create: "bg-emerald-500/10 text-emerald-400",
	update: "bg-primary/10 text-primary-400",
	delete: "bg-red-500/10 text-red-400",
	review: "bg-amber-500/10 text-amber-400",
};

const entityType = ref<string | null>(null);
const page = ref(1);

watch(entityType, () => {
	page.value = 1;
});

const {
	data: log,
	loading,
	refresh,
} = await useAPIAsyncData(`event-${eventId.value}-audit-log`, async () => {
	const result = await useAPI((api) =>
		api.getEventsByEventIdAuditLog({
			path: { eventId: eventId.value },
			query: {
				limit: PAGE_SIZE,
				offset: (page.value - 1) * PAGE_SIZE,
				...(entityType.value ? { entity_type: entityType.value } : {}),
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

watch([page, entityType], () => refresh());

const entityOptions = [
	{ label: "Alle Bereiche", value: null },
	...Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({ label, value })),
];
</script>

<template>
	<UDashboardPanel id="event-audit-log">
		<template #header>
			<DashboardPageHeader title="Audit-Log" icon="i-lucide-scroll-text" :description="event.name">
				<template #right>
					<UButton
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="ghost"
						aria-label="Aktualisieren"
						:loading="loading"
						@click="refresh()"
					/>
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<USelect
					v-model="entityType"
					:items="entityOptions"
					value-key="value"
					icon="i-lucide-filter"
					class="w-48"
				/>
				<template #right>
					<span class="text-sm text-slate-400">{{ log?.total ?? 0 }} Einträge</span>
				</template>
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
					description="Hier erscheinen alle Änderungen an diesem Event."
				/>

				<UCard v-else class="border-slate-800 bg-slate-900/60" :ui="{ body: 'p-0 sm:p-0' }">
					<ul class="divide-y divide-slate-800">
						<li v-for="entry in log.entries" :key="entry.id" class="flex items-start gap-3 px-4 py-3">
							<div
								:class="[
									'flex size-8 shrink-0 items-center justify-center rounded-full',
									ACTION_CLASSES[entry.action] ?? 'bg-slate-800 text-slate-400',
								]"
							>
								<UIcon :name="ACTION_ICONS[entry.action] ?? 'i-lucide-activity'" class="size-4" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-sm text-white">{{ entry.summary }}</p>
								<p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
									<span class="flex items-center gap-1">
										<UAvatar :text="initials(entry.user?.display_name)" size="3xs" />
										{{ entry.user?.display_name ?? "System / gelöschtes Konto" }}
									</span>
									<span>·</span>
									<UBadge
										:label="ENTITY_TYPE_LABELS[entry.entity_type] ?? entry.entity_type"
										color="neutral"
										variant="outline"
										size="sm"
									/>
								</p>
							</div>
							<UTooltip :text="formatDate(entry.created_at)">
								<time class="shrink-0 text-xs text-slate-500">{{ formatRelative(entry.created_at) }}</time>
							</UTooltip>
						</li>
					</ul>
				</UCard>

				<div v-if="(log?.total ?? 0) > PAGE_SIZE" class="flex justify-center">
					<UPagination v-model:page="page" :items-per-page="PAGE_SIZE" :total="log?.total ?? 0" show-edges />
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
