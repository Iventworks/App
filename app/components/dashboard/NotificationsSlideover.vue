<script setup lang="ts">
/**
 * Notifications over the current page, on large screens (`useDashboard().openNotifications()`).
 * Small screens get the `/notifications` page instead: there the sidebar is an overlay menu that
 * only closes on navigation, so a slideover opened from it would stay hidden behind it.
 */
import type { NotificationItem } from "~/utils/types";

const { isNotificationsSlideoverOpen } = useDashboard();
const { notifications, loading, unreadCount, markingAll, load, open, markAllRead, remove } =
	useNotifications(isNotificationsSlideoverOpen);

watch(isNotificationsSlideoverOpen, (isOpen) => {
	if (isOpen) void load();
});

async function openNotification(notification: NotificationItem) {
	// Close before leaving: a link to the page already open changes no route, so the route watcher
	// in `useDashboard` wouldn't close it.
	if (notification.link) isNotificationsSlideoverOpen.value = false;
	await open(notification);
}
</script>

<template>
	<USlideover v-model:open="isNotificationsSlideoverOpen" title="Benachrichtigungen">
		<template #actions>
			<UButton
				v-if="unreadCount"
				label="Alle gelesen"
				icon="i-lucide-check-check"
				color="neutral"
				variant="ghost"
				size="sm"
				:loading="markingAll"
				@click="markAllRead"
			/>
		</template>

		<template #body>
			<NotificationsList
				:notifications="notifications"
				:loading="loading"
				variant="plain"
				@open="openNotification"
				@remove="remove"
			/>
		</template>
	</USlideover>
</template>
