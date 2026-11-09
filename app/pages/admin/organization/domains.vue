<script setup lang="ts">
/** Custom domains of the org (multi-org mode). */
import type { OrgSettings } from "~/utils/types";

const settings = useSubrouterInjectedData<OrgSettings>("organization").inject();
</script>

<template>
	<div class="mx-auto w-full lg:w-4xl">
		<OrgDomainsManager
			v-if="settings.data.value.multi_org"
			:default-domain="settings.data.value.org.default_domain"
			@changed="settings.refresh()"
		/>
		<UAlert
			v-else
			color="neutral"
			variant="subtle"
			icon="i-lucide-info"
			title="Eigene Domains gibt es nur, wenn mehrere Organisationen auf einer Installation laufen."
		/>
	</div>
</template>
