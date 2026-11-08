<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

const isSignupEnabled = useRuntimeConfig().public.isSignupEnabled;

definePageMeta({
	layout: "auth",
});

useSeoMeta({
	title: "Passwort vergessen | CMP",
	description: "Setzen Sie Ihr Passwort zurück",
});

const toast = useToast();

const fields: AuthFormField[] = [
	{
		name: "email",
		type: "email",
		label: "E-Mail-Adresse",
		placeholder: "Geben Sie Ihre E-Mail-Adresse ein",
		required: true,
	},
];

const schema = z.object({
	email: z.email("Ungültige E-Mail-Adresse").trim(),
});

type Schema = z.output<typeof schema>;

async function onSubmit(payload: FormSubmitEvent<Schema>) {
	// @TODO: Implement forgot password when backend is implemented
	toast.add({
		title: "Funktion nicht implementiert",
		description: "Die Funktion zum Zurücksetzen des Passworts ist noch nicht implementiert.",
	});

	// const result = await useAPI().postAuthLogin({ body: payload.data });

	// if (result.success) {

	//     updateAPIClient(result.data.token);

	//     const sessionToken = useCookie("cmp_session_token", {
	//         path:     '/',
	//         secure:   true,
	//         sameSite: 'strict',
	//         httpOnly: false,
	//         maxAge:   604800,
	//     });

	//     sessionToken.value = result.data.token;

	//     await useUserInfoStore().refreshIfNeeded();

	//     toast.add({
	//         title: 'Login Successful',
	//         description: 'You have been logged in successfully.'
	//     });

	//     await navigateTo(redirectUrl.toString());
	//     return;

	// } else {
	//     toast.add({
	//         title: 'Login Failed',
	//         description: 'An error occurred during login.'
	//     });
	// }
}
</script>

<template>
    <UAuthForm
        :schema="schema"
        title="Passwort vergessen"
        description="Setzen Sie Ihr Passwort zurück, indem Sie unten Ihre E-Mail-Adresse eingeben."
        icon="i-lucide-mail"
        :fields="fields"
        @submit="onSubmit"
        :submit="{
            label: 'Send Reset Link',
        }"
    >
        <template #footer>
            <div class="text-center text-sm">
                Passwort erinnert?
                <NuxtLink
                    to="/auth/login"
                    class="text-sky-400 hover:underline"
                >
                    Hier einloggen
                </NuxtLink>
            </div>
        </template>
    </UAuthForm>
</template>
