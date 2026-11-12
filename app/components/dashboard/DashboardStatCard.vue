<script setup lang="ts">
interface Props {
	label: string;
	value: string | number;
	icon: string;
	iconColor?: "primary" | "amber" | "emerald" | "error" | "neutral" | "info";
	hint?: string;
	loading?: boolean;
	to?: string;
	/**
	 * A click on the card. Without `to` the card gets a button over its whole area (a `<button>`
	 * may not hold the card's block content); with `to` it runs before the link navigates.
	 */
	onClick?: () => void;
}

withDefaults(defineProps<Props>(), {
	iconColor: "primary",
	hint: undefined,
	loading: false,
	to: undefined,
	onClick: undefined,
});

const iconColorClasses: Record<NonNullable<Props["iconColor"]>, string> = {
	primary: "text-primary-400",
	amber: "text-amber-400",
	emerald: "text-emerald-400",
	error: "text-red-400",
	neutral: "text-slate-400",
	info: "text-info",
};
</script>

<template>
	<component
		:is="to ? 'NuxtLink' : 'div'"
		:to="to"
		:class="[
			'relative block',
			to || onClick ? 'rounded-lg transition hover:ring-1 hover:ring-primary/40' : '',
		]"
		@click="to && onClick?.()"
	>
		<UCard class="h-full border-slate-800 bg-slate-900/60">
			<div class="flex items-center gap-4">
				<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-800">
					<UIcon :name="icon" :class="['text-xl', iconColorClasses[iconColor]]" />
				</div>
				<div class="min-w-0">
					<p class="text-2xl font-bold">{{ loading ? "…" : value }}</p>
					<p class="text-sm text-slate-400">{{ label }}</p>
					<p v-if="hint" class="truncate text-xs text-slate-500">{{ hint }}</p>
				</div>
			</div>
		</UCard>

		<button
			v-if="!to && onClick"
			type="button"
			class="absolute inset-0 cursor-pointer rounded-lg"
			:aria-label="label"
			@click="onClick"
		/>
	</component>
</template>
