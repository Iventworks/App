<script setup lang="ts">
/**
 * A question in our modal style, instead of the browser's `window.confirm`. Opened through
 * `useConfirmDialog()` / `useUnsavedChangesDialog()` (Nuxt UI `useOverlay`), so route guards can
 * await the answer. Emits `close("confirm" | "alternative" | "cancel")`; closing it any other way
 * (Escape, outside click) counts as cancel.
 */
type Color = "primary" | "error" | "warning" | "neutral";

const props = withDefaults(
	defineProps<{
		title: string;
		description?: string;
		icon?: string;
		iconColor?: Color;
		confirmLabel?: string;
		confirmColor?: Color;
		confirmIcon?: string;
		/** An optional second action between cancel and confirm, e.g. "Verwerfen". */
		alternativeLabel?: string;
		alternativeColor?: Color;
		cancelLabel?: string;
	}>(),
	{
		description: undefined,
		icon: "i-lucide-circle-help",
		iconColor: "primary",
		confirmLabel: "OK",
		confirmColor: "primary",
		confirmIcon: undefined,
		alternativeLabel: undefined,
		alternativeColor: "neutral",
		cancelLabel: "Abbrechen",
	},
);

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{
	close: [choice: "confirm" | "alternative" | "cancel"];
	"after:leave": [];
}>();

const ICON_CLASSES: Record<Color, string> = {
	primary: "text-primary-400",
	error: "text-red-400",
	warning: "text-amber-400",
	neutral: "text-slate-400",
};
</script>

<template>
	<UModal
		v-model:open="open"
		:title="props.title"
		:description="props.description"
		:ui="{ content: 'sm:max-w-md', footer: 'justify-end' }"
		@after:leave="emit('after:leave')"
	>
		<template #title>
			<div class="flex items-center gap-2">
				<UIcon :name="props.icon" :class="ICON_CLASSES[props.iconColor]" />
				<span>{{ props.title }}</span>
			</div>
		</template>

		<template #footer>
			<div class="flex flex-wrap justify-end gap-2">
				<UButton :label="props.cancelLabel" color="neutral" variant="ghost" @click="emit('close', 'cancel')" />
				<UButton
					v-if="props.alternativeLabel"
					:label="props.alternativeLabel"
					:color="props.alternativeColor"
					variant="subtle"
					@click="emit('close', 'alternative')"
				/>
				<UButton
					:label="props.confirmLabel"
					:color="props.confirmColor"
					:icon="props.confirmIcon"
					autofocus
					@click="emit('close', 'confirm')"
				/>
			</div>
		</template>
	</UModal>
</template>
