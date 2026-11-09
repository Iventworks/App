<script setup lang="ts">
/** Custom domains of one org, managed by the system admins. */
import type { SystemOrg } from "~/utils/types";

const org = useSubrouterInjectedData<SystemOrg>("system_org").inject();
</script>

<template>
	<div class="mx-auto w-full lg:w-4xl">
		<OrgDomainsManager
			:org-id="org.data.value.id"
			:default-domain="org.data.value.default_domain"
			@changed="org.refresh()"
		/>
	</div>
</template>
