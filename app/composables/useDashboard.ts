/**
 * useDashboard — shared dashboard chrome state: notifications (slideover or page, see
 * `openNotifications`), keyboard shortcuts and the unread badges in the sidebar. The badges
 * refresh when the realtime channel says something changed, and are polled while the dashboard
 * layout is mounted — every minute without the channel, every five minutes as a safety net with it.
 */
import { createSharedComposable, useDebounceFn, useIntervalFn, useMediaQuery } from "@vueuse/core";

const BADGE_POLL_MS = 60_000;
const BADGE_POLL_REALTIME_MS = 5 * 60_000;

const _useDashboard = () => {
	const route = useRoute();
	const router = useRouter();

	const unreadMessages = ref(0);
	const unreadNotifications = ref(0);

	// --- notifications ------------------------------------------------------------------------

	const isNotificationsSlideoverOpen = ref(false);
	/**
	 * Tailwind's `lg`, where `UDashboardSidebar` stops being an overlay menu. Below it,
	 * notifications are the `/notifications` page: the menu only closes on navigation, so a
	 * slideover opened from it would stay hidden behind it.
	 */
	const notificationsAsSlideover = useMediaQuery("(min-width: 64rem)");

	/** The slideover on large screens, the page on small ones. */
	function openNotifications() {
		if (notificationsAsSlideover.value) isNotificationsSlideoverOpen.value = true;
		else void router.push("/notifications");
	}

	watch(
		() => route.fullPath,
		() => {
			isNotificationsSlideoverOpen.value = false;
		},
	);

	// --- badges -------------------------------------------------------------------------------

	async function refreshBadges() {
		if (!useAppCookies().sessionToken.get().value) return;

		const [messages, notifications] = await Promise.all([
			useAPI((api) => api.getConversationsUnread({}), true),
			useAPI((api) => api.getNotifications({ query: { unread_only: "true", limit: 1 } }), true),
		]);

		if (messages.success) unreadMessages.value = messages.data.total;
		if (notifications.success) unreadNotifications.value = notifications.data.unread_count;
	}

	const realtime = useRealtime();
	const badgeInterval = computed(() =>
		realtime.connected.value ? BADGE_POLL_REALTIME_MS : BADGE_POLL_MS,
	);
	const { pause, resume } = useIntervalFn(refreshBadges, badgeInterval, { immediate: false });

	// The installed app's icon shows the unread count (Badging API, where supported).
	watch([unreadMessages, unreadNotifications], ([messages, notifications]) => {
		if (!import.meta.client || !("setAppBadge" in navigator)) return;
		const total = messages + notifications;
		const badge = total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge();
		void badge.catch(() => {});
	});

	// Several events in a row (a burst of messages) refresh once.
	const refreshSoon = useDebounceFn(() => void refreshBadges(), 400);
	useRealtimeEvent((event) => {
		if (event.type === "conversation" || event.type === "notification" || event.type === "resync") {
			void refreshSoon();
		}
	});

	defineShortcuts({
		"g-h": () => router.push("/"),
		"g-t": () => router.push("/tasks"),
		"g-m": () => router.push("/messages"),
		"g-k": () => router.push("/calendar"),
		"g-s": () => router.push("/settings"),
		n: () => {
			if (isNotificationsSlideoverOpen.value) isNotificationsSlideoverOpen.value = false;
			else openNotifications();
		},
	});

	return {
		isNotificationsSlideoverOpen,
		notificationsAsSlideover,
		openNotifications,
		unreadMessages,
		unreadNotifications,
		refreshBadges,
		startBadgePolling: () => {
			void refreshBadges();
			resume();
		},
		stopBadgePolling: pause,
	};
};

export const useDashboard = createSharedComposable(_useDashboard);
