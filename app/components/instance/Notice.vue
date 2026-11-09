<script setup lang="ts">
/**
 * Shown instead of the app when this host serves no org: the multi-org base domain (which only
 * hosts the system admin dashboard under `/admin`), an unknown host, or — when the instance info
 * couldn't be loaded at all — an unreachable server.
 */
const instance = useInstance();
const state = computed<"system" | "unknown" | "unreachable">(() => {
	if (!instance.value) return "unreachable";
	return instance.value.kind === "system" ? "system" : "unknown";
});
const baseHost = computed(() => {
	try {
		return new URL(instance.value?.base_url ?? "").host;
	} catch {
		return "";
	}
});
const host = import.meta.client ? window.location.host : "";

const TEXTS = {
	system: { title: "Keine Organisation ausgewählt", icon: "i-lucide-building" },
	unknown: { title: "Organisation nicht gefunden", icon: "i-lucide-circle-help" },
	unreachable: { title: "Server nicht erreichbar", icon: "i-lucide-cloud-off" },
} as const;

useSeoMeta({ title: () => TEXTS[state.value].title });

function reload() {
	window.location.reload();
}
</script>

<template>
	<div class="main-bg-color flex min-h-screen flex-col text-slate-100">
		<UMain class="flex flex-1 flex-col items-center justify-center px-4 py-10">
			<img src="/static/brand/logo-on-dark.svg" alt="Iventworks" class="mb-8 h-10" />
			<UPageCard class="w-full max-w-lg border-slate-800">
				<div class="flex flex-col items-center gap-4 text-center">
					<UIcon :name="TEXTS[state].icon" class="size-12 text-primary-400" />
					<div class="space-y-2">
						<h1 class="text-xl font-semibold text-white">{{ TEXTS[state].title }}</h1>
						<p v-if="state === 'system'" class="text-sm text-slate-400">
							Unter dieser Adresse läuft keine Organisation. Jede Organisation hat ihre eigene
							Adresse, z. B. <code class="text-slate-300">name.{{ baseHost }}</code>
							oder ihre eigene Domain – frag deine Organisation nach dem Link.
						</p>
						<p v-else-if="state === 'unknown'" class="text-sm text-slate-400">
							Unter <code class="text-slate-300">{{ host }}</code> ist keine Organisation eingerichtet.
							Prüfe die Adresse oder frag deine Organisation nach dem richtigen Link.
						</p>
						<p v-else class="text-sm text-slate-400">
							Die Verbindung zum Server ist fehlgeschlagen. Versuch es in einem Moment noch einmal.
						</p>
					</div>
					<UButton
						v-if="state === 'system'"
						to="/admin"
						icon="i-lucide-server-cog"
						color="primary"
						label="Zur Systemverwaltung"
					/>
					<UButton
						v-else-if="state === 'unreachable'"
						icon="i-lucide-refresh-cw"
						color="neutral"
						variant="subtle"
						label="Neu laden"
						@click="reload"
					/>
				</div>
			</UPageCard>
		</UMain>
	</div>
</template>
