<script setup lang="ts">
/**
 * The notification list of the slideover (`plain`) and the `/notifications` page (`card`). The
 * data and actions come from `useNotifications`.
 */
import type { NotificationItem } from "~/utils/types";

withDefaults(
	defineProps<{
		notifications: NotificationItem[] | null;
		loading: boolean;
		variant?: "plain" | "card";
	}>(),
	{ variant: "plain" },
);

const emit = defineEmits<{
	open: [notification: NotificationItem];
	remove: [notification: NotificationItem];
	retry: [];
}>();

const TYPE_ICONS: Record<string, string> = {
	task_assigned: "i-lucide-list-checks",
	program_assigned: "i-lucide-calendar-clock",
	responsibility_assigned: "i-lucide-badge-check",
	event_added: "i-lucide-tent",
	occurrence_assigned: "i-lucide-calendar-check",
	occurrence_cancelled: "i-lucide-calendar-x",
	announcement: "i-lucide-megaphone",
	expense_reviewed: "i-lucide-receipt",
	expense_submitted: "i-lucide-receipt",
	system: "i-lucide-info",
};

const retryActions = [
	{
		label: "Erneut versuchen",
		icon: "i-lucide-refresh-cw",
		color: "neutral" as const,
		variant: "subtle" as const,
		onClick: () => emit("retry"),
	},
];
</script>

<template>
	<div v-if="loading && !notifications" class="flex justify-center py-12">
		<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
	</div>

	<!-- Not loaded and not loading: the load failed. Not "empty", which would be wrong. -->
	<UEmpty
		v-else-if="!notifications"
		icon="i-lucide-cloud-off"
		title="Benachrichtigungen konnten nicht geladen werden"
		description="Prüfe deine Verbindung und versuch es noch einmal."
		:actions="retryActions"
		:variant="variant === 'plain' ? 'naked' : undefined"
	/>

	<UEmpty
		v-else-if="!notifications.length"
		icon="i-lucide-bell-off"
		title="Keine Benachrichtigungen"
		description="Hier erscheinen neue Aufgaben, Zuteilungen und Neuigkeiten."
		:variant="variant === 'plain' ? 'naked' : undefined"
	/>

	<ul
		v-else
		:class="
			variant === 'card'
				? 'divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60'
				: '-mx-3 space-y-1'
		"
	>
		<li
			v-for="notification in notifications"
			:key="notification.id"
			:class="['group flex items-start gap-1 pe-2 hover:bg-elevated/50', variant === 'plain' && 'rounded-md']"
		>
			<!-- Only inline elements in a <button> (spans, styled as blocks where needed). -->
			<button
				type="button"
				:class="[
					'flex min-w-0 flex-1 items-start gap-3 text-left',
					variant === 'card' ? 'px-4 py-3' : 'px-3 py-2.5',
				]"
				@click="emit('open', notification)"
			>
				<UChip as="span" color="primary" :show="!notification.read_at" inset>
					<span class="flex size-9 items-center justify-center rounded-full bg-slate-800">
						<UIcon
							:name="TYPE_ICONS[notification.type] ?? 'i-lucide-bell'"
							class="size-4 text-primary-400"
						/>
					</span>
				</UChip>

				<span class="block min-w-0 flex-1 text-sm">
					<span class="flex items-start justify-between gap-2">
						<span :class="notification.read_at ? 'text-slate-300' : 'font-medium text-white'">
							{{ notification.title }}
						</span>
						<time class="shrink-0 text-xs text-slate-500" :title="formatDate(notification.created_at)">
							{{ formatRelative(notification.created_at) }}
						</time>
					</span>
					<span v-if="notification.body" class="line-clamp-2 text-slate-400">
						{{ notification.body }}
					</span>
				</span>
			</button>

			<!-- Shown on hover with a mouse; always visible on touch screens (no hover there). -->
			<UButton
				icon="i-lucide-x"
				color="neutral"
				variant="ghost"
				size="xs"
				:class="[
					'focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100',
					variant === 'card' ? 'mt-3' : 'mt-2',
				]"
				aria-label="Benachrichtigung entfernen"
				@click="emit('remove', notification)"
			/>
		</li>
	</ul>
</template>
