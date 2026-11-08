/**
 * useDashboard — shared dashboard chrome state: the notifications slideover, keyboard
 * shortcuts and the unread badges in the sidebar (polled while the dashboard layout is mounted).
 */
import { createSharedComposable, useIntervalFn } from "@vueuse/core";

const BADGE_POLL_MS = 60_000;

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

	const { pause, resume } = useIntervalFn(refreshBadges, BADGE_POLL_MS, { immediate: false });

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
