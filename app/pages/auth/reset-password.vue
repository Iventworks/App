<script setup lang="ts">
import type { AuthFormField, FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

definePageMeta({
	layout: "auth",
});

useSeoMeta({
	title: "Passwort zurücksetzen | CMP",
	description: "Setzen Sie Ihr Passwort zurück",
});

const route = useRoute();
const toast = useToast();

// The emailed link is `{APP_URL}/auth/reset-password?token=…` (see docs/10-auth.md).
const resetToken = route.query.token?.toString() ?? "";

const fields: AuthFormField[] = [
	{
		name: "password",
		label: "Neues Passwort",
		type: "password",
		placeholder: "Geben Sie ein neues Passwort ein",
		required: true,
	},
	{
		name: "confirm_password",
		label: "Neues Passwort bestätigen",
		type: "password",
		placeholder: "Geben Sie Ihr neues Passwort erneut ein",
		required: true,
	},
];

// Mirrors the backend's `UserDataPolicies.Password`. No `.trim()`: it would silently change the password.
const schema = z.object({
	password: z
		.string("Passwort ist erforderlich")
		.min(8, "Muss mindestens 8 Zeichen lang sein")
		.max(50, "Darf höchstens 50 Zeichen lang sein")
		.regex(/[A-Z]/, "Muss mindestens einen Großbuchstaben enthalten")
		.regex(/[a-z]/, "Muss mindestens einen Kleinbuchstaben enthalten")
		.regex(/[0-9]/, "Muss mindestens eine Zahl enthalten")
		.regex(/[\W_]/, "Muss mindestens ein Sonderzeichen enthalten"),
	confirm_password: z
		.string("Passwort bestätigen ist erforderlich")
		.min(1, "Passwort bestätigen ist erforderlich"),
});

type Schema = z.output<typeof schema>;

function validate(state: Partial<Schema>): FormError[] {
	const errors: FormError[] = [];
	if (state.password && state.confirm_password && state.password !== state.confirm_password) {
		errors.push({ name: "confirm_password", message: "Passwörter stimmen nicht überein" });
	}
	return errors;
}

const loading = ref(false);

async function onSubmit(payload: FormSubmitEvent<Schema>) {
	if (loading.value) return;
	loading.value = true;

	// `true`: the user is signed out here, so useAPI must not bounce them to the login page.
	const result = await useAPI(
		(api) =>
			api.postAuthResetPassword({
				body: {
					reset_token: resetToken,
					new_password: payload.data.password,
				},
			}),
		true,
	);

	loading.value = false;

	if (result.success) {
		toast.add({
			title: "Passwort zurückgesetzt",
			description: "Ihr Passwort wurde zurückgesetzt. Sie können sich jetzt einloggen.",
			icon: "i-lucide-check",
			color: "success",
		});
		await navigateTo("/auth/login");
	} else {
		toast.add({
			title: "Zurücksetzen fehlgeschlagen",
			description: result.message || "Der Link ist möglicherweise ungültig oder abgelaufen.",
			icon: "i-lucide-alert-circle",
			color: "error",
		});
	}
}
</script>

<template>
	<UAuthForm
		v-if="resetToken"
		:schema="schema"
		:validate="validate"
		title="Passwort zurücksetzen"
		description="Geben Sie unten Ihr neues Passwort ein."
		icon="i-lucide-key-round"
		:fields="fields"
		:submit="{ label: 'Passwort zurücksetzen', loading, disabled: loading }"
		@submit="onSubmit"
	>
		<template #footer>
			<div class="text-center text-sm">
				Passwort wieder eingefallen?
				<NuxtLink to="/auth/login" class="text-primary hover:underline">Hier einloggen</NuxtLink>
			</div>
		</template>
	</UAuthForm>

	<div v-else class="space-y-4 text-center">
		<p>
			Ungültiger oder fehlender Link. Bitte prüfen Sie den Link aus der E-Mail oder fordern Sie
			einen neuen an.
		</p>
		<NuxtLink to="/auth/forgot-password" class="text-primary hover:underline">
			Neuen Link anfordern
		</NuxtLink>
	</div>
</template>
