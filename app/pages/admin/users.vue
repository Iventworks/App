<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { DropdownMenuItem, TableColumn } from "#ui/types";
import type { GetAdminUsersResponses } from "@/api-client/types.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import { Utils } from "~/utils";

type AdminUser = GetAdminUsersResponses[200]["data"][number];

useSeoMeta({
	title: "Benutzerverwaltung | Admin | CMP",
	description: "Benutzer verwalten",
});

const toast = useToast();

// Check admin access
const userInfoStore = useUserInfoStore();
const currentUser = await userInfoStore.use();
if (!userInfoStore.isValid(currentUser)) {
	throw new Error("User not authenticated but trying to access Admin Users");
}

if (!currentUser || currentUser.value.role !== "admin") {
	navigateTo("/dashboard");
}

const userColumns: TableColumn<AdminUser>[] = [
	{ accessorKey: "id", header: "ID" },
	{ accessorKey: "username", header: "Benutzername" },
	{ accessorKey: "display_name", header: "Anzeigename" },
	{ accessorKey: "email", header: "E-Mail-Adresse" },
	{ id: "role", header: "Rolle" },
	{ id: "actions", header: "", enableSorting: false, enableHiding: false },
];

const roleOptions = [
	{ label: "Admin", value: "admin" },
	{ label: "Kernteam", value: "core_team" },
	{ label: "Freiwilliger", value: "volunteer" },
	{ label: "Unverifiziert", value: "unverified" },
];

const {
	data: users,
	loading,
	refresh,
} = await useAPIAsyncData<AdminUser[]>("admin-users-list", async () => {
	const res = await useAPI((api) => api.getAdminUsers({}));
	if (!res.success) {
		toast.add({
			title: "Benutzer konnten nicht geladen werden",
			description: res.message,
			color: "error",
		});
		return [];
	}
	return res.data;
});

function getUserOptionsDropdownItems(row: { original: AdminUser }): DropdownMenuItem[][] {
	return [
		[
			{
				label: "Bearbeiten",
				icon: "i-lucide-pencil",
				onSelect: () => openEdit(row.original),
			},
			{
				label: "Passwort zurücksetzen",
				icon: "i-lucide-key",
				onSelect: () => openPassword(row.original),
			},
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error",
				onSelect: () => openDelete(row.original),
			},
		],
	];
}

const showCreateModal = ref(false);
const showEditModal = ref(false);
const showPasswordModal = ref(false);
const selectedUser = ref<AdminUser | null>(null);

const createSchema = z.object({
	username: z.string().min(1, "Benutzername ist erforderlich"),
	display_name: z.string().min(1, "Anzeigename ist erforderlich"),
	email: z.email("Muss eine gültige E-Mail-Adresse sein"),
	password: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein"),
	role: z.enum(["admin", "core_team", "volunteer", "unverified"]),
});

type CreateSchema = z.output<typeof createSchema>;

const createState = ref<CreateSchema>({
	username: "",
	display_name: "",
	email: "",
	password: "",
	role: "unverified" as AdminUser["role"],
});

const editForm = reactive({
	display_name: "",
	email: "",
	role: "unverified" as AdminUser["role"],
});

const passwordForm = reactive({
	password: "",
});

async function handleCreate() {
	const res = await useAPI((api) =>
		api.postAdminUsers({
			body: createState.value,
		}),
	);
	if (res.success) {
		toast.add({ title: "User created", color: "success" });
		showCreateModal.value = false;
		await refresh();
	} else {
		toast.add({
			title: "Benutzererstellung fehlgeschlagen",
			description: res.message,
			color: "error",
		});
	}
	createState.value = {
		username: "",
		display_name: "",
		email: "",
		password: "",
		role: "unverified" as AdminUser["role"],
	};
}

function openEdit(user: AdminUser) {
	selectedUser.value = user;
	editForm.display_name = user.display_name;
	editForm.email = user.email;
	editForm.role = user.role;
	showEditModal.value = true;
}

async function submitEdit() {
	if (!selectedUser.value) return;

	const res = await useAPI((api) =>
		api.putAdminUsersByUserId({
			path: { userId: selectedUser.value!.id },
			body: {
				display_name: editForm.display_name,
				email: editForm.email,
				role: editForm.role,
			},
		}),
	);

	if (res.success) {
		toast.add({
			title: "Benutzer aktualisiert",
			description: "Die Benutzerdaten wurden erfolgreich aktualisiert.",
			color: "success",
		});
		showEditModal.value = false;
		await refresh();
	} else {
		toast.add({
			title: "Aktualisierung fehlgeschlagen",
			description: res.message,
			color: "error",
		});
	}
}

function openPassword(user: AdminUser) {
	selectedUser.value = user;
	passwordForm.password = "";
	showPasswordModal.value = true;
}

function openDelete(user: AdminUser) {
	deleteUser(user);
}

async function submitPassword() {
	if (!selectedUser.value) return;

	const res = await useAPI((api) =>
		api.putAdminUsersByUserIdPassword({
			path: { userId: selectedUser.value!.id },
			body: { password: passwordForm.password },
		}),
	);

	if (res.success) {
		toast.add({
			title: "Passwort aktualisiert",
			description: "Das Passwort wurde erfolgreich aktualisiert.",
			color: "success",
		});
		showPasswordModal.value = false;
	} else {
		toast.add({
			title: "Passwortaktualisierung fehlgeschlagen",
			description: res.message,
			color: "error",
		});
	}
}

async function deleteUser(user: AdminUser) {
	if (!confirm(`Are you sure you want to delete user "${user.username}"?`)) return;

	const res = await useAPI((api) =>
		api.deleteAdminUsersByUserId({
			path: { userId: user.id },
		}),
	);

	if (res.success) {
		toast.add({
			title: "Benutzer gelöscht",
			description: "Der Benutzer wurde erfolgreich gelöscht.",
			color: "success",
		});
		await refresh();
	} else {
		toast.add({
			title: "Benutzerlöschung fehlgeschlagen",
			description: res.message,
			color: "error",
		});
	}
}

function getRoleColor(role: AdminUser["role"]) {
	return Utils.getVisualSettingsForRole(role).color;
}
</script>

<template>
    <UDashboardPanel>
        <template #header>
            <UDashboardNavbar title="Benutzerverwaltung" icon="i-lucide-users">
                <template #right>
                    <UButton
                        label="Neuer Benutzer"
                        icon="i-lucide-user-plus"
                        color="primary"
                        @click="showCreateModal = true"
                    />
                </template>
            </UDashboardNavbar>
        </template>

        <template #body>
            <div class="space-y-6">
                <div
                    v-if="loading"
                    class="flex items-center justify-center py-12"
                >
                    <UIcon
                        name="i-lucide-loader-2"
                        class="animate-spin text-3xl text-slate-400"
                    />
                </div>

                <UTable
                    v-else-if="users?.length"
                    :data="users"
                    :columns="userColumns"
                >
                    <template #id-cell="{ row }">
                        <span class="font-mono text-sm"
                            >#{{ row.original.id }}</span
                        >
                    </template>
                    <template #username-cell="{ row }">
                        <span class="font-medium">{{
                            row.original.username
                        }}</span>
                    </template>
                    <template #email-cell="{ row }">
                        <span class="text-slate-400">{{
                            row.original.email
                        }}</span>
                    </template>
                    <template #role-cell="{ row }">
                        <UBadge
                            v-bind="Utils.getVisualSettingsForRole(row.original.role)"
                            variant="soft"
                        />
                    </template>
                    <template #actions-cell="{ row }">
                        <UDropdownMenu
                            :ui="{ viewport: 'main-bg-color' }"
                            :items="getUserOptionsDropdownItems(row)"
                        >
                            <UButton
                                icon="i-lucide-more-horizontal"
                                variant="ghost"
                                color="neutral"
                                size="xs"
                            />
                        </UDropdownMenu>
                    </template>
                </UTable>

                <UEmpty
                    v-else
                    icon="i-lucide-users"
                    title="Keine Benutzer gefunden"
                    description="Erstellen Sie Ihren ersten Benutzer, um zu beginnen."
                >
                    <template #actions>
                        <UButton
                            label="Benutzer erstellen"
                            color="primary"
                            @click="showCreateModal = true"
                        />
                    </template>
                </UEmpty>
            </div>
        </template>
    </UDashboardPanel>

    <!-- Create User Modal -->
    <DashboardModal
        v-model:open="showCreateModal"
        title="Benutzer erstellen"
        icon="i-lucide-user-plus"
    >
        <UForm
            :state="createState"
            :schema="createSchema"
            class="space-y-4"
            @submit="handleCreate"
        >
            <UFormField label="Benutzername" name="username" required>
                <UInput
                    v-model="createState.username"
                    placeholder="lukas.pohl"
                    class="w-full"
                />
            </UFormField>

            <UFormField label="Anzeigename" name="display_name" required>
                <UInput
                    v-model="createState.display_name"
                    placeholder="Lukas Pohl"
                    class="w-full"
                />
            </UFormField>

            <UFormField label="E-Mail-Adresse" name="email" required>
                <UInput
                    v-model="createState.email"
                    type="email"
                    placeholder="l.pohl@crossover.info"
                    class="w-full"
                />
            </UFormField>

            <UFormField label="Passwort" name="password" required>
                <UInput
                    v-model="createState.password"
                    type="password"
                    placeholder="••••••••"
                    class="w-full"
                />
            </UFormField>

            <UFormField label="Rolle" name="role" required>
                <USelect
                    v-model="createState.role"
                    :items="roleOptions"
                    placeholder="Rolle auswählen"
                    class="w-full"
                />
            </UFormField>

            <div class="flex justify-end gap-2 pt-4">
                <UButton
                    label="Abbrechen"
                    color="neutral"
                    variant="ghost"
                    @click="showCreateModal = false"
                />
                <UButton
                    type="submit"
                    label="Erstellen"
                    color="primary"
                />
            </div>
        </UForm>
    </DashboardModal>

    <!-- Edit User Modal -->
    <DashboardModal
        v-model:open="showEditModal"
        :title="`Benutzer bearbeiten: ${selectedUser?.username}`"
        icon="i-lucide-pencil"
    >
        <div class="space-y-4">
            <UFormField label="Anzeigename">
                <UInput v-model="editForm.display_name" class="w-full" />
            </UFormField>

            <UFormField label="E-Mail-Adresse">
                <UInput v-model="editForm.email" type="email" class="w-full" />
            </UFormField>

            <UFormField label="Rolle">
                <USelect v-model="editForm.role" :items="roleOptions" class="w-full" />
            </UFormField>

            <div class="flex justify-end gap-2 pt-4">
                <UButton
                    label="Abbrechen"
                    color="neutral"
                    variant="ghost"
                    @click="showEditModal = false"
                />
                <UButton
                    label="Speichern"
                    color="primary"
                    @click="submitEdit"
                />
            </div>
        </div>
    </DashboardModal>

    <!-- Password Modal -->
    <DashboardModal
        v-model:open="showPasswordModal"
        :title="`Passwort zurücksetzen: ${selectedUser?.username}`"
        icon="i-lucide-key"
        icon-color="amber"
    >
        <div class="space-y-4">
            <UFormField label="Neues Passwort">
                <UInput
                    v-model="passwordForm.password"
                    type="password"
                    placeholder="••••••••"
                    class="w-full"
                />
            </UFormField>

            <div class="flex justify-end gap-2 pt-4">
                <UButton
                    label="Abbrechen"
                    color="neutral"
                    variant="ghost"
                    @click="showPasswordModal = false"
                />
                <UButton
                    label="Passwort aktualisieren"
                    color="primary"
                    @click="submitPassword"
                />
            </div>
        </div>
    </DashboardModal>
</template>
