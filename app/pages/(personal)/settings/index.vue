<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

const profileSchema = z.object({
	username: z
		.string()
		.trim()
		.min(5, "Muss mindestens 5 Zeichen lang sein")
		.max(30, "Darf höchstens 30 Zeichen lang sein")
		.regex(/^[a-zA-Z0-9_]+$/, "Es sind nur alphanumerische Zeichen und Unterstriche erlaubt"),
	display_name: z.string().trim().max(50, "Darf höchstens 50 Zeichen lang sein").optional(),
	email: z.email("Ungültige E-Mail-Adresse").trim(),
});

const userInfoStore = await useUserInfoStore();
const userInfo = await userInfoStore.use();
const loading = ref(false);

if (!userInfoStore.isValid(userInfo)) {
	throw new Error("User not authenticated but trying to access Profile Settings");
}

type ProfileSchema = z.output<typeof profileSchema>;

const profile = reactive<Partial<ProfileSchema>>({
	username: userInfo.value.username,
	display_name: userInfo.value.display_name || "",
	email: userInfo.value.email,
});

const toast = useToast();

async function onSubmit(event: FormSubmitEvent<ProfileSchema>) {
	loading.value = true;

	try {
		const result = await useAPI((api) =>
			api.putAccount({
				body: {
					username: event.data.username,
					display_name: event.data.display_name || undefined,
					email: event.data.email,
				},
			}),
		);

		if (result.success) {
			toast.add({
				title: "Profil aktualisiert",
				description: "Ihr Profil wurde erfolgreich aktualisiert.",
				icon: "i-lucide-check",
				color: "success",
			});

			userInfoStore.update({
				username: event.data.username,
				display_name: event.data.display_name || undefined,
				email: event.data.email,
			});
		} else {
			toast.add({
				title: "Fehler",
				description: result.message || "Beim Aktualisieren Ihres Profils ist ein Fehler aufgetreten.",
				icon: "i-lucide-alert-circle",
				color: "error",
			});
		}
	} catch (error) {
		toast.add({
			title: "Fehler",
			description: "Ein unerwarteter Fehler ist aufgetreten.",
			icon: "i-lucide-alert-circle",
			color: "error",
		});
	} finally {
		loading.value = false;
	}
}
</script>

<template>
	<div class="space-y-6">
		<!-- Header -->
		<div>
			<h2 class="text-xl font-semibold text-white">Profil Einstellungen</h2>
			<p class="text-sm text-slate-400 mt-1">Verwalten Sie Ihre öffentlichen Profilinformationen</p>
		</div>

		<!-- Profile Card -->
		<div class="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
			<div class="px-6 py-4 border-b border-slate-800">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
						<UIcon name="i-lucide-user" class="w-5 h-5 text-sky-400" />
					</div>
					<div>
						<h3 class="font-medium text-white">Profilinformationen</h3>
						<p class="text-sm text-slate-400">Aktualisieren Sie Ihre Kontoprofilinformationen</p>
					</div>
				</div>
			</div>
			
			<div class="p-6">
				<UForm id="settings" :schema="profileSchema" :state="profile" @submit="onSubmit" class="divide-y divide-slate-800">
					<UFormField 
						name="username" 
						label="Benutzername"
						description="Ihr eindeutiger Benutzername zum Anmelden."
						required
						class="flex max-sm:flex-col justify-between items-start gap-4 py-4 first:pt-0 last:pb-0"
						:ui='{
							root: "w-full sm:w-auto",
							container: "w-full sm:w-auto",
						}'
					>
						<UInput v-model="profile.username" placeholder="Benutzername eingeben" class="w-full sm:w-96" />
					</UFormField>

					<UFormField 
						name="display_name" 
						label="Anzeigename"
						description="Wird öffentlich angezeigt. Lassen Sie das Feld leer, um den Benutzernamen zu verwenden."
						class="flex max-sm:flex-col justify-between items-start gap-4 py-4 first:pt-0 last:pb-0"
						:ui='{
							root: "w-full sm:w-auto",
							container: "w-full sm:w-auto",
						}'
					>
						<UInput v-model="profile.display_name" placeholder="Anzeigename eingeben" class="w-full sm:w-96" />
					</UFormField>

					<UFormField 
						name="email" 
						label="E-Mail-Adresse"
						description="Wird zum Anmelden und für Benachrichtigungen verwendet."
						required
						class="flex max-sm:flex-col justify-between items-start gap-4 py-4 first:pt-0 last:pb-0"
						:ui='{
							root: "w-full sm:w-auto",
							container: "w-full sm:w-auto",
						}'
					>
						<UInput v-model="profile.email" type="email" placeholder="E-Mail-Adresse eingeben" class="w-full sm:w-96" />
					</UFormField>

					<div class="pt-4">
						<UButton 
							label="Änderungen speichern" 
							color="primary" 
							type="submit" 
							:loading="loading"
							icon="i-lucide-save"
						/>
					</div>
				</UForm>
			</div>
		</div>

		<!-- Account Info Card -->
		<div class="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur-sm p-6">
			<div class="flex items-center gap-4">
				<div class="w-12 h-12 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
					<span class="text-xl font-bold text-white">{{ profile.display_name?.charAt(0) || profile.username?.charAt(0) || '?' }}</span>
				</div>
				<div>
					<p class="font-medium text-white">{{ profile.display_name || profile.username }}</p>
					<p class="text-sm text-slate-400">@{{ profile.username }}</p>
				</div>
				<div class="ml-auto">
					<UBadge 
						:label="userInfo.role" 
						:color="userInfo.role === 'admin' ? 'error' : userInfo.role === 'core_team' ? 'primary' : userInfo.role === 'volunteer' ? 'info' : 'neutral'"
						size="sm"
					/>
				</div>
			</div>
		</div>
	</div>
</template>
