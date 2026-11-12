/**
 * useNotifications — the signed-in user's notifications, shared by the slideover (large screens)
 * and the `/notifications` page (small screens); `useDashboard().openNotifications()` picks one.
 * Loads them, reloads on realtime `notification` events while `active`, marks them read, removes
 * them, and keeps the sidebar badge in step.
 */
import type { MaybeRefOrGetter } from "vue";
import type { NotificationItem } from "~/utils/types";

export function useNotifications(active: MaybeRefOrGetter<boolean> = true) {
	const toast = useToast();
	const { refreshBadges } = useDashboard();

	/** null until the first load. */
	const notifications = ref<NotificationItem[] | null>(null);
	const loading = ref(false);
	const markingAll = ref(false);
	const unreadCount = computed(() => (notifications.value ?? []).filter((n) => !n.read_at).length);

	async function load() {
		loading.value = true;
		const result = await useAPI((api) => api.getNotifications({ query: { limit: 100 } }));
		loading.value = false;
		if (!result.success) {
			toast.add({
				title: "Benachrichtigungen konnten nicht geladen werden",
				description: result.message,
				color: "error",
			});
			notifications.value ??= [];
			return;
		}
		notifications.value = result.data.items;
	}

	// New notifications appear right away.
	useRealtimeEvent((event) => {
		if (!toValue(active)) return;
		if (event.type === "notification" || event.type === "resync") void load();
	});

	function markReadLocally(matches: (notification: NotificationItem) => boolean) {
		const now = Date.now();
		notifications.value = (notifications.value ?? []).map((n) =>
			!n.read_at && matches(n) ? { ...n, read_at: now } : n,
		);
	}

	/** Mark it read and go where it points to. */
	async function open(notification: NotificationItem) {
		if (!notification.read_at) {
			const result = await useAPI((api) =>
				api.putNotificationsByNotificationIdRead({ path: { notificationId: notification.id } }),
			);
			if (result.success) {
				markReadLocally((n) => n.id === notification.id);
				void refreshBadges();
			}
		}
		if (notification.link) await navigateTo(notification.link);
	}

	async function markAllRead() {
		markingAll.value = true;
		const result = await useAPI((api) => api.postNotificationsReadAll({}));
		markingAll.value = false;
		if (!result.success) {
			toast.add({ title: "Das hat nicht geklappt", description: result.message, color: "error" });
			return;
		}
		markReadLocally(() => true);
		void refreshBadges();
	}

	async function remove(notification: NotificationItem) {
		const result = await useAPI((api) =>
			api.deleteNotificationsByNotificationId({ path: { notificationId: notification.id } }),
		);
		if (!result.success) {
			toast.add({
				title: "Benachrichtigung konnte nicht entfernt werden",
				description: result.message,
				color: "error",
			});
			return;
		}
		notifications.value = (notifications.value ?? []).filter((n) => n.id !== notification.id);
		void refreshBadges();
	}

	return { notifications, loading, unreadCount, markingAll, load, open, markAllRead, remove };
}
