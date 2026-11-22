<script setup lang="ts">
/** A link that leads nowhere (unknown, expired, deleted, switched off): the same for every kind. */
withDefaults(defineProps<{ title?: string; description?: string }>(), {
	title: "Link nicht gefunden",
	description: undefined,
});

const brandName = useBrandName();
</script>

<template>
	<UPageCard class="mx-auto max-w-lg border-slate-800">
		<div class="flex flex-col items-center gap-3 py-4 text-center">
			<UIcon name="i-lucide-link-2-off" class="size-12 text-primary-400" />
			<h1 class="text-xl font-semibold text-white">{{ title }}</h1>
			<p class="text-sm text-slate-400">
				{{
					description ??
					`Dieser Link ist abgelaufen, wurde gelöscht oder hat sich vertippt. Frag bei ${brandName} nach einem neuen.`
				}}
			</p>
		</div>
	</UPageCard>
</template>
