<script setup lang="ts">
useSeoMeta({
	title: 'Downloads | Kontoeinstellungen | CMP',
	description: 'Laden Sie die CMP Mobile Apps für Android, iOS und Windows herunter'
})

const downloads = [
	{
		platform: 'Android',
		icon: 'i-lucide-smartphone',
		color: 'success',
		description: 'Verfügbar für Android-Geräte',
		files: [
			{
				name: 'Android App Bundle (.aab)',
				description: 'Für Google Play Store',
				url: '/static/mobile-apps/cmp_1.0.0.aab',
				icon: 'i-lucide-package'
			},
			{
				name: 'Android APK (.apk)',
				description: 'Für direkte Installation',
				url: '/static/mobile-apps/cmp_1.0.0.apk',
				icon: 'i-lucide-download'
			}
		]
	},
	{
		platform: 'iOS',
		icon: 'i-lucide-smartphone',
		color: 'neutral',
		description: 'Demnächst verfügbar',
		files: [],
		comingSoon: true
	},
	{
		platform: 'Windows',
		icon: 'i-lucide-laptop',
		color: 'neutral',
		description: 'Demnächst verfügbar',
		files: [],
		comingSoon: true
	}
]
</script>

<template>
	<div class="space-y-6">
		<div>
			<h2 class="text-xl font-semibold text-white">Mobile Apps & Desktop-Clients</h2>
			<p class="text-sm text-gray-400 mt-1">
				Laden Sie die CMP-App für Ihr Gerät herunter
			</p>
		</div>

		<div class="grid gap-6 md:grid-cols-1 lg:grid-cols-1">
			<UCard v-for="download in downloads" :key="download.platform" :ui="{ body: 'space-y-4' }">
				<template #header>
					<div class="flex items-center gap-3">
						<UIcon :name="download.icon" class="w-6 h-6" :class="`text-${download.color}-500`" />
						<div class="flex-1">
							<h3 class="text-lg font-semibold text-white">{{ download.platform }}</h3>
							<p class="text-sm text-gray-400">{{ download.description }}</p>
						</div>
						<UBadge v-if="download.comingSoon" color="neutral" variant="subtle">
							Demnächst
						</UBadge>
					</div>
				</template>

				<div v-if="download.files && download.files.length > 0" class="space-y-3">
					<div 
						v-for="file in download.files" 
						:key="file.name"
						class="flex items-center justify-between p-4 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors"
					>
						<div class="flex items-center gap-3">
							<UIcon :name="file.icon" class="w-5 h-5 text-gray-400" />
							<div>
								<p class="text-sm font-medium text-white">{{ file.name }}</p>
								<p class="text-xs text-gray-400">{{ file.description }}</p>
							</div>
						</div>
						<UButton
							:to="file.url"
							download
							icon="i-lucide-download"
							color="primary"
							variant="solid"
							size="sm"
							external
						>
							Download
						</UButton>
					</div>
				</div>

				<div v-else-if="download.comingSoon" class="text-center py-8">
					<UIcon name="i-lucide-clock" class="w-12 h-12 text-gray-600 mx-auto mb-2" />
					<p class="text-sm text-gray-500">Diese Plattform wird bald unterstützt</p>
				</div>
			</UCard>
		</div>

		<UCard>
			<template #header>
				<div class="flex items-center gap-3">
					<UIcon name="i-lucide-info" class="w-5 h-5 text-blue-500" />
					<h3 class="text-lg font-semibold text-white">Installationshinweise</h3>
				</div>
			</template>

			<div class="space-y-4 text-sm text-gray-300">
				<div>
					<h4 class="font-medium text-white mb-2">Android APK Installation</h4>
					<ol class="list-decimal list-inside space-y-1 text-gray-400">
						<li>Laden Sie die APK-Datei herunter</li>
						<li>Öffnen Sie die Datei auf Ihrem Android-Gerät</li>
						<li>Erlauben Sie die Installation aus unbekannten Quellen, falls erforderlich</li>
						<li>Folgen Sie den Installationsanweisungen</li>
					</ol>
				</div>

				<div>
					<h4 class="font-medium text-white mb-2">Android App Bundle (.aab)</h4>
					<p class="text-gray-400">
						Die .aab-Datei ist für Entwickler gedacht, um die App im Google Play Store zu veröffentlichen. 
						Für die direkte Installation auf Ihrem Gerät verwenden Sie bitte die APK-Datei.
					</p>
				</div>
			</div>
		</UCard>
	</div>
</template>
