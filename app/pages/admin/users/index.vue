<script setup lang="ts">
/**
 * All accounts. New people join by invitation (email) or are created directly here; each row
 * opens the account's detail page with its actions and history.
 */
import type { DropdownMenuItem, TableColumn } from "@nuxt/ui";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { AdminUser, PasswordLink } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Benutzer | Administration",
	description: "Benutzerkonten und Rollen verwalten",
});

const toast = useToast();
const currentUser = await useUserInfoStore().use();

const {
	data: users,
	loading,
	refresh,
} = await useAPIAsyncData("admin-users", async () => {
	const result = await useAPI((api) => api.getAdminUsers({}));
	if (!result.success) {
		toast.add({
			title: "Benutzer konnten nicht geladen werden",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return [] as AdminUser[];
	}
	return result.data;
});

const pendingUsers = computed(() => (users.value ?? []).filter((u) => u.role === "unverified"));
const isSelf = (user: AdminUser) => user.id === currentUser.value?.id;

type Status = "active" | "suspended" | "pending";
const statusOf = (user: AdminUser): Status =>
	user.suspended_at ? "suspended" : user.role === "unverified" ? "pending" : "active";

const STATUS: Record<
	Status,
	{ label: string; color: "success" | "error" | "warning"; icon: string }
> = {
	active: { label: "Aktiv", color: "success", icon: "i-lucide-circle-check" },
	pending: { label: "Wartet", color: "warning", icon: "i-lucide-hourglass" },
	suspended: { label: "Gesperrt", color: "error", icon: "i-lucide-ban" },
};

// --- table ----------------------------------------------------------------------------------

const columns: TableColumn<AdminUser>[] = [
	{ accessorKey: "display_name", header: "Name" },
	{ accessorKey: "email", header: "E-Mail" },
	{ accessorKey: "role", header: "Rolle" },
	{ accessorKey: "suspended_at", header: "Status" },
	{ accessorKey: "last_login_at", header: "Letzte Anmeldung" },
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
];

const filters = [
	{
		column: "display_name" as const,
		type: "text" as const,
		placeholder: "Name, Benutzername oder E-Mail",
		// Search across name, username and email in one field.
		filterFn: (row: { original: AdminUser }, _columnId: string, value: string) => {
			const term = String(value ?? "")
				.trim()
				.toLowerCase();
			if (!term) return true;
			const { display_name, username, email } = row.original;
			return [display_name, username, email].some((field) => field.toLowerCase().includes(term));
		},
	},
	{
		column: "role" as const,
		type: "multi-select" as const,
		placeholder: "Alle Rollen",
		icon: "i-lucide-shield",
		options: ORG_ROLE_OPTIONS,
	},
	{
		// The status is derived from `suspended_at` and the role.
		column: "suspended_at" as const,
		type: "multi-select" as const,
		placeholder: "Alle Status",
		icon: "i-lucide-activity",
		options: (Object.keys(STATUS) as Status[]).map((value) => ({
			label: STATUS[value].label,
			value,
		})),
		filterFn: (row: { original: AdminUser }, _columnId: string, value: Status[] | undefined) =>
			!value?.length || value.includes(statusOf(row.original)),
	},
];

function rowActions(user: AdminUser): DropdownMenuItem[][] {
	return [
		[
			{ label: "Öffnen", icon: "i-lucide-arrow-right", to: `/admin/users/${user.id}` },
			...(user.role === "unverified"
				? [{ label: "Freischalten", icon: "i-lucide-user-check", onSelect: () => activate(user) }]
				: []),
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openModal("edit", user) },
			{
				label: "Passwort setzen",
				icon: "i-lucide-key-round",
				onSelect: () => openModal("password", user),
			},
			{ label: "Passwort-Link erstellen", icon: "i-lucide-link", onSelect: () => createLink(user) },
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				disabled: isSelf(user),
				onSelect: () => openModal("delete", user),
			},
		],
	];
}

async function activate(user: AdminUser) {
	const result = await useAPI((api) =>
		api.putAdminUsersByUserId({ path: { userId: user.id }, body: { role: "volunteer" } }),
	);
	if (!result.success) {
		toast.add({
			title: "Freischalten fehlgeschlagen",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}
	toast.add({
		title: `${user.display_name} freigeschaltet`,
		description: "Das Konto hat jetzt die Rolle Mitarbeiter:in.",
		icon: "i-lucide-user-check",
		color: "success",
	});
	await refresh();
}

// --- dialogs --------------------------------------------------------------------------------

const target = ref<AdminUser | null>(null);
const createOpen = ref(false);
const editOpen = ref(false);
const passwordOpen = ref(false);
const deleteOpen = ref(false);

function openModal(kind: "edit" | "password" | "delete", user: AdminUser) {
	if (kind === "delete" && isSelf(user)) return;
	target.value = user;
	({ edit: editOpen, password: passwordOpen, delete: deleteOpen })[kind].value = true;
}

const link = ref<PasswordLink | null>(null);
const linkName = ref("");
const linkIsNewAccount = ref(false);
const linkOpen = ref(false);

function showLink(name: string, value: PasswordLink, isNewAccount: boolean) {
	link.value = value;
	linkName.value = name;
	linkIsNewAccount.value = isNewAccount;
	linkOpen.value = true;
}

async function onCreated(user: AdminUser, passwordLink: PasswordLink | null) {
	await refresh();
	if (passwordLink) showLink(user.display_name, passwordLink, true);
	else await navigateTo(`/admin/users/${user.id}`);
}

async function createLink(user: AdminUser) {
	const result = await useAPI((api) =>
		api.postAdminUsersByUserIdPasswordLink({ path: { userId: user.id } }),
	);
	if (!result.success) {
		toast.add({
			title: "Link konnte nicht erstellt werden",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		return;
	}
	showLink(user.display_name, result.data, false);
}

async function confirmDelete() {
	const user = target.value;
	if (!user) return;
	const result = await useAPI((api) => api.deleteAdminUsersByUserId({ path: { userId: user.id } }));
	if (!result.success) {
		toast.add({
			title: "Löschen fehlgeschlagen",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		throw new Error(result.message);
	}
	toast.add({ title: `${user.display_name} gelöscht`, icon: "i-lucide-check", color: "success" });
	await refresh();
}
</script>

<template>
	<UDashboardPanel id="admin-users">
		<template #header>
			<DashboardPageHeader title="Benutzer" icon="i-lucide-users" description="Konten, Rollen und Zugänge" />
		</template>

		<template #body>
			<DashboardPageBody>
				<UAlert
					v-if="pendingUsers.length"
					icon="i-lucide-user-round-search"
					color="warning"
					variant="subtle"
					:title="
						pendingUsers.length === 1
							? '1 Konto wartet auf Freischaltung'
							: `${pendingUsers.length} Konten warten auf Freischaltung`
					"
					:description="pendingUsers.map((user) => user.display_name).join(', ')"
				/>

				<DashboardDataTable
					:data="users ?? []"
					:columns="columns"
					:loading="loading"
					:filters="filters"
					:default-page-size="25"
					empty-title="Keine Benutzer"
					empty-description="Keine Konten passen zu den Filtern."
					empty-icon="i-lucide-users"
					@refresh="refresh"
				>
					<template #header-right>
						<UButton
							label="Einladen"
							icon="i-lucide-mail-plus"
							color="neutral"
							variant="subtle"
							to="/admin/invitations?new=1"
						/>
						<UButton label="Benutzer anlegen" icon="i-lucide-user-plus" @click="createOpen = true" />
					</template>

					<template #display_name-cell="{ row }">
						<NuxtLink :to="`/admin/users/${row.original.id}`" class="group flex items-center gap-3">
							<UAvatar :text="initials(row.original.display_name)" size="sm" />
							<div class="min-w-0">
								<p class="flex items-center gap-2 font-medium text-white group-hover:text-primary-400">
									{{ row.original.display_name }}
									<UBadge v-if="isSelf(row.original)" label="Du" color="neutral" variant="outline" size="sm" />
								</p>
								<p class="text-xs text-slate-500">@{{ row.original.username }}</p>
							</div>
						</NuxtLink>
					</template>

					<template #email-cell="{ row }">
						<span class="text-slate-300">{{ row.original.email }}</span>
					</template>

					<template #role-cell="{ row }">
						<UBadge :label="getRoleLabel(row.original.role)" :color="getRoleColor(row.original.role)" variant="subtle" />
					</template>

					<template #suspended_at-cell="{ row }">
						<UTooltip :text="row.original.suspended_reason || undefined" :disabled="!row.original.suspended_reason">
							<UBadge
								:label="STATUS[statusOf(row.original)].label"
								:color="STATUS[statusOf(row.original)].color"
								:icon="STATUS[statusOf(row.original)].icon"
								variant="soft"
							/>
						</UTooltip>
					</template>

					<template #last_login_at-cell="{ row }">
						<span v-if="row.original.last_login_at" class="text-slate-400" :title="formatDate(row.original.last_login_at)">
							{{ formatRelative(row.original.last_login_at) }}
						</span>
						<span v-else class="text-slate-500">Noch nie</span>
					</template>

					<template #actions-cell="{ row }">
						<div class="flex items-center justify-end gap-1">
							<UButton
								v-if="row.original.role === 'unverified'"
								label="Freischalten"
								icon="i-lucide-user-check"
								size="xs"
								variant="subtle"
								class="hidden sm:inline-flex"
								@click="activate(row.original)"
							/>
							<UDropdownMenu :items="rowActions(row.original)" :ui="{ viewport: 'main-bg-color' }">
								<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
							</UDropdownMenu>
						</div>
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<AdminUserCreateModal v-model:open="createOpen" @created="onCreated" />
	<AdminUserEditModal v-model:open="editOpen" :user="target" @saved="refresh" />
	<AdminUserPasswordModal v-model:open="passwordOpen" :user="target" />
	<AdminPasswordLinkModal v-model:open="linkOpen" :link="link" :name="linkName" :is-new-account="linkIsNewAccount" />

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Benutzer löschen"
		:warning-text="`Das Konto von ${target?.display_name} wird mit allen persönlichen Daten gelöscht. Einträge in Events bleiben ohne Namen erhalten. Wenn die Person nur vorübergehend nicht mitmacht, sperre das Konto stattdessen.`"
		:on-delete="confirmDelete"
	/>
</template>
