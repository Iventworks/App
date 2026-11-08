<template>
	<NuxtRouteAnnouncer />
	<UApp :toaster="{ position: 'bottom-right' }">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>
