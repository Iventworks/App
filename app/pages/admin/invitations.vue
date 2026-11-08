<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { GetAdminInvitationsResponses } from "~/api-client";
import { zPostAdminInvitationsBody } from "~/api-client/zod.gen";
import { Utils } from "~/utils";

type Invitation = GetAdminInvitationsResponses["200"]["data"][number];
type InvitationStatus = Invitation["status"];

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Einladungen | Administration | CMP",
	description: "Neue Mitglieder einladen",
});

const toast = useToast();

const STATUS_LABELS: Record<InvitationStatus, string> = {
	pending: "Offen",
	accepted: "Angenommen",
	expired: "Abgelaufen",
};
const STATUS_COLORS: Record<InvitationStatus, "warning" | "success" | "neutral"> = {
	pending: "warning",
	accepted: "success",
	expired: "neutral",
};
const STATUS_ICONS: Record<InvitationStatus, string> = {
	pending: "i-lucide-mail",
	accepted: "i-lucide-mail-check",
	expired: "i-lucide-mail-x",
};

const {
	data: invitations,
	loading,
	refresh,
} = await useAPIAsyncData("admin-invitations", async () => {
	const result = await useAPI((api) => api.getAdminInvitations({}));
	if (!result.success) {
		toast.add({
			title: "Einladungen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Invitation[];
	}
	return result.data;
});

const statusFilter = ref<InvitationStatus | "all">("pending");

const visibleInvitations = computed(() => {
	const all = invitations.value ?? [];
	return statusFilter.value === "all" ? all : all.filter((i) => i.status === statusFilter.value);
});

const counts = computed(() => {
	const all = invitations.value ?? [];
	return {
		pending: all.filter((i) => i.status === "pending").length,
		accepted: all.filter((i) => i.status === "accepted").length,
		expired: all.filter((i) => i.status === "expired").length,
	};
});

// --- create ---------------------------------------------------------------------------------

const VALIDITY_OPTIONS = [
	{ label: "3 Tage", value: 3 },
	{ label: "7 Tage", value: 7 },
	{ label: "14 Tage", value: 14 },
	{ label: "30 Tage", value: 30 },
];

const createSchema = zPostAdminInvitationsBody.extend({
	email: z.email("Ungültige E-Mail-Adresse"),
	display_name: z.string().trim().max(64),
});
type CreateSchema = z.output<typeof createSchema>;

const createOpen = ref(false);
const creating = ref(false);
const createState = reactive({
	email: "",
	display_name: "",
	role: "volunteer" as Invitation["role"],
	expires_in_days: 7,
});

function openCreate() {
	Object.assign(createState, { email: "", display_name: "", role: "volunteer", expires_in_days: 7 });
	createOpen.value = true;
}

// The link is only returned once (on create/resend); show it right away.
const linkResult = ref<{ email: string; url: string; emailSent: boolean } | null>(null);
const linkOpen = ref(false);

async function onCreate(event: FormSubmitEvent<CreateSchema>) {
	creating.value = true;
	const result = await useAPI((api) =>
		api.postAdminInvitations({
			body: {
				email: event.data.email,
				display_name: event.data.display_name || undefined,
				role: event.data.role,
				expires_in_days: event.data.expires_in_days,
			},
		}),
	);
	creating.value = false;

	if (!result.success) {
		toast.add({
			title: "Einladung fehlgeschlagen",
			description:
				(result.code as number) === 409
					? "Für diese E-Mail-Adresse gibt es bereits ein Konto oder eine offene Einladung."
					: result.message,
			color: "error",
		});
		return;
	}

	createOpen.value = false;
	linkResult.value = {
		email: result.data.invitation.email,
		url: result.data.invite_url,
		emailSent: result.data.email_sent,
	};
	linkOpen.value = true;
	statusFilter.value = "pending";
	await refresh();
}

async function resend(invitation: Invitation) {
	const result = await useAPI((api) =>
		api.postAdminInvitationsByInvitationIdResend({ path: { invitationId: invitation.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Erneut senden fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	linkResult.value = {
		email: result.data.invitation.email,
		url: result.data.invite_url,
		emailSent: result.data.email_sent,
	};
	linkOpen.value = true;
	await refresh();
}

async function copyLink() {
	if (!linkResult.value) return;
	const ok = await Utils.copyToClipboard(linkResult.value.url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-check", color: "success" }
			: {
					title: "Kopieren nicht möglich",
					description: "Bitte markiere den Link manuell.",
					color: "warning",
				},
	);
}

// --- revoke ---------------------------------------------------------------------------------

const revokeOpen = ref(false);
const revokeTarget = ref<Invitation | null>(null);

async function confirmRevoke() {
	const target = revokeTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteAdminInvitationsByInvitationId({ path: { invitationId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Zurückziehen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Einladung zurückgezogen", icon: "i-lucide-check", color: "success" });
	await refresh();
}

function actions(invitation: Invitation): DropdownMenuItem[][] {
	if (invitation.status === "accepted") return [];
	return [
		[
			{
				label: invitation.status === "expired" ? "Neu einladen" : "Neuen Link erzeugen",
				icon: "i-lucide-send",
				onSelect: () => resend(invitation),
			},
		],
		[
			{
				label: "Zurückziehen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => {
					revokeTarget.value = invitation;
					revokeOpen.value = true;
				},
			},
		],
	];
}
</script>

<template>
	<UDashboardPanel id="admin-invitations">
		<template #header>
			<DashboardPageHeader
				title="Einladungen"
				icon="i-lucide-mail-plus"
				description="Neue Konten gibt es nur per Einladung"
			>
				<template #right>
					<UButton label="Neue Einladung" icon="i-lucide-plus" @click="openCreate" />
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<UTabs
					v-model="statusFilter"
					:items="[
						{ label: `Offen (${counts.pending})`, value: 'pending' },
						{ label: `Angenommen (${counts.accepted})`, value: 'accepted' },
						{ label: `Abgelaufen (${counts.expired})`, value: 'expired' },
						{ label: 'Alle', value: 'all' },
					]"
					:content="false"
					size="sm"
					variant="link"
				/>
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<div v-if="loading && !invitations" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!visibleInvitations.length"
					icon="i-lucide-mail"
					title="Keine Einladungen"
					description="Lade neue Mitarbeitende per E-Mail-Link ein. Sie wählen dann selbst Benutzername und Passwort."
				>
					<template #actions>
						<UButton label="Jemanden einladen" icon="i-lucide-plus" @click="openCreate" />
					</template>
				</UEmpty>

				<UCard
					v-else
					class="border-slate-800 bg-slate-900/60"
					:ui="{ body: 'p-0 sm:p-0' }"
				>
					<ul class="divide-y divide-slate-800">
						<li
							v-for="invitation in visibleInvitations"
							:key="invitation.id"
							class="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
						>
							<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-800">
								<UIcon :name="STATUS_ICONS[invitation.status]" class="size-4 text-slate-300" />
							</div>

							<div class="min-w-0 flex-1">
								<p class="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
									{{ invitation.display_name || invitation.email }}
									<UBadge
										:label="STATUS_LABELS[invitation.status]"
										:color="STATUS_COLORS[invitation.status]"
										variant="subtle"
										size="sm"
									/>
									<UBadge
										:label="getRoleLabel(invitation.role)"
										:color="getRoleColor(invitation.role)"
										variant="outline"
										size="sm"
									/>
								</p>
								<p class="truncate text-xs text-slate-500">
									<template v-if="invitation.display_name">{{ invitation.email }} · </template>
									Eingeladen {{ formatRelative(invitation.created_at) }}
									<template v-if="invitation.invited_by">
										von {{ invitation.invited_by.display_name }}
									</template>
									·
									<template v-if="invitation.status === 'accepted'">
										angenommen {{ formatDate(invitation.accepted_at) }}
										<template v-if="invitation.accepted_user">
											als @{{ invitation.accepted_user.username }}
										</template>
									</template>
									<template v-else-if="invitation.status === 'expired'">
										abgelaufen {{ formatDate(invitation.expires_at) }}
									</template>
									<template v-else>gültig bis {{ formatDate(invitation.expires_at) }}</template>
								</p>
							</div>

							<UDropdownMenu
								v-if="invitation.status !== 'accepted'"
								:items="actions(invitation)"
								:ui="{ viewport: 'main-bg-color' }"
							>
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									size="sm"
									aria-label="Aktionen"
								/>
							</UDropdownMenu>
						</li>
					</ul>
				</UCard>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal v-model:open="createOpen" title="Neue Einladung" icon="i-lucide-mail-plus">
		<UForm :schema="createSchema" :state="createState" class="space-y-4" @submit="onCreate">
			<UFormField label="E-Mail-Adresse" name="email" required>
				<UInput v-model="createState.email" type="email" class="w-full" autofocus />
			</UFormField>
			<UFormField
				label="Name"
				name="display_name"
				description="Optional – wird als Anzeigename vorgeschlagen."
			>
				<UInput v-model="createState.display_name" class="w-full" />
			</UFormField>
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Rolle" name="role" required>
					<USelect v-model="createState.role" :items="ORG_ROLE_OPTIONS" class="w-full" />
				</UFormField>
				<UFormField label="Gültig für" name="expires_in_days" required>
					<USelect
						v-model="createState.expires_in_days"
						:items="VALIDITY_OPTIONS"
						class="w-full"
					/>
				</UFormField>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="createOpen = false" />
				<UButton type="submit" label="Einladen" icon="i-lucide-send" :loading="creating" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardModal
		v-model:open="linkOpen"
		title="Einladungslink"
		icon="i-lucide-link"
		icon-color="emerald"
		:description="linkResult ? `Für ${linkResult.email}` : undefined"
	>
		<div v-if="linkResult" class="space-y-4">
			<UAlert
				v-if="linkResult.emailSent"
				icon="i-lucide-mail-check"
				color="success"
				variant="subtle"
				title="E-Mail verschickt"
				description="Die Einladung wurde per E-Mail versendet. Du kannst den Link zusätzlich weitergeben."
			/>
			<UAlert
				v-else
				icon="i-lucide-mail-warning"
				color="warning"
				variant="subtle"
				title="Keine E-Mail verschickt"
				description="Der E-Mail-Versand ist nicht eingerichtet. Schick den Link selbst, z. B. per Messenger."
			/>
			<div class="flex items-center gap-2">
				<UInput :model-value="linkResult.url" readonly class="w-full font-mono text-xs" />
				<UButton icon="i-lucide-copy" aria-label="Link kopieren" @click="copyLink" />
			</div>
			<p class="text-xs text-slate-500">
				Der Link wird nur jetzt angezeigt. Brauchst du ihn später erneut, erzeuge einen neuen.
			</p>
		</div>

		<template #footer>
			<UButton label="Fertig" @click="linkOpen = false" />
		</template>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="revokeOpen"
		title="Einladung zurückziehen"
		:warning-text="`Der Einladungslink für ${revokeTarget?.email} funktioniert danach nicht mehr.`"
		:require-confirm-text="false"
		:on-delete="confirmRevoke"
	/>
</template>
