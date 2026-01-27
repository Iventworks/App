<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField, FormError } from "@nuxt/ui";

definePageMeta({
    layout: 'auth'
});

useSeoMeta({
    title: "Passwort zurücksetzen | CMP",
    description: "Setzen Sie Ihr Passwort zurück",
});

const route = useRoute();
const reset_token = route.query.token as string || '';

const toast = useToast();

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

const schema = z.object({
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

type NewPasswordSchema = z.output<typeof schema>;

const formState = reactive<NewPasswordSchema>({
    password: "",
    confirm_password: "",
});

const validate = (state: Partial<NewPasswordSchema>): FormError[] => {
    const errors: FormError[] = [];
    if (
        state.password &&
        state.confirm_password &&
        state.password !== state.confirm_password
    ) {
        errors.push({
            name: "confirm_password",
            message: "Passwörter stimmen nicht überein",
        });
    }
    return errors;
};
async function onSubmit(payload: FormSubmitEvent<NewPasswordSchema>) {

    const result = await useAPI((api) => {
        return api.postAuthResetPassword({
            body: {
                reset_token,
                new_password: payload.data.password,
            }
        });
    });


    if (result.success) {

        toast.add({
            title: 'Passwort erfolgreich zurückgesetzt',
            description: 'Ihr Passwort wurde erfolgreich zurückgesetzt.'
        });

        await navigateTo("/auth/login");
        return;

    } else {
        toast.add({
            title: 'Passwort zurücksetzen fehlgeschlagen',
            description: 'Beim Zurücksetzen des Passworts ist ein Fehler aufgetreten.'
        });
    }
}
</script>

<template>
    <template v-if="reset_token">
        <UAuthForm
            :schema="schema"
            title="Passwort zurücksetzen"
            description="Setzen Sie Ihr Passwort zurück, indem Sie unten Ihre E-Mail-Adresse eingeben."
            icon="i-lucide-mail"
            :fields="fields"
            @submit="onSubmit"
            :submit="{
                label: 'Passwort zurücksetzen',
            }"
        >
            <template #footer>
                <div class="text-center text-sm">
                    Haben Sie Ihr Passwort erinnert?
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
    <template v-else>
        <div class="text-center h-12 mb-4">
            Ungültiges oder fehlendes Zurücksetzungs-Token. Bitte überprüfen Sie Ihren Zurücksetzungslink oder
            fordern Sie eine neue Passwortzurücksetzung an.
        </div>
        <NuxtLink
            to="/auth/forgot-password"
            class="text-sky-400 hover:underline text-center"
        >
            Fordern Sie eine neue Passwortzurücksetzung an
        </NuxtLink>
    </template>
</template>
