<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";

definePageMeta({
	layout: "auth",
});

useSeoMeta({
	title: "Passwort vergessen | CMP",
	description: "Setze dein Passwort zurück",
});

const toast = useToast();

const fields: AuthFormField[] = [
	{
		name: "email",
		type: "email",
		label: "E-Mail-Adresse",
		placeholder: "Deine E-Mail-Adresse",
		required: true,
	},
];

const schema = z.object({
	email: z.email("Ungültige E-Mail-Adresse").trim(),
});

type Schema = z.output<typeof schema>;

const submitted = ref(false);
const loading = ref(false);

async function onSubmit(payload: FormSubmitEvent<Schema>) {
	if (loading.value) return;
	loading.value = true;

	// `true`: the user is signed out here, so useAPI must not bounce them to the login page.
	const result = await useAPI(
		(api) => api.postAuthResetPasswordRequest({ body: payload.data }),
		true,
	);

	loading.value = false;

	if (result.success) {
		submitted.value = true;
	} else {
		toast.add({
			title: "Anfrage fehlgeschlagen",
			description: result.message || "Ein Fehler ist aufgetreten. Bitte versuche es später erneut.",
			icon: "i-lucide-alert-circle",
			color: "error",
		});
	}
}
</script>

<template>
	<UAuthForm
		v-if="!submitted"
		:schema="schema"
		title="Passwort vergessen"
		description="Gib deine E-Mail-Adresse ein. Wir senden dir einen Link zum Zurücksetzen deines Passworts."
		icon="i-lucide-mail"
		:fields="fields"
		:submit="{ label: 'Link senden', loading, disabled: loading }"
		@submit="onSubmit"
	>
		<template #footer>
			<div class="text-center text-sm">
				Passwort wieder eingefallen?
				<NuxtLink to="/auth/login" class="text-primary hover:underline">Hier anmelden</NuxtLink>
			</div>
		</template>
	</UAuthForm>

	<div v-else class="space-y-4 text-center">
		<div class="flex justify-center">
			<div class="rounded-full bg-primary/10 p-3">
				<UIcon name="i-lucide-mail-check" class="size-8 text-primary" />
			</div>
		</div>
		<h2 class="text-xl font-semibold">Prüfe dein Postfach</h2>
		<p class="mx-auto max-w-sm text-sm text-slate-400">
			Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir dir einen Link zum
			Zurücksetzen deines Passworts gesendet.
		</p>
		<p class="text-xs text-slate-400">
			Keine E-Mail erhalten?
			<button type="button" class="text-primary hover:underline" @click="submitted = false">
				Erneut versuchen
			</button>
		</p>
		<div class="pt-4">
			<NuxtLink to="/auth/login" class="text-sm text-primary hover:underline">Zurück zur Anmeldung</NuxtLink>
		</div>
	</div>
</template>
