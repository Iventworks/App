<script setup lang="ts">
/** History of one account: what was done to it, and what the person did. */
import type { AdminUserDetail } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const { data: user } = useSubrouterInjectedData<AdminUserDetail>("admin_user").inject();
</script>

<template>
	<div v-if="user" class="space-y-8">
		<section class="space-y-3">
			<div class="flex flex-wrap items-end justify-between gap-2">
				<div>
					<h2 class="text-xl font-semibold text-white">Änderungen an diesem Konto</h2>
					<p class="mt-1 text-sm text-slate-400">Angelegt, Rollen, Passwörter, Sperren – wer hat was getan.</p>
				</div>
				<UButton
					label="Im Audit-Log öffnen"
					icon="i-lucide-external-link"
					color="neutral"
					variant="ghost"
					size="sm"
					:to="`/admin/audit-log?entity_type=user&entity_id=${user.id}`"
				/>
			</div>
			<AuditLogTable entity-type="user" :entity-id="user.id" :default-page-size="10" />
		</section>

		<section class="space-y-3">
			<div class="flex flex-wrap items-end justify-between gap-2">
				<div>
					<h2 class="text-xl font-semibold text-white">Aktionen von {{ user.display_name }}</h2>
					<p class="mt-1 text-sm text-slate-400">Alles, was die Person in Events und der Organisation geändert hat.</p>
				</div>
				<UButton
					label="Im Audit-Log öffnen"
					icon="i-lucide-external-link"
					color="neutral"
					variant="ghost"
					size="sm"
					:to="`/admin/audit-log?user_id=${user.id}`"
				/>
			</div>
			<AuditLogTable :user-id="user.id" show-event hide-actor :default-page-size="10" />
		</section>
	</div>
</template>
