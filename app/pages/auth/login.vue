<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

const isSignupEnabled = useRuntimeConfig().public.isSignupEnabled;

definePageMeta({
	layout: "auth",
});

useSeoMeta({
	title: "Login | CMP",
	description: "Loggen Sie sich ins CMP-Dashboard ein",
});

const route = useRoute();
let redirectUrl = route.query.url?.toString() || "/";

// Only follow internal paths (`/…`, not protocol-relative `//evil.example`)
if (!redirectUrl.startsWith("/") || redirectUrl.startsWith("//")) {
	redirectUrl = "/";
}

const toast = useToast();

const fields: AuthFormField[] = [
	{
		name: "username",
		type: "text",
		label: "Benutzername",
		placeholder: "Geben Sie Ihren Benutzernamen ein",
		required: true,
	},
	{
		name: "password",
		label: "Passwort",
		type: "password",
		placeholder: "Geben Sie Ihr Passwort ein",
		required: true,
	},
	{
		name: "remember",
		label: "Angemeldet bleiben",
		type: "checkbox",
		description: "Sie bleiben 30 Tage lang angemeldet.",
	},
];

const schema = z.object({
	username: z.string("Benutzername ist erforderlich").trim().min(1, "Benutzername ist erforderlich"),
	password: z.string("Passwort ist erforderlich").trim().min(1, "Passwort ist erforderlich"),
	remember: z.boolean().optional(),
});

type Schema = z.output<typeof schema>;

async function onSubmit(payload: FormSubmitEvent<Schema>) {
	const result = await useAPI((api) => {
		return api.postAuthLogin({ body: payload.data });
	});

	if (result.success) {
		updateAPIClient(result.data.token);

		useAppCookies().sessionToken.set(result.data.token, {
			maxAge: payload.data.remember ? 60 * 60 * 24 * 30 : undefined, // 30 days only with "remember me"
		});

		await useUserInfoStore().refresh();

		toast.add({
			title: "Login erfolgreich",
			description: "Sie haben sich erfolgreich eingeloggt.",
		});

		await navigateTo(redirectUrl.toString());
		return;
	} else {
		if ((result.code as number) === 401) {
			toast.add({
				title: "Ungültiger Benutzername oder Passwort",
				description: "Bitte überprüfen Sie Ihre Anmeldedaten und versuchen Sie es erneut.",
				icon: "i-lucide-alert-circle",
				color: "error",
			});
		} else {
			toast.add({
				title: "Login fehlgeschlagen",
				description:
					result.message ||
					"Beim Login ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.",
				icon: "i-lucide-alert-circle",
				color: "error",
			});
		}
	}
}
</script>

<template>
    <UAuthForm
        :schema="schema"
        title="Login"
        description="Geben Sie Ihre Anmeldedaten ein, um auf Ihr Konto zuzugreifen."
        icon="i-lucide-user"
        :fields="fields"
        @submit="onSubmit"
        :submit="{
            label: 'Login',
        }"
    >
        <template #footer>
            <div class="text-center text-sm">
                Passwort vergessen?
                <NuxtLink
                    to="/auth/forgot-password"
                    class="text-sky-400 hover:underline"
                >
                    Hier zurücksetzen
                </NuxtLink>
            </div>
            <div v-if="isSignupEnabled" class="text-center text-sm mt-2">
                Haben Sie noch kein Konto?
                <NuxtLink
                    to="/auth/signup"
                    class="text-sky-400 hover:underline"
                >
                    Hier registrieren
                </NuxtLink>
            </div>
        </template>
    </UAuthForm>
</template>
