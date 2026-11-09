<script setup lang="ts">
/** Pages for people without an account (share links): the org's logo on top, no navigation. */
const instance = useInstance();
const brandName = useBrandName();
const appName = computed(() => instance.value?.app_name ?? "Iventworks");
</script>

<template>
	<NuxtLoadingIndicator color="var(--ui-primary)" position="top" />

	<div class="main-bg-color flex min-h-screen flex-col text-slate-100">
		<header class="border-b border-slate-800">
			<div class="mx-auto flex h-16 w-full max-w-5xl items-center px-4">
				<ImgAppLogo class="h-8" />
			</div>
		</header>

		<UMain class="relative flex-1">
			<div class="mx-auto w-full max-w-5xl px-4 py-8">
				<slot />
			</div>
		</UMain>

		<footer class="py-6 text-center text-sm text-slate-500">
			<template v-if="brandName !== appName">{{ brandName }} · </template>
			<a href="https://www.iventworks.de" target="_blank" rel="noopener" class="hover:text-slate-300">
				{{ appName }}
			</a>
		</footer>
	</div>
</template>
