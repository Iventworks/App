<script setup lang="ts">
/**
 * Overview of one account: profile, event memberships, account actions and the danger zone. System
 * admins (system host) have no events.
 */
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { AdminUserDetail, PasswordLink } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

const toast = useToast();
const currentUser = await useUserInfoStore().use();
const { data: user, refresh } = useSubrouterInjectedData<AdminUserDetail>("admin_user").inject();

const isSelf = computed(() => user.value?.id === currentUser.value?.id);
const isSystem = computed(() => useInstance().value?.kind === "system");

const profileRows = computed(() => {
	const u = user.value;
	if (!u) return [];
	return [
		{ label: "Anzeigename", value: u.display_name },
		{ label: "Benutzername", value: `@${u.username}` },
		{ label: "E-Mail", value: u.email, href: `mailto:${u.email}` },
		{ label: "Telefon", value: u.phone || "–", href: u.phone ? `tel:${u.phone}` : undefined },
		{ label: "Dabei seit", value: formatDay(u.created_at) },
		{
			label: "Letzte Anmeldung",
			value: u.last_login_at
				? `${formatDate(u.last_login_at)} (${formatRelative(u.last_login_at)})`
				: "Noch nie",
		},
	];
});

// --- actions ------------------------------------------------------------------------------

const editOpen = ref(false);
const passwordOpen = ref(false);
const suspendOpen = ref(false);
const deleteOpen = ref(false);
const linkOpen = ref(false);
const link = ref<PasswordLink | null>(null);
const busy = ref<string | null>(null);

function showError(title: string, message: string) {
	toast.add({ title, description: message, icon: "i-lucide-alert-circle", color: "error" });
}

async function createLink() {
	const target = user.value;
	if (!target) return;
	busy.value = "link";
	const result = await useAPI((api) =>
		api.postAdminUsersByUserIdPasswordLink({ path: { userId: target.id } }),
	);
	busy.value = null;
	if (!result.success) return showError("Link konnte nicht erstellt werden", result.message);
	link.value = result.data;
	linkOpen.value = true;
	await refresh();
}

async function revokeSessions() {
	const target = user.value;
	if (!target) return;
	busy.value = "sessions";
	const result = await useAPI((api) =>
		api.postAdminUsersByUserIdSessionsRevoke({ path: { userId: target.id } }),
	);
	busy.value = null;
	if (!result.success) return showError("Abmelden fehlgeschlagen", result.message);
	toast.add({
		title: `${target.display_name} wurde überall abgemeldet`,
		icon: "i-lucide-log-out",
		color: "success",
	});
	await refresh();
}

async function unsuspend() {
	const target = user.value;
	if (!target) return;
	busy.value = "unsuspend";
	const result = await useAPI((api) =>
		api.postAdminUsersByUserIdUnsuspend({ path: { userId: target.id } }),
	);
	busy.value = null;
	if (!result.success) return showError("Sperre konnte nicht aufgehoben werden", result.message);
	toast.add({ title: "Sperre aufgehoben", icon: "i-lucide-lock-open", color: "success" });
	await refresh();
}

async function activate() {
	const target = user.value;
	if (!target) return;
	busy.value = "activate";
	const result = await useAPI((api) =>
		api.putAdminUsersByUserId({ path: { userId: target.id }, body: { role: "volunteer" } }),
	);
	busy.value = null;
	if (!result.success) return showError("Freischalten fehlgeschlagen", result.message);
	toast.add({
		title: `${target.display_name} freigeschaltet`,
		icon: "i-lucide-user-check",
		color: "success",
	});
	await refresh();
}

async function confirmDelete() {
	const target = user.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteAdminUsersByUserId({ path: { userId: target.id } }),
	);
	if (!result.success) {
		toast.add({
			title: "Löschen fehlgeschlagen",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		throw new Error(result.message);
	}
	toast.add({ title: `${target.display_name} gelöscht`, icon: "i-lucide-check", color: "success" });
	await navigateTo("/admin/users");
}

const EVENT_STATUS_LABELS: Record<string, string> = {
	planning: "In Planung",
	confirmed: "Bestätigt",
	cancelled: "Abgesagt",
	archived: "Archiviert",
};
</script>

<template>
	<div v-if="user" class="space-y-6">
		<UAlert
			v-if="user.suspended_at"
			icon="i-lucide-ban"
			color="error"
			variant="subtle"
			:title="`Gesperrt seit ${formatDate(user.suspended_at)}`"
			:description="user.suspended_reason ? `Grund: ${user.suspended_reason}` : 'Kein Grund angegeben.'"
			:actions="[{ label: 'Sperre aufheben', icon: 'i-lucide-lock-open', color: 'error', variant: 'solid', loading: busy === 'unsuspend', onClick: unsuspend }]"
		/>
		<UAlert
			v-else-if="user.role === 'unverified'"
			icon="i-lucide-hourglass"
			color="warning"
			variant="subtle"
			title="Wartet auf Freischaltung"
			description="Das Konto kann sich anmelden, sieht aber nur die Warteseite."
			:actions="[{ label: 'Freischalten', icon: 'i-lucide-user-check', color: 'warning', variant: 'solid', loading: busy === 'activate', onClick: activate }]"
		/>

		<div class="grid gap-4" :class="isSystem ? 'sm:grid-cols-2' : 'sm:grid-cols-3'">
			<DashboardStatCard v-if="!isSystem" label="Events" :value="user.events.length" icon="i-lucide-tent" />
			<DashboardStatCard
				label="Aktive Sitzungen"
				:value="user.active_sessions"
				icon="i-lucide-monitor-smartphone"
				icon-color="emerald"
			/>
			<DashboardStatCard label="API-Schlüssel" :value="user.api_keys" icon="i-lucide-key" icon-color="amber" />
		</div>

		<div class="grid gap-6 lg:grid-cols-5">
			<div class="space-y-6 lg:col-span-3">
				<DashboardSectionCard title="Profil" description="Kontaktdaten und Konto" icon="i-lucide-id-card" flush>
					<template #actions>
						<UButton label="Bearbeiten" icon="i-lucide-pencil" color="neutral" variant="subtle" size="sm" @click="editOpen = true" />
					</template>
					<dl class="divide-y divide-slate-800">
						<div v-for="row in profileRows" :key="row.label" class="flex flex-col gap-1 px-6 py-3 sm:flex-row sm:gap-4">
							<dt class="text-sm text-slate-400 sm:w-40 sm:shrink-0">{{ row.label }}</dt>
							<dd class="min-w-0 break-words text-sm text-white">
								<a v-if="row.href" :href="row.href" class="text-primary-400 hover:underline">{{ row.value }}</a>
								<template v-else>{{ row.value }}</template>
							</dd>
						</div>
					</dl>
				</DashboardSectionCard>

				<DashboardSectionCard v-if="!isSystem" title="Events" description="Wo die Person mitarbeitet" icon="i-lucide-tent" flush>
					<UEmpty
						v-if="!user.events.length"
						variant="naked"
						icon="i-lucide-tent"
						title="Noch in keinem Event"
						description="Leitungen fügen Mitarbeitende im Event unter „Team“ hinzu."
						class="py-8"
					/>
					<ul v-else class="divide-y divide-slate-800">
						<li v-for="event in user.events" :key="event.id">
							<NuxtLink :to="`/events/${event.id}`" class="flex items-center gap-3 px-6 py-3 transition hover:bg-slate-800/40">
								<UIcon :name="event.type === 'camp' ? 'i-lucide-tent' : 'i-lucide-calendar'" class="size-5 shrink-0 text-slate-400" />
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium text-white">{{ event.name }}</p>
									<p class="text-xs text-slate-500">
										{{ formatDayRange(event.start_date, event.end_date) }} · {{ EVENT_STATUS_LABELS[event.status] ?? event.status }}
										<template v-if="event.position"> · {{ event.position }}</template>
									</p>
								</div>
								<UBadge :label="getEventRoleLabel(event.role)" :color="getEventRoleColor(event.role)" variant="subtle" />
							</NuxtLink>
						</li>
					</ul>
				</DashboardSectionCard>
			</div>

			<div class="space-y-6 lg:col-span-2">
				<DashboardSectionCard title="Konto-Aktionen" icon="i-lucide-shield-check" flush>
					<ul class="divide-y divide-slate-800">
						<li class="flex items-center justify-between gap-4 px-6 py-4">
							<div class="min-w-0">
								<p class="font-medium text-white">Passwort setzen</p>
								<p class="text-sm text-slate-400">Neues Passwort vergeben, meldet überall ab.</p>
							</div>
							<UButton icon="i-lucide-key-round" color="neutral" variant="subtle" aria-label="Passwort setzen" @click="passwordOpen = true" />
						</li>
						<li class="flex items-center justify-between gap-4 px-6 py-4">
							<div class="min-w-0">
								<p class="font-medium text-white">Passwort-Link erstellen</p>
								<p class="text-sm text-slate-400">
									<template v-if="user.password_link_expires_at">
										Offener Link bis {{ formatDate(user.password_link_expires_at) }} – ein neuer ersetzt ihn.
									</template>
									<template v-else>Einmal-Link, mit dem die Person selbst ein Passwort wählt.</template>
								</p>
							</div>
							<UButton icon="i-lucide-link" color="neutral" variant="subtle" aria-label="Passwort-Link erstellen" :loading="busy === 'link'" @click="createLink" />
						</li>
						<li class="flex items-center justify-between gap-4 px-6 py-4">
							<div class="min-w-0">
								<p class="font-medium text-white">Überall abmelden</p>
								<p class="text-sm text-slate-400">
									{{ isSelf ? "Deine eigenen Sitzungen verwaltest du in den Einstellungen." : `${user.active_sessions} aktive ${user.active_sessions === 1 ? "Sitzung" : "Sitzungen"} beenden.` }}
								</p>
							</div>
							<UButton
								icon="i-lucide-log-out"
								color="neutral"
								variant="subtle"
								aria-label="Überall abmelden"
								:disabled="isSelf || !user.active_sessions"
								:loading="busy === 'sessions'"
								@click="revokeSessions"
							/>
						</li>
						<li class="flex items-center justify-between gap-4 px-6 py-4">
							<div class="min-w-0">
								<p class="font-medium text-white">{{ user.suspended_at ? "Sperre aufheben" : "Konto sperren" }}</p>
								<p class="text-sm text-slate-400">
									{{
										isSelf
											? "Dein eigenes Konto kannst du nicht sperren."
											: user.suspended_at
												? "Die Person kann sich wieder anmelden."
												: "Zugang vorübergehend entziehen, ohne Daten zu löschen."
									}}
								</p>
							</div>
							<UButton
								v-if="user.suspended_at"
								icon="i-lucide-lock-open"
								color="neutral"
								variant="subtle"
								aria-label="Sperre aufheben"
								:loading="busy === 'unsuspend'"
								@click="unsuspend"
							/>
							<UButton
								v-else
								icon="i-lucide-ban"
								color="error"
								variant="soft"
								aria-label="Konto sperren"
								:disabled="isSelf"
								@click="suspendOpen = true"
							/>
						</li>
					</ul>
				</DashboardSectionCard>

				<DashboardSectionCard title="Gefahrenzone" description="Nicht rückgängig zu machen" icon="i-lucide-alert-triangle" tone="danger">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
						<div class="flex-1">
							<h4 class="font-medium text-white">Konto löschen</h4>
							<p class="mt-1 text-sm text-slate-400">
								{{ isSelf ? "Dein eigenes Konto löschst du in den Einstellungen." : "Löscht das Konto mit allen persönlichen Daten." }}
							</p>
						</div>
						<UButton label="Löschen" color="error" variant="soft" icon="i-lucide-trash-2" :disabled="isSelf" @click="deleteOpen = true" />
					</div>
				</DashboardSectionCard>
			</div>
		</div>
	</div>

	<AdminUserEditModal v-model:open="editOpen" :user="user" @saved="refresh" />
	<AdminUserPasswordModal v-model:open="passwordOpen" :user="user" @saved="refresh" />
	<AdminUserSuspendModal v-model:open="suspendOpen" :user="user" @suspended="refresh" />
	<AdminPasswordLinkModal v-model:open="linkOpen" :link="link" :name="user?.display_name ?? ''" />
	<DashboardDeleteModal
		v-model:open="deleteOpen"
		:title="isSystem ? 'System-Admin löschen' : 'Benutzer löschen'"
		:warning-text="
			isSystem
				? `Das Konto von ${user?.display_name} wird gelöscht; die Person kann die Organisationen dann nicht mehr verwalten.`
				: `Das Konto von ${user?.display_name} wird mit allen persönlichen Daten gelöscht. Einträge in Events bleiben ohne Namen erhalten.`
		"
		:on-delete="confirmDelete"
	/>
</template>
