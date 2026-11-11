<script setup lang="ts">
/** Card for one camp/event in lists: dates, status, the caller's role, head counts, leaders. */
import type { EventWithAccess } from "~/utils/types";

const props = defineProps<{
	event: EventWithAccess;
}>();

const today = toDayString();

function daysBetween(from: string, to: string) {
	return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

const timing = computed(() => {
	const { start_date, end_date } = props.event;
	// A recurring event goes by its next date.
	if (props.event.type === "recurring") {
		const next = props.event.next_occurrence;
		if (!next) return null;
		if (next.date === today) return { label: "Heute", color: "success" as const };
		const days = daysBetween(today, next.date);
		return { label: days === 1 ? "Morgen" : `In ${days} Tagen`, color: "info" as const };
	}
	if (start_date <= today && today <= end_date) {
		return {
			label: `Tag ${daysBetween(start_date, today) + 1} von ${daysBetween(start_date, end_date) + 1}`,
			color: "success" as const,
		};
	}
	if (start_date > today) {
		const days = daysBetween(today, start_date);
		return { label: days === 1 ? "Morgen" : `In ${days} Tagen`, color: "info" as const };
	}
	return null;
});

const roleBadge = computed(() =>
	props.event.is_member
		? { label: getEventRoleLabel(props.event.my_role), color: getEventRoleColor(props.event.my_role) }
		: { label: "Kernteam-Zugriff", color: "neutral" as const },
);
</script>

<template>
	<NuxtLink
		:to="`/events/${event.id}`"
		class="group block overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-primary/40 hover:bg-slate-900"
	>
		<div class="h-1" :style="{ backgroundColor: event.color ?? 'var(--ui-primary)' }" />
		<div class="space-y-4 p-5">
			<div class="flex items-start justify-between gap-3">
				<div class="flex min-w-0 items-center gap-3">
					<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-800">
						<UIcon :name="EVENT_TYPE_ICONS[event.type]" class="size-5 text-primary-400" />
					</div>
					<div class="min-w-0">
						<p class="truncate font-semibold text-white group-hover:text-primary-300">{{ event.name }}</p>
						<p class="text-sm text-slate-400">
							{{ EVENT_TYPE_LABELS[event.type] }} · {{ eventDateLabel(event) }}
						</p>
					</div>
				</div>
				<UBadge
					:label="EVENT_STATUS_LABELS[event.status]"
					:color="EVENT_STATUS_COLORS[event.status]"
					variant="subtle"
					size="sm"
					class="shrink-0"
				/>
			</div>

			<div class="flex flex-wrap items-center gap-2 text-xs">
				<UBadge :label="roleBadge.label" :color="roleBadge.color" variant="outline" size="sm" />
				<UBadge v-if="timing" :label="timing.label" :color="timing.color" variant="soft" size="sm" />
				<span v-if="event.location" class="flex items-center gap-1 text-slate-400">
					<UIcon name="i-lucide-map-pin" class="size-3.5" /> {{ event.location }}
				</span>
				<span v-if="event.next_occurrence" class="flex items-center gap-1 text-slate-400">
					<UIcon name="i-lucide-calendar-check" class="size-3.5" />
					Nächster Termin: {{ occurrenceLabel(event.next_occurrence) }}
				</span>
			</div>

			<div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3 text-sm">
				<div class="flex items-center gap-4 text-slate-400">
					<span class="flex items-center gap-1.5" title="Teilnehmende">
						<UIcon name="i-lucide-users" class="size-4" />
						{{ event.participant_count
						}}<template v-if="event.max_participants"> / {{ event.max_participants }}</template>
					</span>
					<span class="flex items-center gap-1.5" title="Team">
						<UIcon name="i-lucide-contact" class="size-4" /> {{ event.staff_count }}
					</span>
				</div>
				<div v-if="event.leaders.length" class="flex min-w-0 items-center gap-2">
					<UAvatarGroup size="2xs" :max="3">
						<UAvatar
							v-for="leader in event.leaders"
							:key="leader.id"
							:text="initials(leader.display_name)"
							:alt="leader.display_name"
						/>
					</UAvatarGroup>
					<span class="truncate text-xs text-slate-500">
						Leitung: {{ event.leaders.map((leader) => leader.display_name).join(", ") }}
					</span>
				</div>
				<span v-else class="text-xs text-amber-400">Noch keine Leitung</span>
			</div>
		</div>
	</NuxtLink>
</template>
