/**
 * usePwaInstall — install the org's app as a PWA ("App installieren").
 *
 * Chromium browsers fire `beforeinstallprompt` once, early, when the app is installable; the
 * `pwaInstall.client` plugin catches it at startup and `install()` replays it on a user click.
 * Safari (iPhone/iPad) has no prompt API — there the page shows the "Teilen → Zum
 * Home-Bildschirm" steps instead. Module-level state is fine: the app renders client-side only.
 */

/** Chromium's install prompt event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const deferredPrompt = shallowRef<BeforeInstallPromptEvent | null>(null);
const installedNow = ref(false);

/** Called by the client plugin as early as possible. */
export function registerPwaInstallListeners() {
	window.addEventListener("beforeinstallprompt", (event) => {
		// Keep the browser's mini-infobar from showing; we offer our own button.
		event.preventDefault();
		deferredPrompt.value = event as BeforeInstallPromptEvent;
	});
	window.addEventListener("appinstalled", () => {
		deferredPrompt.value = null;
		installedNow.value = true;
	});
}

export function usePwaInstall() {
	const userAgent = import.meta.client ? navigator.userAgent : "";

	/** Running as the installed app (standalone window / home-screen icon). */
	const isStandalone = computed(
		() =>
			installedNow.value ||
			(import.meta.client &&
				(window.matchMedia("(display-mode: standalone)").matches ||
					// iOS Safari's own flag for home-screen apps.
					(navigator as Navigator & { standalone?: boolean }).standalone === true)),
	);

	const platform = computed<"ios" | "android" | "desktop">(() => {
		if (
			/iPad|iPhone|iPod/.test(userAgent) ||
			(/Macintosh/.test(userAgent) && "ontouchend" in document)
		) {
			return "ios";
		}
		if (/Android/.test(userAgent)) return "android";
		return "desktop";
	});

	/** The browser offers a one-click install (Chrome, Edge, Samsung Internet, …). */
	const canPrompt = computed(() => deferredPrompt.value !== null);

	async function install(): Promise<"accepted" | "dismissed" | "unavailable"> {
		const event = deferredPrompt.value;
		if (!event) return "unavailable";
		await event.prompt();
		const { outcome } = await event.userChoice;
		// A prompt event can only be used once.
		deferredPrompt.value = null;
		return outcome;
	}

	return { isStandalone, platform, canPrompt, install };
}
