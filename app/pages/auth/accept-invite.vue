<script setup lang="ts">
/**
 * Accept an invitation: the invitee creates their account and is signed in. When the org builds
 * usernames by a schema (`username_schema` of the inspect response), they enter first and last
 * name and see the resulting username (the API appends a number if it is taken); otherwise they
 * pick a username and a display name, as before.
 */
import type { AuthFormField, FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import { UsernameSchema } from "~~/server/lib/utils/usernameSchema";

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

const invitation = ref<{
	email: string;
	display_name: string | null;
	role: string;
	username_schema: string | null;
} | null>(null);
const inspectError = ref<string | null>(null);

if (token) {
	const result = await useAPI((api) => api.postAuthInvitationsInspect({ body: { token } }), true);
	if (result.success) {
		invitation.value = result.data;
	} else {
		inspectError.value = "Diese Einladung ist ungültig, abgelaufen oder wurde bereits verwendet.";
	}
}

/** The org's username schema, or null when the invitee picks their username. */
const usernameSchema = computed(() => invitation.value?.username_schema ?? null);

// Prefill first and last name from the name the admin entered (last word = last name).
const invitedName = (invitation.value?.display_name ?? "").trim().split(/\s+/).filter(Boolean);
const invitedLastName = invitedName.length > 1 ? (invitedName.at(-1) ?? "") : "";
const invitedFirstName =
	invitedName.length > 1 ? invitedName.slice(0, -1).join(" ") : (invitedName[0] ?? "");

const passwordFields: AuthFormField[] = [
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
];

const fields = computed<AuthFormField[]>(() =>
	usernameSchema.value
		? [
				{
					name: "first_name",
					type: "text",
					label: "Vorname",
					placeholder: "Max",
					defaultValue: invitedFirstName,
					required: true,
				},
				{
					name: "last_name",
					type: "text",
					label: "Nachname",
					placeholder: "Mustermann",
					defaultValue: invitedLastName,
					required: true,
				},
				{
					name: "username",
					type: "text",
					label: "Benutzername",
					description:
						"Wird aus deinem Namen gebildet. Ist er schon vergeben, wird eine Zahl angehängt. Lässt sich aus deinem Namen keiner bilden (z. B. in chinesischer Schrift), wählst du ihn selbst.",
				},
				...passwordFields,
			]
		: [
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
				...passwordFields,
			],
);

/** What the API will build from the name (before a number for a taken name). */
function previewUsername(state: FormState) {
	if (!usernameSchema.value) return "";
	return UsernameSchema.generate(
		usernameSchema.value,
		state.first_name ?? "",
		state.last_name ?? "",
	);
}

/** Under a schema: the name is in a script it can't spell (e.g. Chinese), so the invitee picks. */
function choosesUsername(state: FormState) {
	return (
		!!usernameSchema.value &&
		UsernameSchema.needsChosenUsername(
			usernameSchema.value,
			state.first_name ?? "",
			state.last_name ?? "",
		)
	);
}

/** Under a schema the display name is "Vorname Nachname". */
function displayNameOf(state: FormState) {
	return `${state.first_name ?? ""} ${state.last_name ?? ""}`.replace(/\s+/g, " ").trim();
}

/** The form state inside a field slot (UAuthForm types it loosely). */
const slotState = (slotProps: unknown) => (slotProps as { state: FormState }).state;

// Mirrors the backend's `UserDataPolicies`. No `.trim()` on passwords.
const passwordSchema = {
	password: newPasswordField(),
	confirm_password: z.string().min(1, "Bitte bestätige dein Passwort"),
};
const schema = computed(() =>
	usernameSchema.value
		? z.object({
				first_name: z
					.string("Vorname ist erforderlich")
					.trim()
					.min(1, "Vorname ist erforderlich")
					.max(64),
				last_name: z
					.string("Nachname ist erforderlich")
					.trim()
					.min(1, "Nachname ist erforderlich")
					.max(64),
				// Only used when the name gives no username (checked in `validate`).
				username: z.string().trim().optional(),
				...passwordSchema,
			})
		: z.object({
				display_name: z.string("Anzeigename ist erforderlich").trim().min(1).max(64),
				username: usernameField(),
				...passwordSchema,
			}),
);

type FormState = {
	first_name?: string;
	last_name?: string;
	display_name?: string;
	username?: string;
	password?: string;
	confirm_password?: string;
};

function validate(state: FormState): FormError[] {
	const errors: FormError[] = [];
	if (state.password && state.confirm_password && state.password !== state.confirm_password) {
		errors.push({ name: "confirm_password", message: "Passwörter stimmen nicht überein" });
	}
	if (usernameSchema.value && state.first_name?.trim() && state.last_name?.trim()) {
		// The API allows 64 characters for the display name built from both.
		if (displayNameOf(state).length > 64) {
			errors.push({
				name: "last_name",
				message: "Vor- und Nachname dürfen zusammen höchstens 64 Zeichen lang sein.",
			});
		}
		if (choosesUsername(state)) {
			const result = usernameField().safeParse(state.username ?? "");
			for (const issue of result.error?.issues ?? []) {
				errors.push({ name: "username", message: issue.message });
			}
		} else if (!previewUsername(state)) {
			errors.push({
				name: "username",
				message:
					"Aus diesem Namen entsteht kein gültiger Benutzername. Bitte wende dich an das Admin-Team.",
			});
		}
	}
	return errors;
}

const loading = ref(false);

async function onSubmit(payload: FormSubmitEvent<FormState>) {
	if (loading.value) return;
	loading.value = true;

	const data = payload.data;
	const result = await useAPI(
		(api) =>
			api.postAuthInvitationsAccept({
				body: usernameSchema.value
					? {
							token,
							first_name: data.first_name?.trim() ?? "",
							last_name: data.last_name?.trim() ?? "",
							display_name: displayNameOf(data),
							...(choosesUsername(data) ? { username: data.username?.trim() ?? "" } : {}),
							password: data.password ?? "",
						}
					: {
							token,
							username: data.username ?? "",
							display_name: data.display_name ?? "",
							password: data.password ?? "",
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
					? usernameSchema.value && !choosesUsername(data)
						? "Für diese E-Mail-Adresse gibt es schon ein Konto."
						: "Dieser Benutzername ist bereits vergeben."
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
	const userInfo = useUserInfoStore();
	await userInfo.refresh();
	const username = userInfo.peek().value?.username;

	toast.add({
		title: `Willkommen bei ${brandName.value}!`,
		description: username
			? `Dein Konto wurde angelegt. Dein Benutzername zum Anmelden: ${username}`
			: "Dein Konto wurde angelegt.",
		icon: "i-lucide-party-popper",
		color: "success",
		duration: 10_000,
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
		<template v-if="usernameSchema" #username-field="slotProps">
			<UInput
				v-if="choosesUsername(slotState(slotProps))"
				:model-value="slotState(slotProps).username ?? ''"
				placeholder="z. B. wei.wang"
				class="w-full"
				@update:model-value="slotState(slotProps).username = String($event)"
			/>
			<UInput
				v-else
				:model-value="previewUsername(slotState(slotProps))"
				placeholder="ergibt sich aus deinem Namen"
				disabled
				icon="i-lucide-lock"
				class="w-full font-mono"
			/>
		</template>

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
