<script setup lang="ts">
/** A compact emoji grid (no search, no dependency): pick one for a reaction or the composer. */
const emit = defineEmits<{
	select: [emoji: string];
}>();

const active = ref(0);
</script>

<template>
	<div class="w-72 max-w-[calc(100vw-2rem)] p-2">
		<div class="flex gap-1 border-b border-slate-800 pb-2">
			<UTooltip v-for="(group, index) in EMOJI_GROUPS" :key="group.label" :text="group.label">
				<UButton
					:icon="group.icon"
					:color="index === active ? 'primary' : 'neutral'"
					:variant="index === active ? 'soft' : 'ghost'"
					size="sm"
					:aria-label="group.label"
					@click="active = index"
				/>
			</UTooltip>
		</div>
		<div class="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto pt-2">
			<button
				v-for="emoji in EMOJI_GROUPS[active]?.emojis"
				:key="emoji"
				type="button"
				class="flex size-8 items-center justify-center rounded-md text-xl transition hover:bg-slate-800"
				@click="emit('select', emoji)"
			>
				{{ emoji }}
			</button>
		</div>
	</div>
</template>
