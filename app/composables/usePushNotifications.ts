/**
 * usePushNotifications — Web Push on this device (`/settings/notifications`).
 *
 * The browser subscribes at its push service with the server's VAPID key and the server stores
 * the subscription for the current login. Whether a person wants push on this device is kept per
 * user in `localStorage`: the browser permission is per site, not per person, so after a logout
 * and someone else's login nothing is pushed to them unless they switch it on themselves.
 *
 * `sync()` (dashboard layout) re-registers the subscription after every login — subscriptions end
 * with the session they were made in. `forget()` (logout) drops it in the browser.
 *
 * Needs the service worker, so it only works in production builds (not in `nuxt dev`). On iPhone
 * and iPad, only for the installed app (iOS 16.4+).
 */

const OPT_IN_PREFIX = "iventworks-push-on-";

const permission = ref<NotificationPermission | "unsupported">("default");
const subscribed = ref(false);
const endpoint = ref<string | null>(null);

function supported() {
	return (
		import.meta.client &&
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

function optInKey(userId: number) {
	return `${OPT_IN_PREFIX}${userId}`;
}

function readOptIn(userId: number) {
	try {
		return localStorage.getItem(optInKey(userId)) === "1";
	} catch {
		return false;
	}
}

function writeOptIn(userId: number, on: boolean) {
	try {
		if (on) localStorage.setItem(optInKey(userId), "1");
		else localStorage.removeItem(optInKey(userId));
	} catch {
		// Private mode: the setting just doesn't survive a reload.
	}
}

/** The service worker's registration; null in dev (no worker) or when it isn't there yet. */
async function registration() {
	if (!supported()) return null;
	try {
		return (await navigator.serviceWorker.getRegistration("/")) ?? null;
	} catch {
		return null;
	}
}

function base64UrlToBytes(value: string) {
	const padded = value
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array) {
	const current = subscription.options.applicationServerKey;
	if (!current) return false;
	const bytes = new Uint8Array(current);
	return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

export function usePushNotifications() {
	const isSupported = supported();

	async function refresh() {
		if (!isSupported) {
			permission.value = "unsupported";
			return;
		}
		permission.value = Notification.permission;
		const subscription = await (await registration())?.pushManager.getSubscription();
		subscribed.value = Boolean(subscription);
		endpoint.value = subscription?.endpoint ?? null;
	}

	/** Subscribe in the browser (with the server's key) and register it for the current login. */
	async function subscribeAndRegister(): Promise<{ ok: true } | { ok: false; message: string }> {
		const reg = await registration();
		if (!reg)
			return {
				ok: false,
				message: "Push funktioniert nur in der installierten bzw. veröffentlichten App.",
			};

		const config = await useAPI((api) => api.getPushConfig({}));
		if (!config.success) return { ok: false, message: config.message };
		const key = base64UrlToBytes(config.data.public_key);

		let subscription = await reg.pushManager.getSubscription();
		// Made with another server key (keys changed): start over.
		if (subscription && !sameKey(subscription, key)) {
			await subscription.unsubscribe().catch(() => {});
			subscription = null;
		}
		try {
			subscription ??= await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: key,
			});
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}

		const json = subscription.toJSON();
		const result = await useAPI((api) =>
			api.postPushSubscriptions({
				body: {
					endpoint: subscription.endpoint,
					keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
				},
			}),
		);
		if (!result.success) return { ok: false, message: result.message };
		subscribed.value = true;
		endpoint.value = subscription.endpoint;
		return { ok: true };
	}

	/** Switch push on for this device and person (asks for the browser permission). */
	async function enable(userId: number) {
		if (!isSupported)
			return {
				ok: false as const,
				message: "Dieser Browser unterstützt keine Push-Benachrichtigungen.",
			};
		permission.value = await Notification.requestPermission();
		if (permission.value !== "granted") {
			return { ok: false as const, message: "Benachrichtigungen wurden im Browser nicht erlaubt." };
		}
		const result = await subscribeAndRegister();
		if (result.ok) writeOptIn(userId, true);
		return result;
	}

	/** Switch push off for this device. */
	async function disable(userId: number) {
		writeOptIn(userId, false);
		const subscription = await (await registration())?.pushManager.getSubscription();
		if (subscription) {
			await useAPI((api) =>
				api.postPushSubscriptionsUnsubscribe({ body: { endpoint: subscription.endpoint } }),
			);
			await subscription.unsubscribe().catch(() => {});
		}
		subscribed.value = false;
		endpoint.value = null;
	}

	/** After login / app start: register this device again if the person switched push on here. */
	async function sync(userId: number) {
		await refresh();
		if (permission.value !== "granted" || !readOptIn(userId)) return;
		await subscribeAndRegister();
	}

	/** On logout: this browser stops receiving pushes (the server drops it with the session). */
	async function forget() {
		const subscription = await (await registration())?.pushManager.getSubscription();
		await subscription?.unsubscribe().catch(() => {});
		subscribed.value = false;
		endpoint.value = null;
	}

	function isOn(userId: number) {
		return subscribed.value && readOptIn(userId);
	}

	return {
		isSupported,
		permission: readonly(permission),
		subscribed: readonly(subscribed),
		endpoint: readonly(endpoint),
		refresh,
		enable,
		disable,
		sync,
		forget,
		isOn,
	};
}
