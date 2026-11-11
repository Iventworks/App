<script setup lang="ts">
/** The small line at the bottom right of a bubble: pinned, edited, time and the read ticks. */
defineProps<{
	createdAt: number;
	edited: boolean;
	pinned: boolean;
	/** Own messages show ticks: one = sent, two = read by everyone else in the chat. */
	own: boolean;
	read: boolean;
}>();
</script>

<template>
	<span class="flex items-center gap-1 whitespace-nowrap text-[11px] leading-none text-slate-400">
		<UIcon v-if="pinned" name="i-lucide-pin" class="size-3" aria-label="Angeheftet" />
		<span v-if="edited">bearbeitet</span>
		<time :datetime="new Date(createdAt).toISOString()">{{ formatTime(createdAt) }}</time>
		<UIcon
			v-if="own"
			:name="read ? 'i-lucide-check-check' : 'i-lucide-check'"
			:class="['size-3.5', read ? 'text-primary-400' : '']"
			:aria-label="read ? 'Gelesen' : 'Gesendet'"
		/>
	</span>
</template>
