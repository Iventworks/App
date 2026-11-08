<script setup lang="ts">
definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Apps | Einstellungen | CMP",
	description: "Die CMP-App für Android herunterladen oder als Web-App installieren",
});

const APP_VERSION = "1.0.2";

const androidFiles = [
	{
		name: "Android-App (.apk)",
		description: "Direkt auf deinem Gerät installieren",
		url: `/static/mobile-apps/cmp_${APP_VERSION}.apk`,
		icon: "i-lucide-download",
		primary: true,
	},
	{
		name: "App Bundle (.aab)",
		description: "Nur für die Veröffentlichung im Play Store",
		url: `/static/mobile-apps/cmp_${APP_VERSION}.aab`,
		icon: "i-lucide-package",
		primary: false,
	},
];

const comingSoon = [
	{ platform: "iOS", icon: "i-lucide-smartphone" },
	{ platform: "Windows", icon: "i-lucide-laptop" },
];
</script>

<template>
	<UDashboardPanel id="settings-apps" :ui="{ body: 'lg:py-12' }">
		<template #header>
			<DashboardPageHeader
				title="Apps"
				icon="i-lucide-smartphone"
				description="CMP auf dem Handy nutzen"
			/>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<DashboardSectionCard
					title="Android"
					:description="`Version ${APP_VERSION}`"
					icon="i-lucide-smartphone"
				>
					<div class="space-y-3">
						<div
							v-for="file in androidFiles"
							:key="file.name"
							class="flex flex-wrap items-center gap-3 rounded-lg bg-slate-800/60 p-4"
						>
							<UIcon :name="file.icon" class="size-5 text-slate-400" />
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium text-white">{{ file.name }}</p>
								<p class="text-xs text-slate-400">{{ file.description }}</p>
							</div>
							<UButton
								:to="file.url"
								download
								external
								label="Herunterladen"
								icon="i-lucide-download"
								size="sm"
								:color="file.primary ? 'primary' : 'neutral'"
								:variant="file.primary ? 'solid' : 'subtle'"
							/>
						</div>
					</div>

					<div class="mt-6 space-y-2 text-sm">
						<p class="font-medium text-white">So installierst du die APK</p>
						<ol class="list-inside list-decimal space-y-1 text-slate-400">
							<li>Lade die APK-Datei auf deinem Android-Gerät herunter.</li>
							<li>Öffne die Datei aus den Downloads.</li>
							<li>Erlaube bei Nachfrage die Installation aus dieser Quelle.</li>
							<li>Folge den Installationsschritten und melde dich in der App an.</li>
						</ol>
					</div>
				</DashboardSectionCard>

				<DashboardSectionCard
					title="Als Web-App installieren"
					description="Funktioniert auf iPhone, Android und am Computer"
					icon="i-lucide-app-window"
				>
					<div class="grid gap-4 text-sm sm:grid-cols-2">
						<div class="space-y-1">
							<p class="font-medium text-white">iPhone & iPad (Safari)</p>
							<p class="text-slate-400">
								Tippe auf <UIcon name="i-lucide-share" class="inline size-4 align-text-bottom" />
								„Teilen“ und wähle „Zum Home-Bildschirm“.
							</p>
						</div>
						<div class="space-y-1">
							<p class="font-medium text-white">Android (Chrome)</p>
							<p class="text-slate-400">
								Öffne das Menü
								<UIcon name="i-lucide-ellipsis-vertical" class="inline size-4 align-text-bottom" />
								und wähle „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.
							</p>
						</div>
						<div class="space-y-1 sm:col-span-2">
							<p class="font-medium text-white">Computer (Chrome, Edge)</p>
							<p class="text-slate-400">
								Klicke in der Adressleiste auf das Installieren-Symbol
								<UIcon name="i-lucide-monitor-down" class="inline size-4 align-text-bottom" />.
							</p>
						</div>
					</div>
				</DashboardSectionCard>

				<div class="grid gap-4 sm:grid-cols-2">
					<UCard
						v-for="entry in comingSoon"
						:key="entry.platform"
						class="border-slate-800 bg-slate-900/60"
					>
						<div class="flex items-center gap-3">
							<UIcon :name="entry.icon" class="size-6 text-slate-500" />
							<div class="flex-1">
								<p class="font-medium text-white">{{ entry.platform }}</p>
								<p class="text-xs text-slate-500">Eigene App folgt – bis dahin die Web-App nutzen.</p>
							</div>
							<UBadge label="Demnächst" color="neutral" variant="subtle" />
						</div>
					</UCard>
				</div>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
