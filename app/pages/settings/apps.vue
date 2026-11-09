<script setup lang="ts">
definePageMeta({ layout: "dashboard" });

// Every org installs as its own app (name and icon from its branding).
const brandName = useBrandName();
useSeoMeta({
	title: "App installieren | Einstellungen",
	description: () => `${brandName.value} als App auf Handy, Tablet oder Computer installieren`,
});

const toast = useToast();
const { isStandalone, platform, canPrompt, install } = usePwaInstall();
const installing = ref(false);

async function onInstall() {
	installing.value = true;
	const outcome = await install();
	installing.value = false;
	if (outcome === "accepted") {
		toast.add({
			title: `${brandName.value} wird installiert`,
			description: "Du findest die App gleich auf deinem Startbildschirm bzw. im Startmenü.",
			icon: "i-lucide-check",
			color: "success",
		});
	}
}

const PLATFORM_LABELS = {
	ios: "iPhone & iPad",
	android: "Android",
	desktop: "Computer",
} as const;

const benefits = [
	{ icon: "i-lucide-smartphone", text: "Eigenes App-Symbol auf dem Startbildschirm" },
	{ icon: "i-lucide-maximize", text: "Vollbild ohne Browser-Leiste" },
	{ icon: "i-lucide-refresh-cw", text: "Aktualisiert sich automatisch – nichts zum Herunterladen" },
];
</script>

<template>
	<UDashboardPanel id="settings-apps" :ui="{ body: 'lg:py-12' }">
		<template #header>
			<DashboardPageHeader
				title="App installieren"
				icon="i-lucide-smartphone"
				:description="`${brandName} wie eine App nutzen`"
			/>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<UAlert
					v-if="isStandalone"
					icon="i-lucide-badge-check"
					color="success"
					variant="subtle"
					:title="`Du nutzt ${brandName} bereits als App`"
					description="Auf diesem Gerät ist alles eingerichtet."
				/>

				<DashboardSectionCard
					v-else
					title="Auf diesem Gerät installieren"
					:description="`Erkannt: ${PLATFORM_LABELS[platform]}`"
					icon="i-lucide-download"
				>
					<div class="space-y-5">
						<ul class="space-y-2 text-sm text-slate-300">
							<li v-for="benefit in benefits" :key="benefit.text" class="flex items-center gap-2">
								<UIcon :name="benefit.icon" class="size-4 shrink-0 text-primary-400" />
								{{ benefit.text }}
							</li>
						</ul>

						<UButton
							v-if="canPrompt"
							label="Jetzt installieren"
							icon="i-lucide-download"
							size="lg"
							:loading="installing"
							@click="onInstall"
						/>

						<div v-else class="rounded-lg bg-slate-800/60 p-4 text-sm">
							<template v-if="platform === 'ios'">
								<p class="font-medium text-white">In Safari:</p>
								<ol class="mt-2 list-inside list-decimal space-y-1 text-slate-300">
									<li>
										Tippe unten auf
										<UIcon name="i-lucide-share" class="inline size-4 align-text-bottom" />
										„Teilen“.
									</li>
									<li>Wähle „Zum Home-Bildschirm“.</li>
									<li>Tippe auf „Hinzufügen“.</li>
								</ol>
								<p class="mt-3 text-xs text-slate-500">
									Auf iPhone und iPad klappt das nur in Safari, nicht in anderen Browsern.
								</p>
							</template>
							<template v-else-if="platform === 'android'">
								<p class="font-medium text-white">In Chrome:</p>
								<ol class="mt-2 list-inside list-decimal space-y-1 text-slate-300">
									<li>
										Öffne das Menü
										<UIcon name="i-lucide-ellipsis-vertical" class="inline size-4 align-text-bottom" />
										oben rechts.
									</li>
									<li>Wähle „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.</li>
								</ol>
							</template>
							<template v-else>
								<p class="font-medium text-white">In Chrome oder Edge:</p>
								<p class="mt-2 text-slate-300">
									Klicke rechts in der Adressleiste auf das Installieren-Symbol
									<UIcon name="i-lucide-monitor-down" class="inline size-4 align-text-bottom" />.
									In Firefox und Safari am Mac geht das nicht – nutze {{ brandName }} dort einfach im Browser.
								</p>
							</template>
						</div>
					</div>
				</DashboardSectionCard>

				<DashboardSectionCard
					title="Andere Geräte"
					:description="`So installierst du ${brandName} woanders`"
					icon="i-lucide-monitor-smartphone"
				>
					<div class="grid gap-4 text-sm sm:grid-cols-3">
						<div class="space-y-1">
							<p class="font-medium text-white">iPhone & iPad</p>
							<p class="text-slate-400">Safari → Teilen → „Zum Home-Bildschirm“</p>
						</div>
						<div class="space-y-1">
							<p class="font-medium text-white">Android</p>
							<p class="text-slate-400">Chrome → Menü → „App installieren“</p>
						</div>
						<div class="space-y-1">
							<p class="font-medium text-white">Computer</p>
							<p class="text-slate-400">Chrome/Edge → Installieren-Symbol in der Adressleiste</p>
						</div>
					</div>
				</DashboardSectionCard>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
