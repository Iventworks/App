<script setup lang="ts">
/** Pick the org's primary colour from the Tailwind palettes Nuxt UI can use. */
import colors from "tailwindcss/colors";
import type { OrgPrimaryColor } from "~/utils/types";

const model = defineModel<OrgPrimaryColor>({ required: true });
defineProps<{ disabled?: boolean }>();

const PALETTES: { value: OrgPrimaryColor; label: string }[] = [
	{ value: "red", label: "Rot" },
	{ value: "orange", label: "Orange" },
	{ value: "amber", label: "Bernstein" },
	{ value: "yellow", label: "Gelb" },
	{ value: "lime", label: "Limette" },
	{ value: "green", label: "Grün" },
	{ value: "emerald", label: "Smaragd" },
	{ value: "teal", label: "Petrol" },
	{ value: "cyan", label: "Cyan" },
	{ value: "sky", label: "Himmelblau" },
	{ value: "blue", label: "Blau" },
	{ value: "indigo", label: "Indigo" },
	{ value: "violet", label: "Violett" },
	{ value: "purple", label: "Lila" },
	{ value: "fuchsia", label: "Fuchsia" },
	{ value: "pink", label: "Pink" },
	{ value: "rose", label: "Rosé" },
];

function swatch(value: OrgPrimaryColor) {
	return (colors as unknown as Record<string, Record<number, string>>)[value]?.[400] ?? "#888";
}
</script>

<template>
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Hauptfarbe">
		<UTooltip v-for="palette in PALETTES" :key="palette.value" :text="palette.label">
			<button
				type="button"
				role="radio"
				:aria-checked="model === palette.value"
				:aria-label="palette.label"
				:disabled="disabled"
				class="flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-slate-900 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
				:class="model === palette.value ? 'ring-2 ring-white' : 'hover:scale-110'"
				:style="{ backgroundColor: swatch(palette.value) }"
				@click="model = palette.value"
			>
				<UIcon v-if="model === palette.value" name="i-lucide-check" class="size-4 text-slate-950" />
			</button>
		</UTooltip>
	</div>
</template>
