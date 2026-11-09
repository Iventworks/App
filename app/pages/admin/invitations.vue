<script setup lang="ts">
import type { DropdownMenuItem, FormSubmitEvent, TableColumn } from "@nuxt/ui";
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

const counts = computed(() => {
	const all = invitations.value ?? [];
	return {
		pending: all.filter((i) => i.status === "pending").length,
		accepted: all.filter((i) => i.status === "accepted").length,
		expired: all.filter((i) => i.status === "expired").length,
	};
});

const tableFilters = computed(() => [
	{ column: "email" as const, type: "text" as const, placeholder: "E-Mail suchen …" },
	{
		column: "status" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		icon: "i-lucide-filter",
		options: (["pending", "accepted", "expired"] as InvitationStatus[]).map((value) => ({
			label: `${STATUS_LABELS[value]} (${counts.value[value]})`,
			value,
		})),
	},
]);

// Open invitations first; the status filter shows the others on demand.
const table = useDataTableInitialFilters({ status: ["pending"] });

const columns: TableColumn<Invitation>[] = [
	{ accessorKey: "email", header: "Person" },
	{ accessorKey: "role", header: "Rolle" },
	{ accessorKey: "status", header: "Status" },
	{ accessorKey: "created_at", header: "Eingeladen" },
	{ accessorKey: "expires_at", header: "Gültig bis" },
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
];

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

// "Einladen" on the users page links here with `?new=1`.
const route = useRoute();
if (route.query.new) {
	openCreate();
	void useRouter().replace({ query: { ...route.query, new: undefined } });
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
				description="Per E-Mail einladen – Benutzername und Passwort wählt die Person selbst"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<DashboardDataTable
					ref="table"
					:data="invitations ?? []"
					:columns="columns"
					:loading="loading && !invitations"
					:filters="tableFilters"
					:default-page-size="25"
					empty-title="Keine Einladungen"
					empty-description="Lade neue Mitarbeitende per E-Mail-Link ein. Sie wählen dann selbst Benutzername und Passwort."
					empty-icon="i-lucide-mail"
					@refresh="refresh"
				>
					<template #header-right>
						<UButton
							label="Direkt anlegen"
							icon="i-lucide-user-plus"
							color="neutral"
							variant="subtle"
							to="/admin/users"
						/>
						<UButton label="Neue Einladung" icon="i-lucide-plus" @click="openCreate" />
					</template>

					<template #email-cell="{ row }">
						<div class="min-w-0">
							<p class="font-medium text-white">{{ row.original.display_name || row.original.email }}</p>
							<p v-if="row.original.display_name" class="text-xs text-slate-500">{{ row.original.email }}</p>
						</div>
					</template>

					<template #role-cell="{ row }">
						<UBadge :label="getRoleLabel(row.original.role)" :color="getRoleColor(row.original.role)" variant="subtle" />
					</template>

					<template #status-cell="{ row }">
						<UBadge
							:label="STATUS_LABELS[row.original.status]"
							:color="STATUS_COLORS[row.original.status]"
							:icon="STATUS_ICONS[row.original.status]"
							variant="soft"
						/>
						<p v-if="row.original.accepted_user" class="mt-1 text-xs text-slate-500">
							als
							<NuxtLink :to="`/admin/users/${row.original.accepted_user.id}`" class="text-primary-400 hover:underline">
								@{{ row.original.accepted_user.username }}
							</NuxtLink>
						</p>
					</template>

					<template #created_at-cell="{ row }">
						<p class="text-sm text-slate-300" :title="formatDate(row.original.created_at)">
							{{ formatRelative(row.original.created_at) }}
						</p>
						<p v-if="row.original.invited_by" class="text-xs text-slate-500">
							von {{ row.original.invited_by.display_name }}
						</p>
					</template>

					<template #expires_at-cell="{ row }">
						<span class="text-sm text-slate-400">
							{{ row.original.status === "accepted" ? `angenommen ${formatDate(row.original.accepted_at)}` : formatDate(row.original.expires_at) }}
						</span>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex justify-end">
							<UDropdownMenu
								v-if="row.original.status !== 'accepted'"
								:items="actions(row.original)"
								:ui="{ viewport: 'main-bg-color' }"
							>
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</div>
					</template>
				</DashboardDataTable>
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
