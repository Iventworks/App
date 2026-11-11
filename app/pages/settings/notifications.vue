<script setup lang="ts">
/**
 * Notifications: push on this device (on/off, test), what to get, the devices that get pushes,
 * and whether others see you online.
 */
import type {
	GetAccountPreferencesNotificationsResponses,
	GetPushSubscriptionsResponses,
} from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Settings = GetAccountPreferencesNotificationsResponses["200"]["data"];
type Device = GetPushSubscriptionsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Benachrichtigungen | Einstellungen" });

const toast = useToast();
const user = await useUserInfoStore().use();
const push = usePushNotifications();
const { platform, isStandalone } = usePwaInstall();

const { data: settings, refresh: refreshSettings } = await useAPIAsyncData(
	"settings-notifications",
	async () => {
		const result = await useAPI((api) => api.getAccountPreferencesNotifications({}));
		return result.success ? result.data : null;
	},
);

const { data: devices, refresh: refreshDevices } = await useAPIAsyncData(
	"settings-push-devices",
	async () => {
		const result = await useAPI((api) => api.getPushSubscriptions({}));
		return result.success ? result.data : ([] as Device[]);
	},
);

onMounted(() => void push.refresh());

const userId = computed(() => user.value?.id ?? 0);
const isOn = computed(() => push.isOn(userId.value));

/** Why push can't be switched on here, or null. */
const blocker = computed(() => {
	if (!push.isSupported) {
		if (platform.value === "ios" && !isStandalone.value) {
			return {
				title: "Erst als App installieren",
				description:
					"Auf iPhone und iPad gibt es Push-Benachrichtigungen nur für die installierte App (ab iOS 16.4).",
				link: true,
			};
		}
		return {
			title: "Nicht unterstützt",
			description: "Dieser Browser kann keine Push-Benachrichtigungen empfangen.",
			link: false,
		};
	}
	if (push.permission.value === "denied") {
		return {
			title: "Im Browser blockiert",
			description:
				"Du hast Benachrichtigungen für diese Seite abgelehnt. Erlaube sie in den Website-Einstellungen deines Browsers und lade die Seite neu.",
			link: false,
		};
	}
	return null;
});

const switching = ref(false);

async function toggle(on: boolean) {
	switching.value = true;
	const result = on
		? await push.enable(userId.value)
		: (await push.disable(userId.value), { ok: true as const });
	switching.value = false;
	await refreshDevices();
	if (!result.ok) {
		toast.add({
			title: "Push konnte nicht eingeschaltet werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({
		title: on ? "Push-Benachrichtigungen sind an" : "Push-Benachrichtigungen sind aus",
		description: on ? "Auf diesem Gerät bekommst du jetzt Benachrichtigungen." : undefined,
		color: "success",
		icon: on ? "i-lucide-bell-ring" : "i-lucide-bell-off",
	});
}

const testing = ref(false);

async function sendTest() {
	testing.value = true;
	const result = await useAPI((api) => api.postPushTest({}));
	testing.value = false;
	if (!result.success) {
		toast.add({ title: "Test fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: "Test gesendet",
		description: `An ${result.data.devices} ${result.data.devices === 1 ? "Gerät" : "Geräte"}. Er kommt in wenigen Sekunden.`,
		color: "success",
		icon: "i-lucide-send",
	});
}

// --- what to get ----------------------------------------------------------------------------

const saving = ref<keyof Settings | null>(null);

async function update(key: keyof Settings, value: boolean) {
	saving.value = key;
	const result = await useAPI((api) =>
		api.putAccountPreferencesNotifications({ body: { [key]: value } }),
	);
	saving.value = null;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	settings.value = result.data;
}

const OPTIONS: { key: keyof Settings; label: string; description: string; icon: string }[] = [
	{
		key: "push_messages",
		label: "Neue Nachrichten",
		description: "Aus Chats, die du nicht stummgeschaltet hast.",
		icon: "i-lucide-message-circle",
	},
	{
		key: "push_preview",
		label: "Nachrichtentext anzeigen",
		description: "Aus: nur „Neue Nachricht von …“ – praktisch, wenn andere dein Display sehen.",
		icon: "i-lucide-eye",
	},
	{
		key: "push_notifications",
		label: "Andere Benachrichtigungen",
		description: "Aufgaben, Events, Dienste, Ausgaben, Neuigkeiten …",
		icon: "i-lucide-bell",
	},
];

// --- devices --------------------------------------------------------------------------------

async function removeDevice(device: Device) {
	const result = await useAPI((api) =>
		api.deletePushSubscriptionsBySubscriptionId({ path: { subscriptionId: device.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Entfernen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	if (device.endpoint === push.endpoint.value) await push.disable(userId.value);
	await refreshDevices();
}

watch(
	() => push.subscribed.value,
	() => void refreshSettings(),
);
</script>

<template>
	<UDashboardPanel id="settings-notifications" :ui="{ body: 'lg:py-12' }">
		<template #header>
			<DashboardPageHeader
				title="Benachrichtigungen"
				icon="i-lucide-bell-ring"
				description="Push-Benachrichtigungen und Online-Status"
			/>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<DashboardSectionCard
					title="Push auf diesem Gerät"
					description="Benachrichtigungen, auch wenn die App geschlossen ist"
					icon="i-lucide-smartphone"
				>
					<UAlert
						v-if="blocker"
						icon="i-lucide-info"
						color="warning"
						variant="subtle"
						:title="blocker.title"
						:description="blocker.description"
						:actions="blocker.link ? [{ label: 'App installieren', to: '/settings/apps', color: 'neutral', variant: 'subtle' }] : undefined"
					/>

					<div v-else class="flex flex-wrap items-center justify-between gap-4">
						<div class="min-w-0">
							<p class="font-medium text-white">
								{{ isOn ? "Eingeschaltet" : "Ausgeschaltet" }}
							</p>
							<p class="text-sm text-slate-400">
								{{
									isOn
										? "Solange du die App gerade nutzt, kommt kein Push – dann siehst du alles direkt."
										: "Schalte Push ein, um Nachrichten und Benachrichtigungen sofort zu bekommen."
								}}
							</p>
						</div>
						<div class="flex items-center gap-2">
							<UButton
								v-if="isOn"
								label="Test senden"
								icon="i-lucide-send"
								color="neutral"
								variant="subtle"
								:loading="testing"
								@click="sendTest"
							/>
							<USwitch
								:model-value="isOn"
								:loading="switching"
								:disabled="switching"
								aria-label="Push auf diesem Gerät"
								@update:model-value="toggle"
							/>
						</div>
					</div>
				</DashboardSectionCard>

				<DashboardSectionCard title="Was soll gepusht werden?" icon="i-lucide-sliders-horizontal">
					<div v-if="settings" class="divide-y divide-slate-800">
						<div
							v-for="option in OPTIONS"
							:key="option.key"
							class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
						>
							<div class="min-w-0">
								<p class="flex items-center gap-2 text-sm font-medium text-slate-200">
									<UIcon :name="option.icon" class="size-4 text-slate-400" />
									{{ option.label }}
								</p>
								<p class="text-xs text-slate-500">{{ option.description }}</p>
							</div>
							<USwitch
								:model-value="settings[option.key]"
								:loading="saving === option.key"
								:disabled="option.key === 'push_preview' && !settings.push_messages"
								:aria-label="option.label"
								@update:model-value="update(option.key, $event)"
							/>
						</div>
					</div>
					<p class="mt-4 text-xs text-slate-500">
						Gilt für alle deine Geräte. Einzelne Chats schaltest du in den Chat-Details stumm.
					</p>
				</DashboardSectionCard>

				<DashboardSectionCard
					title="Geräte"
					description="Hier bekommst du Push-Benachrichtigungen"
					icon="i-lucide-monitor-smartphone"
				>
					<p v-if="!devices?.length" class="text-sm text-slate-500">Noch kein Gerät.</p>
					<ul v-else class="divide-y divide-slate-800">
						<li
							v-for="device in devices"
							:key="device.id"
							class="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
						>
							<div class="min-w-0">
								<p class="flex items-center gap-2 text-sm text-white">
									{{ device.label ?? "Unbekanntes Gerät" }}
									<UBadge
										v-if="device.endpoint === push.endpoint.value"
										label="Dieses Gerät"
										color="primary"
										variant="subtle"
										size="sm"
									/>
								</p>
								<p class="text-xs text-slate-500">
									Seit {{ formatDay(device.created_at) }}
									<template v-if="device.last_success_at">
										· zuletzt zugestellt {{ formatRelative(device.last_success_at) }}
									</template>
								</p>
							</div>
							<UButton
								icon="i-lucide-trash-2"
								color="neutral"
								variant="ghost"
								size="sm"
								aria-label="Gerät entfernen"
								@click="removeDevice(device)"
							/>
						</li>
					</ul>
					<p class="mt-4 text-xs text-slate-500">
						Beim Abmelden endet Push auf dem jeweiligen Gerät automatisch.
					</p>
				</DashboardSectionCard>

				<DashboardSectionCard title="Privatsphäre" icon="i-lucide-eye-off">
					<div v-if="settings" class="flex items-center justify-between gap-4">
						<div class="min-w-0">
							<p class="text-sm font-medium text-slate-200">Online-Status zeigen</p>
							<p class="text-xs text-slate-500">
								Andere sehen, wann du online bist und wann du zuletzt online warst. Aus: niemand sieht
								es.
							</p>
						</div>
						<USwitch
							:model-value="settings.share_presence"
							:loading="saving === 'share_presence'"
							aria-label="Online-Status zeigen"
							@update:model-value="update('share_presence', $event)"
						/>
					</div>
				</DashboardSectionCard>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
