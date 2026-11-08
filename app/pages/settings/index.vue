<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import type * as z from "zod";
import { zPutAccountBody } from "~/api-client/zod.gen";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Profil | Einstellungen | CMP",
	description: "Verwalte dein Profil",
});

const toast = useToast();
const userInfoStore = useUserInfoStore();
const userInfo = await userInfoStore.use();

if (!userInfoStore.isValid(userInfo)) {
	throw createError({ statusCode: 401, statusMessage: "Nicht angemeldet", fatal: true });
}

// The API requires the current password for every profile change (docs/10).
const profileSchema = zPutAccountBody;
type ProfileSchema = z.output<typeof profileSchema>;

const profile = reactive({
	display_name: userInfo.value.display_name,
	username: userInfo.value.username,
	email: userInfo.value.email,
	phone: userInfo.value.phone ?? "",
	current_password: "",
});

const saving = ref(false);

async function onSubmit(event: FormSubmitEvent<ProfileSchema>) {
	saving.value = true;
	const phone = event.data.phone?.trim() || null;

	const result = await useAPI((api) =>
		api.putAccount({
			body: {
				display_name: event.data.display_name,
				username: event.data.username,
				email: event.data.email,
				phone,
				current_password: event.data.current_password,
			},
		}),
	);
	saving.value = false;

	if (!result.success) {
		const code = result.code as number;
		toast.add({
			title: "Profil konnte nicht gespeichert werden",
			description:
				code === 400
					? "Das aktuelle Passwort ist falsch."
					: code === 409
						? "Benutzername oder E-Mail-Adresse ist bereits vergeben."
						: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}

	await userInfoStore.update({
		display_name: event.data.display_name,
		username: event.data.username,
		email: event.data.email,
		phone,
	});
	profile.current_password = "";

	toast.add({
		title: "Profil gespeichert",
		icon: "i-lucide-check",
		color: "success",
	});
}

// --- delete account -------------------------------------------------------------------------

const deleteOpen = ref(false);

async function deleteAccount() {
	const result = await useAPI((api) => api.deleteAccount({}));
	if (!result.success) {
		toast.add({
			title: "Konto konnte nicht gelöscht werden",
			description: result.message,
			color: "error",
		});
		throw new Error(result.message);
	}

	await userInfoStore.clear();
	await useMyEventsStore().clear();
	clearEventDetails();
	useLastEventCookie().value = null;
	useAppCookies().sessionToken.set(null);

	toast.add({ title: "Dein Konto wurde gelöscht", icon: "i-lucide-check", color: "success" });
	await navigateTo("/auth/login");
}

const rowClass = "flex max-sm:flex-col justify-between items-start gap-4 py-4 first:pt-0 last:pb-0";
const rowUi = { root: "w-full sm:w-auto", container: "w-full sm:w-auto" };
</script>

<template>
	<UDashboardPanel id="settings-profile" :ui="{ body: 'lg:py-12' }">
		<template #header>
			<DashboardPageHeader
				title="Profil"
				icon="i-lucide-user"
				description="Deine persönlichen Angaben"
			/>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<DashboardSectionCard
					title="Profilinformationen"
					description="So sehen dich andere in Teams, Chats und Listen."
					icon="i-lucide-id-card"
				>
					<UForm
						id="profile"
						:schema="profileSchema"
						:state="profile"
						class="divide-y divide-slate-800"
						@submit="onSubmit"
					>
						<UFormField
							name="display_name"
							label="Anzeigename"
							description="Dein Vor- und Nachname."
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput v-model="profile.display_name" class="w-full sm:w-80" />
						</UFormField>

						<UFormField
							name="username"
							label="Benutzername"
							description="Zum Anmelden. Kleinbuchstaben, Zahlen, Punkt, Unter- und Bindestrich."
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput v-model="profile.username" class="w-full sm:w-80" />
						</UFormField>

						<UFormField
							name="email"
							label="E-Mail-Adresse"
							description="Für Benachrichtigungen und das Zurücksetzen deines Passworts."
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput v-model="profile.email" type="email" class="w-full sm:w-80" />
						</UFormField>

						<UFormField
							name="phone"
							label="Telefon"
							description="Für Rückfragen im Team, z. B. während einer Freizeit."
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput
								v-model="profile.phone"
								type="tel"
								placeholder="+49 …"
								class="w-full sm:w-80"
							/>
						</UFormField>

						<UFormField
							name="current_password"
							label="Aktuelles Passwort"
							description="Zur Bestätigung deiner Änderungen."
							required
							:class="rowClass"
							:ui="rowUi"
						>
							<UInput
								v-model="profile.current_password"
								type="password"
								autocomplete="current-password"
								class="w-full sm:w-80"
							/>
						</UFormField>

						<div class="pt-4">
							<UButton
								type="submit"
								label="Änderungen speichern"
								icon="i-lucide-save"
								:loading="saving"
							/>
						</div>
					</UForm>
				</DashboardSectionCard>

				<DashboardSectionCard title="Konto" icon="i-lucide-badge-info">
					<div class="flex flex-wrap items-center gap-4">
						<UAvatar :text="initials(userInfo.display_name)" size="xl" />
						<div class="min-w-0 flex-1">
							<p class="font-medium text-white">{{ userInfo.display_name }}</p>
							<p class="text-sm text-slate-400">@{{ userInfo.username }}</p>
							<p class="text-xs text-slate-500">Dabei seit {{ formatDay(userInfo.created_at) }}</p>
						</div>
						<UBadge
							:label="getRoleLabel(userInfo.role)"
							:color="getRoleColor(userInfo.role)"
							variant="subtle"
						/>
					</div>
				</DashboardSectionCard>

				<DashboardSectionCard
					title="Gefahrenzone"
					description="Diese Aktionen können nicht rückgängig gemacht werden."
					icon="i-lucide-triangle-alert"
					tone="danger"
				>
					<div class="flex max-sm:flex-col items-start justify-between gap-4">
						<div>
							<p class="font-medium text-white">Konto löschen</p>
							<p class="text-sm text-slate-400">
								Dein Konto, deine persönlichen Aufgaben, Notizen und Kalendereinträge werden
								dauerhaft gelöscht.
							</p>
						</div>
						<UButton
							label="Konto löschen"
							icon="i-lucide-trash-2"
							color="error"
							variant="subtle"
							@click="deleteOpen = true"
						/>
					</div>
				</DashboardSectionCard>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Konto löschen"
		warning-text="Dein Konto und alle persönlichen Daten werden dauerhaft gelöscht. Du wirst abgemeldet."
		:on-delete="deleteAccount"
	/>
</template>
