<script setup lang="ts">
import type { BreadcrumbItem } from "@nuxt/ui";

const props = withDefaults(
	defineProps<{
		title?: string;
		icon?: string;
		description?: string;
		breadcrumbItems?: BreadcrumbItem[];
	}>(),
	{
		title: "",
		icon: undefined,
	},
);
</script>

<template>
	<UDashboardNavbar :title="props.title" :icon="props.icon">
		<!-- Only override `#leading` when a page provides it: the navbar's default leading content is
		     the sidebar toggle, which is the only way to open the sidebar on phones. -->
		<template v-if="$slots.leading" #leading>
			<slot name="leading"></slot>
		</template>

		<template v-if="breadcrumbItems?.length" #title>
			<slot name="title">
				<UBreadcrumb :items="breadcrumbItems" :ui="{ link: 'text-md' }" />
			</slot>
		</template>

		<template v-if="description" #trailing>
			<slot name="trailing">
				<span class="hidden text-slate-400 sm:inline">
					{{ description }}
				</span>
			</slot>
		</template>

		<template #left>
			<slot name="left"></slot>
		</template>

		<template #default>
			<slot></slot>
		</template>

		<template #right>
			<slot name="right"></slot>
		</template>
	</UDashboardNavbar>
</template>
