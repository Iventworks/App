/**
 * useNotifications — the signed-in user's notifications, for the slideover (large screens) and
 * the `/notifications` page (small screens); `useDashboard().openNotifications()` picks one.
 *
 * One shared state, so both show the same list when both are open (the page on a large screen
 * plus `n`). It lives as long as the dashboard layout, which always mounts the slideover, so a
 * logout clears it. The unread count is the server's (`useDashboard().unreadNotifications`, the
 * sidebar badge), not the loaded list's: that holds only the newest 100.
 */
import { createSharedComposable, useDebounceFn } from "@vueuse/core";
import type { NotificationItem } from "~/utils/types";

const _useNotifications = () => {
	const toast = useToast();
	const route = useRoute();
	const { isNotificationsSlideoverOpen, unreadNotifications, refreshBadges } = useDashboard();

	/** null until a load succeeded; with `loading` false that means the load failed. */
	const notifications = ref<NotificationItem[] | null>(null);
	const loading = ref(false);
	const markingAll = ref(false);

	/** Bumped by every load: only the newest load's answer is used. */
	let generation = 0;

	async function load() {
		const current = ++generation;
		loading.value = true;
		const result = await useAPI((api) => api.getNotifications({ query: { limit: 100 } }));
		if (current !== generation) return;
		loading.value = false;
		if (!result.success) {
			toast.add({
				title: "Benachrichtigungen konnten nicht geladen werden",
				description: result.message,
				color: "error",
			});
			return;
		}
		notifications.value = result.data.items;
		unreadNotifications.value = result.data.unread_count;
	}

	// New notifications appear right away while the list is on screen; a burst loads once.
	const visible = computed(
		() => isNotificationsSlideoverOpen.value || route.path === "/notifications",
	);
	const reloadSoon = useDebounceFn(() => void load(), 400);
	useRealtimeEvent((event) => {
		if (!visible.value) return;
		if (event.type === "notification" || event.type === "resync") void reloadSoon();
	});

	/**
	 * After a change made here (read, removed). A load still running may have read the list
	 * before the change and would undo it: load again, which drops that answer.
	 */
	function changed(unreadDelta: number) {
		unreadNotifications.value = Math.max(0, unreadNotifications.value + unreadDelta);
		if (loading.value) void load();
		void refreshBadges();
	}

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
				changed(-1);
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
		changed(-unreadNotifications.value);
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
		changed(notification.read_at ? 0 : -1);
	}

	return {
		notifications,
		loading,
		unreadCount: unreadNotifications,
		markingAll,
		load,
		open,
		markAllRead,
		remove,
	};
};

export const useNotifications = createSharedComposable(_useNotifications);
