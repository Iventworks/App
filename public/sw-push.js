/*
 * Web Push in the service worker (imported into Workbox's `sw.js`, see `pwa.workbox.importScripts`
 * in nuxt.config.ts). The server sends an encrypted JSON payload
 * `{ kind, title, body, url, tag? }` (server/lib/push/service.ts); this shows it and opens the
 * right page on a click. The org's icon comes from its own host.
 */

const ICON = "/api/v1/instance/icon";

self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = { body: event.data ? event.data.text() : "" };
	}

	const title = typeof data.title === "string" && data.title ? data.title : "Neue Benachrichtigung";
	const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";

	event.waitUntil(
		(async () => {
			// The app is open and in front: it shows the change itself. (The server already holds pushes
			// back while someone is active; this covers the gap.) The test push always shows.
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			const inFront = windows.some((client) => client.focused && client.visibilityState === "visible");
			if (inFront && data.kind !== "test") return;

			if (self.navigator.setAppBadge && data.kind === "message") {
				await self.navigator.setAppBadge().catch(() => {});
			}

			await self.registration.showNotification(title, {
				body: typeof data.body === "string" ? data.body : "",
				icon: ICON,
				badge: ICON,
				tag: typeof data.tag === "string" ? data.tag : undefined,
				// A new message in the same chat replaces the old notification but still alerts.
				renotify: Boolean(data.tag),
				timestamp: Date.now(),
				data: { url },
			});
		})(),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path = event.notification.data?.url ?? "/";
	const target = new URL(path, self.location.origin).href;

	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			// Reuse an open window of the app.
			for (const client of windows) {
				if (new URL(client.url).origin !== self.location.origin) continue;
				await client.focus();
				if ("navigate" in client) await client.navigate(target).catch(() => {});
				return;
			}
			await self.clients.openWindow(target);
		})(),
	);
});
