<script setup lang="ts">
/** Set a new password for someone; the API signs them out everywhere. */
import type { FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { AdminUser } from "~/utils/types";

const props = defineProps<{ user: AdminUser | null }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();

const schema = z.object({
	password: newPasswordField(),
	confirm_password: z.string().min(1, "Bitte bestätige das Passwort"),
});
type Schema = z.output<typeof schema>;

const state = reactive({ password: "", confirm_password: "" });
const saving = ref(false);

watch(open, (value) => {
	if (value) Object.assign(state, { password: "", confirm_password: "" });
});

function validate(data: Partial<Schema>): FormError[] {
	if (data.password && data.confirm_password && data.password !== data.confirm_password) {
		return [{ name: "confirm_password", message: "Passwörter stimmen nicht überein" }];
	}
	return [];
}

async function submit(event: FormSubmitEvent<Schema>) {
	const target = props.user;
	if (!target) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.putAdminUsersByUserIdPassword({
			path: { userId: target.id },
			body: { password: event.data.password },
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({
			title: "Passwort konnte nicht gesetzt werden",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}
	toast.add({
		title: "Passwort gesetzt",
		description: `${target.display_name} wurde auf allen Geräten abgemeldet.`,
		icon: "i-lucide-check",
		color: "success",
	});
	open.value = false;
	emit("saved");
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="`Passwort für ${user?.display_name ?? ''} setzen`"
		icon="i-lucide-key-round"
		icon-color="amber"
		description="Die Person wird auf allen Geräten abgemeldet."
	>
		<UForm :schema="schema" :state="state" :validate="validate" class="space-y-4" @submit="submit">
			<UFormField label="Neues Passwort" name="password" :description="PASSWORD_HINT" required>
				<UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
			</UFormField>
			<UFormField label="Passwort bestätigen" name="confirm_password" required>
				<UInput v-model="state.confirm_password" type="password" autocomplete="new-password" class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton type="submit" label="Passwort setzen" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>
</template>
