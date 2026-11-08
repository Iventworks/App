<script setup lang="ts">
// useHead({
// 	meta: [
// 		{ charset: 'utf-8' },
// 		{ name: 'viewport', content: 'width=device-width, initial-scale=1' }
// 	],
// 	link: [
// 		{ rel: 'icon', href: '/favicon.ico' }
// 	],
// 	htmlAttrs: {
// 		lang: 'de'
// 	}
// })

</script>

<template>
	<!-- <NuxtPwaManifest /> -->
	<UApp>
		<NuxtLoadingIndicator
        	color="#ff8904"
        	position="top"
    	/>
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>
