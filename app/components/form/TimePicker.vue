<script setup lang="ts">
/**
 * Time-of-day field: Nuxt UI's `UInputTime` (24 h). The model is `HH:mm`, or null when empty —
 * the format times are stored in.
 */
import { Time } from "@internationalized/date";

withDefaults(
	defineProps<{
		/** Show a button that empties the field (for optional times). */
		clearable?: boolean;
		disabled?: boolean;
	}>(),
	{ clearable: false, disabled: false },
);

const model = defineModel<string | null>({ default: null });

const pad = (value: number) => String(value).padStart(2, "0");

const value = computed({
	get: () => {
		if (!model.value) return undefined;
		const [hour, minute] = model.value.split(":").map(Number);
		return new Time(hour ?? 0, minute ?? 0);
	},
	set: (time: Time | undefined | null) => {
		model.value = time ? `${pad(time.hour)}:${pad(time.minute)}` : null;
	},
});
</script>

<template>
	<UInputTime
		v-model="value"
		:hour-cycle="24"
		:disabled="disabled"
		icon="i-lucide-clock"
		class="w-full"
	>
		<template v-if="clearable && model" #trailing>
			<UButton
				color="neutral"
				variant="link"
				size="sm"
				icon="i-lucide-x"
				aria-label="Uhrzeit leeren"
				class="px-0"
				:disabled="disabled"
				@click="model = null"
			/>
		</template>
	</UInputTime>
</template>
