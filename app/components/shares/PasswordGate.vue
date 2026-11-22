<script setup lang="ts">
/** A password-protected document link: asks for the password and hands back what the link opens. */
import type { PublicShareInfo } from "~/utils/types";

const props = defineProps<{ token: string }>();
const emit = defineEmits<{ unlocked: [info: PublicShareInfo] }>();

const brandName = useBrandName();
const password = ref("");
const unlocking = ref(false);
const error = ref<string | null>(null);

async function unlock() {
	unlocking.value = true;
	error.value = null;
	const result = await useAPI(
		(api) =>
			api.postPublicDocsByTokenUnlock({
				path: { token: props.token },
				body: { password: password.value },
			}),
		true,
	);
	unlocking.value = false;
	if (!result.success) {
		error.value =
			(result.code as number) === 429
				? "Zu viele Versuche. Bitte warte ein paar Minuten."
				: "Falsches Passwort.";
		return;
	}
	password.value = "";
	emit("unlocked", result.data);
}
</script>

<template>
	<UPageCard class="mx-auto max-w-md border-slate-800">
		<form class="space-y-4" @submit.prevent="unlock">
			<div class="flex flex-col items-center gap-2 text-center">
				<UIcon name="i-lucide-lock" class="size-10 text-primary-400" />
				<h1 class="text-lg font-semibold text-white">Geschützter Link</h1>
				<p class="text-sm text-slate-400">{{ brandName }} hat diesen Link mit einem Passwort geschützt.</p>
			</div>
			<UFormField label="Passwort" :error="error ?? undefined">
				<UInput v-model="password" type="password" autocomplete="current-password" autofocus class="w-full" />
			</UFormField>
			<UButton type="submit" label="Öffnen" color="primary" block :loading="unlocking" :disabled="!password" />
		</form>
	</UPageCard>
</template>
