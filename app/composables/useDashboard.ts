/**
 * useDashboard — shared dashboard chrome state: the notifications slideover, keyboard
 * shortcuts and the unread badges in the sidebar. The badges refresh when the realtime channel
 * says something changed, and are polled while the dashboard layout is mounted — every minute
 * without the channel, every five minutes as a safety net with it.
 */
import { createSharedComposable, useDebounceFn, useIntervalFn } from "@vueuse/core";

const BADGE_POLL_MS = 60_000;
const BADGE_POLL_REALTIME_MS = 5 * 60_000;

const _useDashboard = () => {
	const route = useRoute();
	const router = useRouter();

	const isNotificationsSlideoverOpen = ref(false);
	const unreadMessages = ref(0);
	const unreadNotifications = ref(0);

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
			isNotificationsSlideoverOpen.value = !isNotificationsSlideoverOpen.value;
		},
	});

	watch(
		() => route.fullPath,
		() => {
			isNotificationsSlideoverOpen.value = false;
		},
	);

	return {
		isNotificationsSlideoverOpen,
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
