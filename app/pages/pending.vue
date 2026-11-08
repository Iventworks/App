<script setup lang="ts">
import { useUserInfoStore } from "~/composables/stores/useUserStore";

definePageMeta({ layout: "auth" });

useSeoMeta({
	title: "Konto noch nicht freigeschaltet | CMP",
	description: "Dein Konto wartet auf die Freischaltung",
});

const userInfoStore = useUserInfoStore();
const user = await userInfoStore.use();
const toast = useToast();
const checking = ref(false);

async function checkAgain() {
	checking.value = true;
	await userInfoStore.refresh();
	checking.value = false;
	if (hasOrgRole(user.value?.role, "volunteer")) {
		await navigateTo("/");
	} else {
		toast.add({ title: "Noch nicht freigeschaltet", color: "warning", icon: "i-lucide-clock" });
	}
}

async function logout() {
	await useAPI((api) => api.postAuthLogout({}), true);
	await userInfoStore.clear();
	useAppCookies().sessionToken.set(null);
	await navigateTo("/auth/login");
}
</script>

<template>
	<div class="space-y-5 text-center">
		<div class="flex justify-center">
			<div class="rounded-full bg-amber-500/10 p-3">
				<UIcon name="i-lucide-hourglass" class="size-8 text-amber-400" />
			</div>
		</div>
		<div>
			<h2 class="text-xl font-semibold">Hallo {{ user?.display_name }}!</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-slate-400">
				Dein Konto ist angelegt, aber noch nicht freigeschaltet. Sobald das Admin-Team dir eine
				Rolle gegeben hat, siehst du hier deine Freizeiten, Aufgaben und Nachrichten.
			</p>
		</div>
		<div class="flex flex-col gap-2 sm:flex-row sm:justify-center">
			<UButton
				label="Erneut prüfen"
				icon="i-lucide-refresh-cw"
				:loading="checking"
				@click="checkAgain"
			/>
			<UButton label="Kontoeinstellungen" icon="i-lucide-settings" color="neutral" variant="subtle" to="/settings" />
			<UButton label="Abmelden" icon="i-lucide-log-out" color="neutral" variant="ghost" @click="logout" />
		</div>
	</div>
</template>
