<template>
	<NuxtLoadingIndicator color="var(--ui-primary)" position="top" />

	<div class="main-bg-color flex min-h-screen flex-col text-slate-100">
		<UMain class="relative flex flex-1 flex-col items-center justify-center px-4 py-10">
			<div
				class="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-primary/5 to-transparent"
			></div>
			<ImgAppLogo class="relative mb-8 h-10" />
			<UPageCard class="relative w-full max-w-md border-slate-800">
				<slot />
			</UPageCard>
		</UMain>

		<footer class="py-6 text-center text-sm text-slate-500">
			&copy; {{ new Date().getFullYear() }} Crossover · Crossover Management Portal
		</footer>
	</div>
</template>
