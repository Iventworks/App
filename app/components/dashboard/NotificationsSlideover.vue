<script setup lang="ts">
import type { NotificationItem } from "~/utils/types";

const { isNotificationsSlideoverOpen, refreshBadges } = useDashboard();
const toast = useToast();

const notifications = ref<NotificationItem[]>([]);
const loading = ref(false);

const TYPE_ICONS: Record<string, string> = {
	task_assigned: "i-lucide-list-checks",
	program_assigned: "i-lucide-calendar-clock",
	responsibility_assigned: "i-lucide-badge-check",
	event_added: "i-lucide-tent",
	announcement: "i-lucide-megaphone",
	expense_reviewed: "i-lucide-receipt",
	expense_submitted: "i-lucide-receipt",
	system: "i-lucide-info",
};

async function load() {
	loading.value = true;
	const result = await useAPI((api) => api.getNotifications({ query: { limit: 50 } }));
	loading.value = false;
	if (result.success) {
		notifications.value = result.data.items;
	} else {
		toast.add({
			title: "Benachrichtigungen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
	}
}

watch(isNotificationsSlideoverOpen, (open) => {
	if (open) void load();
});

async function open(notification: NotificationItem) {
	if (!notification.read_at) {
		await useAPI((api) =>
			api.putNotificationsByNotificationIdRead({ path: { notificationId: notification.id } }),
		);
		void refreshBadges();
	}
	isNotificationsSlideoverOpen.value = false;
	if (notification.link) await navigateTo(notification.link);
}

async function markAllRead() {
	const result = await useAPI((api) => api.postNotificationsReadAll({}));
	if (result.success) {
		const now = Date.now();
		notifications.value = notifications.value.map((n) => ({ ...n, read_at: n.read_at ?? now }));
		void refreshBadges();
	}
}

async function remove(notification: NotificationItem) {
	const result = await useAPI((api) =>
		api.deleteNotificationsByNotificationId({ path: { notificationId: notification.id } }),
	);
	if (result.success) {
		notifications.value = notifications.value.filter((n) => n.id !== notification.id);
		void refreshBadges();
	}
}
</script>

<template>
	<USlideover v-model:open="isNotificationsSlideoverOpen" title="Benachrichtigungen">
		<template #actions>
			<UButton
				v-if="notifications.some((n) => !n.read_at)"
				label="Alle gelesen"
				icon="i-lucide-check-check"
				color="neutral"
				variant="ghost"
				size="sm"
				@click="markAllRead"
			/>
		</template>

		<template #body>
			<div v-if="loading && !notifications.length" class="flex justify-center py-12">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
			</div>

			<UEmpty
				v-else-if="!notifications.length"
				icon="i-lucide-bell-off"
				title="Keine Benachrichtigungen"
				description="Hier erscheinen neue Aufgaben, Zuteilungen und Neuigkeiten."
				variant="naked"
			/>

			<div v-else class="-mx-3 space-y-1">
				<div
					v-for="notification in notifications"
					:key="notification.id"
					class="group flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 hover:bg-elevated/50"
					@click="open(notification)"
				>
					<UChip color="primary" :show="!notification.read_at" inset>
						<div class="flex size-9 items-center justify-center rounded-full bg-slate-800">
							<UIcon
								:name="TYPE_ICONS[notification.type] ?? 'i-lucide-bell'"
								class="size-4 text-primary-400"
							/>
						</div>
					</UChip>

					<div class="min-w-0 flex-1 text-sm">
						<p class="flex items-start justify-between gap-2">
							<span :class="notification.read_at ? 'text-slate-300' : 'font-medium text-white'">
								{{ notification.title }}
							</span>
							<time class="shrink-0 text-xs text-slate-500">
								{{ formatRelative(notification.created_at) }}
							</time>
						</p>
						<p v-if="notification.body" class="line-clamp-2 text-slate-400">
							{{ notification.body }}
						</p>
					</div>

					<UButton
						icon="i-lucide-x"
						color="neutral"
						variant="ghost"
						size="xs"
						class="opacity-0 group-hover:opacity-100"
						aria-label="Benachrichtigung entfernen"
						@click.stop="remove(notification)"
					/>
				</div>
			</div>
		</template>
	</USlideover>
</template>
