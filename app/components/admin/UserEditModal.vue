<script setup lang="ts">
/** Edit an account's profile fields and organisation role (system admins have no role to change). */
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { AdminUser } from "~/utils/types";

const props = defineProps<{ user: AdminUser | null }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const currentUser = await useUserInfoStore().use();
const isSelf = computed(() => props.user?.id === currentUser.value?.id);
const isSystem = computed(() => useInstance().value?.kind === "system");

const schema = z.object({
	username: usernameField(),
	display_name: z.string().trim().min(1).max(64),
	email: z.email("Ungültige E-Mail-Adresse"),
	phone: z.string().trim().max(40),
	role: z.enum(["admin", "core_team", "volunteer", "unverified"]),
});
type Schema = z.output<typeof schema>;

const state = reactive<Schema>({
	username: "",
	display_name: "",
	email: "",
	phone: "",
	role: "volunteer",
});
const saving = ref(false);

watch(open, (value) => {
	if (!value || !props.user) return;
	Object.assign(state, {
		username: props.user.username,
		display_name: props.user.display_name,
		email: props.user.email,
		phone: props.user.phone ?? "",
		role: props.user.role,
	});
});

async function submit(event: FormSubmitEvent<Schema>) {
	const target = props.user;
	if (!target) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.putAdminUsersByUserId({
			path: { userId: target.id },
			body: {
				username: event.data.username,
				display_name: event.data.display_name,
				email: event.data.email,
				phone: event.data.phone || null,
				// The API refuses removing your own admin role; don't send it at all. System admins
				// are always admins.
				...(isSelf.value || isSystem.value ? {} : { role: event.data.role }),
			},
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({
			title: "Speichern fehlgeschlagen",
			description:
				(result.code as number) === 409
					? "Benutzername oder E-Mail-Adresse ist bereits vergeben."
					: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}
	toast.add({ title: "Benutzer gespeichert", icon: "i-lucide-check", color: "success" });
	open.value = false;
	emit("saved");
}
</script>

<template>
	<DashboardModal v-model:open="open" :title="`${user?.display_name ?? 'Benutzer'} bearbeiten`" icon="i-lucide-pencil">
		<UForm :schema="schema" :state="state" class="space-y-4" @submit="submit">
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Anzeigename" name="display_name" required>
					<UInput v-model="state.display_name" class="w-full" />
				</UFormField>
				<UFormField label="Benutzername" name="username" required>
					<UInput v-model="state.username" class="w-full" />
				</UFormField>
				<UFormField label="E-Mail" name="email" required>
					<UInput v-model="state.email" type="email" class="w-full" />
				</UFormField>
				<UFormField label="Telefon" name="phone">
					<UInput v-model="state.phone" type="tel" class="w-full" />
				</UFormField>
				<UFormField
					v-if="!isSystem"
					label="Rolle"
					name="role"
					class="sm:col-span-2"
					:help="isSelf ? 'Deine eigene Rolle kannst du nicht ändern.' : undefined"
				>
					<USelect v-model="state.role" :items="ORG_ROLE_OPTIONS" value-key="value" :disabled="isSelf" class="w-full" />
				</UFormField>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton type="submit" label="Speichern" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>
</template>
