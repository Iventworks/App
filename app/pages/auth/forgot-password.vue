<script setup lang="ts">
import * as z from "zod";
import type { FormSubmitEvent, AuthFormField } from "@nuxt/ui";
import { UserStore } from "~/utils/stores/userStore";

const isSignupEnabled = useRuntimeConfig().public.isSignupEnabled;

definePageMeta({
    layout: 'auth'
});

useSeoMeta({
    title: "Forgot Password | LeiOS Hub",
    description: "Reset your password",
});

const toast = useToast();

const fields: AuthFormField[] = [
    {
        name: "email",
        type: "email",
        label: "Email Address",
        placeholder: "Enter your email address",
        required: true,
    },
];

const schema = z.object({
    email: z.email("Invalid email address").trim(),
});

type Schema = z.output<typeof schema>;

async function onSubmit(payload: FormSubmitEvent<Schema>) {

    const result = await useAPI((api) => {
        return api.collection("users").requestPasswordReset(payload.data.email);
    });

    if (result) {

        toast.add({
            title: 'Password Reset Request Successful',
            description: 'If an account with that email exists, a password reset link has been sent.'
        });

        return;

    } else {
        toast.add({
            title: 'Password Reset Failed',
            description: 'An error occurred during password reset.'
        });
    }
}
</script>

<template>
    <UAuthForm
        :schema="schema"
        title="Forgot Password"
        description="Reset your password by entering your email address below."
        icon="i-lucide-mail"
        :fields="fields"
        @submit="onSubmit"
        :submit="{
            label: 'Send Reset Link',
        }"
    >
        <template #footer>
            <div class="text-center text-sm">
                Remembered your password?
                <NuxtLink
                    to="/auth/login"
                    class="text-sky-400 hover:underline"
                >
                    Login here
                </NuxtLink>
            </div>
        </template>
    </UAuthForm>
</template>
