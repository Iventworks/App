<script setup lang="ts">
import type { FormError, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { GetAccountSessionsResponses } from "~/api-client";
import { zPutAccountPasswordBody } from "~/api-client/zod.gen";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Session = GetAccountSessionsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Sicherheit | Einstellungen | CMP",
	description: "Passwort und angemeldete Geräte verwalten",
});

const toast = useToast();

// --- password -------------------------------------------------------------------------------

// The generated body only checks the combined policy regex; spell the rules out for the user.
// Mirrors the backend's `UserDataPolicies.Password`. No `.trim()`: it would change the password.
const passwordSchema = zPutAccountPasswordBody.extend({
	current_password: z.string().min(1, "Aktuelles Passwort ist erforderlich"),
	new_password: z
		.string()
		.min(8, "Muss mindestens 8 Zeichen lang sein")
		.max(50, "Darf höchstens 50 Zeichen lang sein")
		.regex(/[A-Z]/, "Muss mindestens einen Großbuchstaben enthalten")
		.regex(/[a-z]/, "Muss mindestens einen Kleinbuchstaben enthalten")
		.regex(/[0-9]/, "Muss mindestens eine Zahl enthalten")
		.regex(/[\W_]/, "Muss mindestens ein Sonderzeichen enthalten"),
	confirm_password: z.string().min(1, "Bitte bestätige das neue Passwort"),
});
type PasswordSchema = z.output<typeof passwordSchema>;

const passwordState = reactive({
	current_password: "",
	new_password: "",
	confirm_password: "",
});

function validatePassword(state: Partial<PasswordSchema>): FormError[] {
	if (
		state.new_password &&
		state.confirm_password &&
		state.new_password !== state.confirm_password
	) {
		return [{ name: "confirm_password", message: "Passwörter stimmen nicht überein" }];
	}
	return [];
}

const changingPassword = ref(false);

async function clearLocalSession() {
	await useUserInfoStore().clear();
	await useMyEventsStore().clear();
	clearEventDetails();
	useAppCookies().sessionToken.set(null);
}

async function onPasswordSubmit(event: FormSubmitEvent<PasswordSchema>) {
	changingPassword.value = true;
	const result = await useAPI((api) =>
		api.putAccountPassword({
			body: {
				current_password: event.data.current_password,
				new_password: event.data.new_password,
			},
		}),
	);
	changingPassword.value = false;

	if (!result.success) {
		toast.add({
			title: "Passwort konnte nicht geändert werden",
			description:
				(result.code as number) === 400 ? "Das aktuelle Passwort ist falsch." : result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}

	// The API signs out every session, including this one.
	await clearLocalSession();
	toast.add({
		title: "Passwort geändert",
		description: "Bitte melde dich mit deinem neuen Passwort wieder an.",
		icon: "i-lucide-check",
		color: "success",
	});
	await navigateTo("/auth/login");
}

// --- sessions -------------------------------------------------------------------------------

const {
	data: sessions,
	loading: sessionsLoading,
	refresh: refreshSessions,
} = await useAPIAsyncData("account-sessions", async () => {
	const result = await useAPI((api) => api.getAccountSessions({}));
	if (!result.success) {
		toast.add({
			title: "Sitzungen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Session[];
	}
	return result.data;
});

const otherSessions = computed(() => (sessions.value ?? []).filter((s) => !s.is_current));
const revoking = ref<string | null>(null);
const revokingAll = ref(false);

async function revokeSession(session: Session) {
	revoking.value = session.id;
	const result = await useAPI((api) =>
		api.deleteAccountSessionsBySessionId({ path: { sessionId: session.id } }),
	);
	revoking.value = null;

	if (!result.success) {
		toast.add({ title: "Abmelden fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Gerät abgemeldet", icon: "i-lucide-check", color: "success" });
	await refreshSessions();
}

async function revokeOthers() {
	revokingAll.value = true;
	const result = await useAPI((api) => api.deleteAccountSessions({}));
	revokingAll.value = false;

	if (!result.success) {
		toast.add({ title: "Abmelden fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title:
			result.data.revoked === 1
				? "1 anderes Gerät abgemeldet"
				: `${result.data.revoked} andere Geräte abgemeldet`,
		icon: "i-lucide-check",
		color: "success",
	});
	await refreshSessions();
}

const rowClass = "flex max-sm:flex-col justify-between items-start gap-4 py-4 first:pt-0 last:pb-0";
const rowUi = { root: "w-full sm:w-auto", container: "w-full sm:w-auto" };
</script>

<template>
	<UDashboardPanel id="settings-security" :ui="{ body: 'lg:py-12' }">
		<template #header>
			<DashboardPageHeader
				title="Sicherheit"
				icon="i-lucide-shield"
				description="Passwort und angemeldete Geräte"
			/>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<DashboardSectionCard
					title="Passwort ändern"
					description="Danach wirst du auf allen Geräten abgemeldet."
					icon="i-lucide-key-round"
				>
					<UForm
						:schema="passwordSchema"
						:state="passwordState"
						:validate="validatePassword"
						class="divide-y divide-slate-800"
						@submit="onPasswordSubmit"
					>
						<UFormField
							name="current_password"
							label="Aktuelles Passwort"
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput
								v-model="passwordState.current_password"
								type="password"
								autocomplete="current-password"
								class="w-full sm:w-80"
							/>
						</UFormField>

						<UFormField
							name="new_password"
							label="Neues Passwort"
							description="8–50 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen."
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput
								v-model="passwordState.new_password"
								type="password"
								autocomplete="new-password"
								class="w-full sm:w-80"
							/>
						</UFormField>

						<UFormField
							name="confirm_password"
							label="Neues Passwort bestätigen"
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput
								v-model="passwordState.confirm_password"
								type="password"
								autocomplete="new-password"
								class="w-full sm:w-80"
							/>
						</UFormField>

						<div class="pt-4">
							<UButton
								type="submit"
								label="Passwort ändern"
								icon="i-lucide-key-round"
								:loading="changingPassword"
							/>
						</div>
					</UForm>
				</DashboardSectionCard>

				<DashboardSectionCard
					title="Angemeldete Geräte"
					description="Sitzungen laufen nach 7 Tagen ab."
					icon="i-lucide-monitor-smartphone"
					flush
				>
					<template #actions>
						<UButton
							v-if="otherSessions.length"
							label="Alle anderen abmelden"
							icon="i-lucide-log-out"
							color="neutral"
							variant="subtle"
							size="sm"
							:loading="revokingAll"
							@click="revokeOthers"
						/>
					</template>

					<div v-if="sessionsLoading && !sessions" class="flex justify-center py-8">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
					</div>

					<ul v-else class="divide-y divide-slate-800">
						<li
							v-for="session in sessions ?? []"
							:key="session.id"
							class="flex flex-wrap items-center gap-3 px-6 py-4"
						>
							<div class="flex size-9 items-center justify-center rounded-lg bg-slate-800">
								<UIcon
									:name="session.is_current ? 'i-lucide-monitor-check' : 'i-lucide-monitor'"
									class="size-4 text-slate-300"
								/>
							</div>
							<div class="min-w-0 flex-1">
								<p class="flex items-center gap-2 text-sm font-medium text-white">
									Angemeldet {{ formatRelative(session.created_at) }}
									<UBadge
										v-if="session.is_current"
										label="Dieses Gerät"
										color="primary"
										variant="subtle"
										size="sm"
									/>
								</p>
								<p class="text-xs text-slate-500">
									Seit {{ formatDate(session.created_at) }} · läuft ab
									{{ formatDate(session.expires_at) }}
								</p>
							</div>
							<UButton
								v-if="!session.is_current"
								label="Abmelden"
								color="neutral"
								variant="ghost"
								size="sm"
								:loading="revoking === session.id"
								@click="revokeSession(session)"
							/>
						</li>
					</ul>
				</DashboardSectionCard>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
