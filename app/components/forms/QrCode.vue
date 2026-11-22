<script setup lang="ts">
/** A QR code for `value`, drawn as SVG (black on white, with its quiet zone). */
const props = defineProps<{ value: string }>();

const matrix = computed(() => qrMatrix(props.value));
const path = computed(() => qrPath(matrix.value));
</script>

<template>
	<svg
		:viewBox="`0 0 ${matrix.length} ${matrix.length}`"
		shape-rendering="crispEdges"
		role="img"
		:aria-label="`QR-Code für ${value}`"
	>
		<rect :width="matrix.length" :height="matrix.length" fill="#fff" />
		<path :d="path" fill="#000" />
	</svg>
</template>
