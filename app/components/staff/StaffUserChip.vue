<script setup lang="ts">
/** Avatar (initials) + display name for a user summary; optional secondary line. */
import type { UserSummary } from "~/utils/types";

withDefaults(
	defineProps<{
		user: Pick<UserSummary, "display_name"> & Partial<Pick<UserSummary, "id">>;
		hint?: string | null;
		size?: "xs" | "sm" | "md";
		highlight?: boolean;
	}>(),
	{
		hint: null,
		size: "sm",
		highlight: false,
	},
);

const avatarSizes = { xs: "3xs", sm: "2xs", md: "sm" } as const;
const textSizes = { xs: "text-xs", sm: "text-sm", md: "text-sm" } as const;
</script>

<template>
	<span class="inline-flex min-w-0 items-center gap-2">
		<UAvatar
			:text="initials(user.display_name)"
			:alt="user.display_name"
			:size="avatarSizes[size]"
			:class="highlight ? 'ring-2 ring-primary' : ''"
		/>
		<span class="min-w-0">
			<span :class="['block truncate', textSizes[size], highlight ? 'font-medium text-primary-300' : 'text-slate-200']">
				{{ user.display_name }}
			</span>
			<span v-if="hint" class="block truncate text-xs text-slate-500">{{ hint }}</span>
		</span>
	</span>
</template>
