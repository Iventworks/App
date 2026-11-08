<script setup lang="ts">
import type { AuthFormField, FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

if (!useRuntimeConfig().public.isSignupEnabled) {
	await navigateTo("/auth/login");
}

definePageMeta({
	layout: "auth",
});

useSeoMeta({
	title: "Registrieren | CMP",
	description: "Erstelle ein neues Konto",
});

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
		name: "email",
		type: "email",
		label: "E-Mail-Adresse",
		placeholder: "Geben Sie Ihre E-Mail-Adresse ein",
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
		name: "confirm_password",
		label: "Passwort bestätigen",
		type: "password",
		placeholder: "Geben Sie Ihr Passwort erneut ein",
		required: true,
	},
];

const schema = z.object({
	username: z
		.string("Benutzername ist erforderlich")
		.trim()
		.min(5, "Muss mindestens 5 Zeichen lang sein")
		.max(30, "Darf höchstens 30 Zeichen lang sein")
		.regex(/^[a-zA-Z0-9_]+$/, "Es sind nur alphanumerische Zeichen und Unterstriche erlaubt"),
	email: z.email("Ungültige E-Mail-Adresse").trim(),
	password: z
		.string("Passwort ist erforderlich")
		.trim()
		.min(8, "Muss mindestens 8 Zeichen lang sein")
		.max(50, "Darf höchstens 50 Zeichen lang sein")
		.regex(/[A-Z]/, "Muss mindestens einen Großbuchstaben enthalten")
		.regex(/[a-z]/, "Muss mindestens einen Kleinbuchstaben enthalten")
		.regex(/[0-9]/, "Muss mindestens eine Zahl enthalten")
		.regex(/[\W_]/, "Muss mindestens ein Sonderzeichen enthalten"),
	confirm_password: z
		.string("Passwort bestätigen ist erforderlich")
		.trim()
		.min(1, "Passwort bestätigen ist erforderlich"),
});

type SingupSchema = z.output<typeof schema>;

const formState = reactive<SingupSchema>({
	username: "",
	email: "",
	password: "",
	confirm_password: "",
});

const validate = (state: Partial<SingupSchema>): FormError[] => {
	const errors: FormError[] = [];
	if (state.password && state.confirm_password && state.password !== state.confirm_password) {
		errors.push({
			name: "confirm_password",
			message: "Passwörter stimmen nicht überein",
		});
	}
	return errors;
};

async function onSubmit(payload: FormSubmitEvent<SingupSchema>) {
	// @TODO: Implement signup when backend is implemented
	toast.add({
		title: "Funktion noch nicht implementiert",
		description: "Die Registrierung ist noch nicht implementiert.",
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
        :state="formState"
        :validate="validate"
        title="Registrieren"
        description="Erstellen Sie ein neues Konto, indem Sie die untenstehenden Informationen ausfüllen."
        icon="i-lucide-user"
        :fields="fields"
        @submit="onSubmit"
        :submit="{
            label: 'Sign Up',
        }"
    >
        <template #footer>
            <div class="text-center text-sm">
                Haben Sie bereits ein Konto?
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
