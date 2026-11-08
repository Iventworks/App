<script setup lang="ts">
/** Suspend an account with an optional reason (shown to admins, kept in the audit log). */
import type { AdminUser } from "~/utils/types";

const props = defineProps<{ user: AdminUser | null }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ suspended: [] }>();

const toast = useToast();
const reason = ref("");
const saving = ref(false);

watch(open, (value) => {
	if (value) reason.value = "";
});

async function submit() {
	const target = props.user;
	if (!target) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.postAdminUsersByUserIdSuspend({
			path: { userId: target.id },
			body: { reason: reason.value.trim() || undefined },
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({
			title: "Sperren fehlgeschlagen",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}
	toast.add({ title: `${target.display_name} gesperrt`, icon: "i-lucide-ban", color: "success" });
	open.value = false;
	emit("suspended");
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="`${user?.display_name ?? 'Konto'} sperren`"
		description="Die Daten bleiben erhalten – du kannst die Sperre jederzeit aufheben."
		icon="i-lucide-ban"
		icon-color="error"
	>
		<div class="space-y-4">
			<ul class="list-inside list-disc space-y-1 text-sm text-slate-300">
				<li>Anmelden ist nicht mehr möglich.</li>
				<li>Alle Sitzungen, API-Schlüssel und offenen Passwort-Links werden beendet.</li>
				<li>Die Person taucht nicht mehr in Auswahllisten auf.</li>
			</ul>
			<UFormField label="Grund" name="reason" description="Optional, nur für Admins sichtbar.">
				<UTextarea v-model="reason" :rows="3" :maxlength="500" class="w-full" />
			</UFormField>
		</div>

		<template #footer>
			<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
			<UButton label="Konto sperren" icon="i-lucide-ban" color="error" :loading="saving" @click="submit" />
		</template>
	</DashboardModal>
</template>
