<script setup lang="ts">
/**
 * Create an account directly (the alternative to an email invitation). The admin either sets the
 * first password or lets the API create a one-time link to hand over. On the system host the
 * account is a system admin: no role to choose (always admin).
 */
import type { FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { AdminUser, PasswordLink } from "~/utils/types";

const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ created: [user: AdminUser, link: PasswordLink | null] }>();

const toast = useToast();
const saving = ref(false);
const isSystem = computed(() => useInstance().value?.kind === "system");

const schema = z
	.object({
		display_name: z.string().trim().min(1).max(64),
		username: usernameField(),
		email: z.email("Ungültige E-Mail-Adresse"),
		phone: z.string().trim().max(40),
		role: z.enum(["admin", "core_team", "volunteer", "unverified"]),
		password_mode: z.enum(["link", "password"]),
		password: z.string(),
		confirm_password: z.string(),
	})
	.superRefine((data, ctx) => {
		if (data.password_mode !== "password") return;
		const result = newPasswordField().safeParse(data.password);
		for (const issue of result.error?.issues ?? []) {
			ctx.addIssue({ code: "custom", path: ["password"], message: issue.message });
		}
	});
type Schema = z.output<typeof schema>;

const emptyState = (): Schema => ({
	display_name: "",
	username: "",
	email: "",
	phone: "",
	role: isSystem.value ? "admin" : "volunteer",
	password_mode: "link",
	password: "",
	confirm_password: "",
});
const state = reactive<Schema>(emptyState());

watch(open, (value) => {
	if (value) Object.assign(state, emptyState());
});

// Suggest a username from the display name until the admin edits it.
const usernameTouched = ref(false);
watch(
	() => state.display_name,
	(name) => {
		if (usernameTouched.value) return;
		state.username = name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/ß/g, "ss")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, ".")
			.replace(/^\.+|\.+$/g, "")
			.slice(0, 40);
	},
);
watch(open, () => {
	usernameTouched.value = false;
});

function validate(data: Partial<Schema>): FormError[] {
	if (data.password_mode === "password" && data.password !== data.confirm_password) {
		return [{ name: "confirm_password", message: "Passwörter stimmen nicht überein" }];
	}
	return [];
}

const passwordModes = [
	{
		value: "link",
		label: "Einrichtungs-Link erstellen",
		description:
			"Du bekommst einen Link (7 Tage gültig), mit dem die Person ihr Passwort selbst wählt.",
	},
	{
		value: "password",
		label: "Passwort jetzt festlegen",
		description: "Das Konto kann sich sofort anmelden. Gib das Passwort sicher weiter.",
	},
];

async function submit(event: FormSubmitEvent<Schema>) {
	saving.value = true;
	const { password_mode, password, confirm_password: _, phone, ...rest } = event.data;
	const result = await useAPI((api) =>
		api.postAdminUsers({
			body: {
				...rest,
				phone: phone || null,
				...(password_mode === "password" ? { password } : {}),
			},
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({
			title: "Konto konnte nicht angelegt werden",
			description:
				(result.code as number) === 409
					? "Benutzername oder E-Mail-Adresse ist bereits vergeben."
					: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}

	toast.add({
		title: `${result.data.user.display_name} angelegt`,
		icon: "i-lucide-check",
		color: "success",
	});
	open.value = false;
	emit("created", result.data.user, result.data.password_link);
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="isSystem ? 'System-Admin anlegen' : 'Benutzer anlegen'"
		:description="
			isSystem
				? 'Das Konto kann sich hier anmelden und alle Organisationen verwalten.'
				: 'Das Konto ist sofort da – ohne Einladung per E-Mail.'
		"
		icon="i-lucide-user-plus"
	>
		<UForm :schema="schema" :state="state" :validate="validate" class="space-y-4" @submit="submit">
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Anzeigename" name="display_name" required>
					<UInput v-model="state.display_name" placeholder="Lea Leiterin" class="w-full" autofocus />
				</UFormField>
				<UFormField label="Benutzername" name="username" required>
					<UInput
						v-model="state.username"
						placeholder="lea.leiterin"
						class="w-full"
						@update:model-value="usernameTouched = true"
					/>
				</UFormField>
				<UFormField label="E-Mail" name="email" required>
					<UInput v-model="state.email" type="email" class="w-full" />
				</UFormField>
				<UFormField label="Telefon" name="phone">
					<UInput v-model="state.phone" type="tel" class="w-full" />
				</UFormField>
				<UFormField v-if="!isSystem" label="Rolle" name="role" class="sm:col-span-2">
					<USelect v-model="state.role" :items="ORG_ROLE_OPTIONS" value-key="value" class="w-full" />
				</UFormField>
			</div>

			<UFormField label="Passwort" name="password_mode">
				<URadioGroup v-model="state.password_mode" :items="passwordModes" value-key="value" variant="card" />
			</UFormField>

			<div v-if="state.password_mode === 'password'" class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Passwort" name="password" :description="PASSWORD_HINT" required>
					<UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
				</UFormField>
				<UFormField label="Passwort bestätigen" name="confirm_password" required>
					<UInput v-model="state.confirm_password" type="password" autocomplete="new-password" class="w-full" />
				</UFormField>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton type="submit" label="Konto anlegen" icon="i-lucide-user-plus" :loading="saving" />
			</div>
		</UForm>
	</DashboardModal>
</template>
