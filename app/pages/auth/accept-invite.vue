<script setup lang="ts">
import type { AuthFormField, FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({
	layout: "auth",
});

const brandName = useBrandName();
useSeoMeta({
	title: "Einladung annehmen",
	description: () => `Lege dein Konto bei ${brandName.value} an`,
});

const route = useRoute();
const toast = useToast();

// The invitation link is `<org url>/auth/accept-invite?token=…`.
const token = route.query.token?.toString() ?? "";

const invitation = ref<{ email: string; display_name: string | null; role: string } | null>(null);
const inspectError = ref<string | null>(null);

if (token) {
	const result = await useAPI((api) => api.postAuthInvitationsInspect({ body: { token } }), true);
	if (result.success) {
		invitation.value = result.data;
	} else {
		inspectError.value = "Diese Einladung ist ungültig, abgelaufen oder wurde bereits verwendet.";
	}
}

const fields = computed<AuthFormField[]>(() => [
	{
		name: "display_name",
		type: "text",
		label: "Anzeigename",
		placeholder: "Vor- und Nachname",
		defaultValue: invitation.value?.display_name ?? "",
		required: true,
	},
	{
		name: "username",
		type: "text",
		label: "Benutzername",
		placeholder: "z. B. max.muster",
		description: "Kleinbuchstaben, Zahlen, Punkt, Unter- und Bindestrich (mind. 5 Zeichen).",
		required: true,
	},
	{
		name: "password",
		label: "Passwort",
		type: "password",
		placeholder: "Neues Passwort",
		required: true,
	},
	{
		name: "confirm_password",
		label: "Passwort bestätigen",
		type: "password",
		placeholder: "Passwort wiederholen",
		required: true,
	},
]);

// Mirrors the backend's `UserDataPolicies`. No `.trim()` on passwords.
const schema = z.object({
	display_name: z.string("Anzeigename ist erforderlich").trim().min(1).max(64),
	username: usernameField(),
	password: newPasswordField(),
	confirm_password: z.string().min(1, "Bitte bestätige dein Passwort"),
});

type Schema = z.output<typeof schema>;

function validate(state: Partial<Schema>): FormError[] {
	if (state.password && state.confirm_password && state.password !== state.confirm_password) {
		return [{ name: "confirm_password", message: "Passwörter stimmen nicht überein" }];
	}
	return [];
}

const loading = ref(false);

async function onSubmit(payload: FormSubmitEvent<Schema>) {
	if (loading.value) return;
	loading.value = true;

	const result = await useAPI(
		(api) =>
			api.postAuthInvitationsAccept({
				body: {
					token,
					username: payload.data.username,
					display_name: payload.data.display_name,
					password: payload.data.password,
				},
			}),
		true,
	);

	loading.value = false;

	if (!result.success) {
		toast.add({
			title: "Konto konnte nicht angelegt werden",
			description:
				(result.code as number) === 409
					? "Dieser Benutzername ist bereits vergeben."
					: result.message || "Bitte versuche es erneut.",
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}

	updateAPIClient(result.data.token);
	useAppCookies().sessionToken.set(result.data.token);
	await useMyEventsStore().clear();
	clearEventDetails();
	await useUserInfoStore().refresh();

	toast.add({
		title: `Willkommen bei ${brandName.value}!`,
		description: "Dein Konto wurde angelegt.",
		icon: "i-lucide-party-popper",
		color: "success",
	});

	await navigateTo(useInstance().value?.kind === "system" ? "/admin" : "/");
}
</script>

<template>
	<UAuthForm
		v-if="invitation"
		:schema="schema"
		:validate="validate"
		title="Einladung annehmen"
		:description="`Lege dein Konto für ${invitation.email} an (Rolle: ${getRoleLabel(invitation.role)}).`"
		icon="i-lucide-mail-open"
		:fields="fields"
		:submit="{ label: 'Konto anlegen', loading, disabled: loading }"
		@submit="onSubmit"
	>
		<template #footer>
			<div class="text-center text-sm">
				Du hast schon ein Konto?
				<NuxtLink to="/auth/login" class="text-primary hover:underline">Hier anmelden</NuxtLink>
			</div>
		</template>
	</UAuthForm>

	<div v-else class="space-y-4 text-center">
		<div class="flex justify-center">
			<div class="rounded-full bg-red-500/10 p-3">
				<UIcon name="i-lucide-mail-x" class="size-8 text-red-400" />
			</div>
		</div>
		<h2 class="text-xl font-semibold">Einladung nicht gültig</h2>
		<p class="mx-auto max-w-sm text-sm text-slate-400">
			{{ inspectError ?? "Der Einladungslink ist unvollständig. Bitte öffne den Link aus der E-Mail erneut." }}
			Bitte wende dich an das Admin-Team, um eine neue Einladung zu erhalten.
		</p>
		<NuxtLink to="/auth/login" class="text-sm text-primary hover:underline">Zur Anmeldung</NuxtLink>
	</div>
</template>
