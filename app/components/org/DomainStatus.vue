<script setup lang="ts">
/**
 * A custom domain's state. Active once it is both DNS-verified and approved; until then, what is
 * still missing (both can be).
 */
import type { OrgDomain } from "~/utils/types";

defineProps<{ domain: Pick<OrgDomain, "verified" | "approved" | "active" | "last_check_error"> }>();
</script>

<template>
	<UBadge v-if="domain.active" label="Aktiv" color="success" variant="soft" size="sm" icon="i-lucide-badge-check" />
	<div v-else class="flex flex-wrap gap-1">
		<UTooltip v-if="!domain.verified" :text="domain.last_check_error ?? 'Noch nicht geprüft'">
			<UBadge label="DNS ausstehend" color="warning" variant="soft" size="sm" icon="i-lucide-clock" />
		</UTooltip>
		<UTooltip v-if="!domain.approved" text="Ein System-Admin richtet die Domain im Reverse Proxy ein und gibt sie dann frei.">
			<UBadge label="Freigabe ausstehend" color="info" variant="soft" size="sm" icon="i-lucide-shield-question" />
		</UTooltip>
	</div>
</template>
