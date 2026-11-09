<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({
	layout: "auth",
});

const brandName = useBrandName();
useSeoMeta({
	title: "Anmelden",
	description: () => `Bei ${brandName.value} anmelden`,
});

const route = useRoute();
const toast = useToast();

// Only follow internal redirects (`/…`, not protocol-relative `//evil.example`).
const requestedUrl = route.query.url?.toString() ?? "";
const redirectUrl =
	requestedUrl.startsWith("/") && !requestedUrl.startsWith("//")
		? requestedUrl
		: useInstance().value?.kind === "system"
			? "/admin"
			: "/";

const fields: AuthFormField[] = [
	{
		name: "username",
		type: "text",
		label: "Benutzername",
		placeholder: "Dein Benutzername",
		required: true,
	},
	{
		name: "password",
		label: "Passwort",
		type: "password",
		placeholder: "Dein Passwort",
		required: true,
	},
	{
		name: "remember",
		label: "Angemeldet bleiben",
		type: "checkbox",
		description: "Du bleibst auf diesem Gerät bis zu 7 Tage angemeldet.",
	},
];

const schema = z.object({
	username: z.string("Benutzername ist erforderlich").trim().min(1, "Benutzername ist erforderlich"),
	// No `.trim()`: it would silently change the password.
	password: z.string("Passwort ist erforderlich").min(1, "Passwort ist erforderlich"),
	remember: z.boolean().optional(),
});

type Schema = z.output<typeof schema>;

const loading = ref(false);

async function onSubmit(payload: FormSubmitEvent<Schema>) {
	if (loading.value) return;
	loading.value = true;

	// `true`: the user is signed out here, so useAPI must not bounce them to the login page.
	const result = await useAPI(
		(api) =>
			api.postAuthLogin({
				body: { username: payload.data.username, password: payload.data.password },
			}),
		true,
	);

	loading.value = false;

	if (!result.success) {
		const code = result.code as number;
		toast.add({
			title:
				code === 401
					? "Benutzername oder Passwort falsch"
					: code === 403
						? "Konto gesperrt"
						: code === 429
							? "Zu viele Versuche"
							: "Anmeldung fehlgeschlagen",
			description:
				code === 401
					? "Bitte prüfe deine Eingaben und versuche es erneut."
					: code === 403
						? "Dein Konto wurde von einer Admin-Person gesperrt. Wende dich an das Kernteam."
						: result.message || "Bitte versuche es später erneut.",
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}

	updateAPIClient(result.data.token);
	useAppCookies().sessionToken.set(result.data.token, {
		// The server session lives 7 days; without "remember me" the cookie ends with the browser.
		maxAge: payload.data.remember ? 60 * 60 * 24 * 7 : undefined,
	});

	// Fresh per-user state for the new session.
	await useMyEventsStore().clear();
	clearEventDetails();
	await useUserInfoStore().refresh();

	toast.add({
		title: "Willkommen zurück!",
		icon: "i-lucide-check",
		color: "success",
	});

	await navigateTo(redirectUrl);
}
</script>

<template>
	<UAuthForm
		:schema="schema"
		title="Anmelden"
		:description="`Melde dich mit deinem Konto bei ${brandName} an.`"
		icon="i-lucide-log-in"
		:fields="fields"
		:submit="{ label: 'Anmelden', loading, disabled: loading }"
		@submit="onSubmit"
	>
		<template #footer>
			<div class="text-center text-sm">
				Passwort vergessen?
				<NuxtLink to="/auth/forgot-password" class="text-primary hover:underline">
					Hier zurücksetzen
				</NuxtLink>
			</div>
			<p class="mt-2 text-center text-sm text-slate-400">
				Noch kein Konto? Konten werden vom Admin-Team per Einladung angelegt.
			</p>
		</template>
	</UAuthForm>
</template>
