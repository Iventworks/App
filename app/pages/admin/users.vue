<script setup lang="ts">
import type { DropdownMenuItem, FormError, FormSubmitEvent, TableColumn } from "@nuxt/ui";
import * as z from "zod";
import type { GetAdminUsersResponses } from "~/api-client";
import {
	zPutAdminUsersByUserIdBody,
	zPutAdminUsersByUserIdPasswordBody,
} from "~/api-client/zod.gen";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type AdminUser = GetAdminUsersResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "Benutzer | Administration | CMP",
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
			color: "error",
		});
		return [] as AdminUser[];
	}
	return result.data;
});

const pendingUsers = computed(() => (users.value ?? []).filter((u) => u.role === "unverified"));
const isSelf = (user: AdminUser) => user.id === currentUser.value?.id;

// --- table ----------------------------------------------------------------------------------

const columns: TableColumn<AdminUser>[] = [
	{ accessorKey: "display_name", header: "Name" },
	{ accessorKey: "email", header: "E-Mail" },
	{ accessorKey: "phone", header: "Telefon" },
	{ accessorKey: "role", header: "Rolle" },
	{ accessorKey: "created_at", header: "Dabei seit" },
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
		type: "select" as const,
		placeholder: "Alle Rollen",
		icon: "i-lucide-shield",
		options: ORG_ROLE_OPTIONS,
	},
];

function rowActions(user: AdminUser): DropdownMenuItem[][] {
	return [
		[
			...(user.role === "unverified"
				? [
						{
							label: "Freischalten",
							icon: "i-lucide-user-check",
							onSelect: () => activate(user),
						},
					]
				: []),
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openEdit(user) },
			{ label: "Passwort setzen", icon: "i-lucide-key-round", onSelect: () => openPassword(user) },
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				disabled: isSelf(user),
				onSelect: () => openDelete(user),
			},
		],
	];
}

async function activate(user: AdminUser) {
	const result = await useAPI((api) =>
		api.putAdminUsersByUserId({ path: { userId: user.id }, body: { role: "volunteer" } }),
	);
	if (!result.success) {
		toast.add({ title: "Freischalten fehlgeschlagen", description: result.message, color: "error" });
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

// --- edit -----------------------------------------------------------------------------------

const editSchema = zPutAdminUsersByUserIdBody.extend({
	username: z.string().trim().min(5, "Mindestens 5 Zeichen").max(40),
	display_name: z.string().trim().min(1, "Anzeigename ist erforderlich").max(64),
	email: z.email("Ungültige E-Mail-Adresse"),
	phone: z.string().max(40),
});
type EditSchema = z.output<typeof editSchema>;

const editOpen = ref(false);
const editTarget = ref<AdminUser | null>(null);
const editSaving = ref(false);
const editState = reactive({
	username: "",
	display_name: "",
	email: "",
	phone: "",
	role: "volunteer" as AdminUser["role"],
});

function openEdit(user: AdminUser) {
	editTarget.value = user;
	Object.assign(editState, {
		username: user.username,
		display_name: user.display_name,
		email: user.email,
		phone: user.phone ?? "",
		role: user.role,
	});
	editOpen.value = true;
}

async function submitEdit(event: FormSubmitEvent<EditSchema>) {
	const target = editTarget.value;
	if (!target) return;
	editSaving.value = true;
	const result = await useAPI((api) =>
		api.putAdminUsersByUserId({
			path: { userId: target.id },
			body: {
				username: event.data.username,
				display_name: event.data.display_name,
				email: event.data.email,
				phone: event.data.phone.trim() || null,
				// Admins cannot change their own role (the API rejects removing your admin role).
				...(isSelf(target) ? {} : { role: event.data.role }),
			},
		}),
	);
	editSaving.value = false;

	if (!result.success) {
		toast.add({
			title: "Speichern fehlgeschlagen",
			description:
				(result.code as number) === 409
					? "Benutzername oder E-Mail-Adresse ist bereits vergeben."
					: result.message,
			color: "error",
		});
		return;
	}
	toast.add({ title: "Benutzer gespeichert", icon: "i-lucide-check", color: "success" });
	editOpen.value = false;
	await refresh();
}

// --- password -------------------------------------------------------------------------------

const passwordSchema = zPutAdminUsersByUserIdPasswordBody.extend({
	password: z
		.string()
		.min(8, "Muss mindestens 8 Zeichen lang sein")
		.max(50, "Darf höchstens 50 Zeichen lang sein")
		.regex(/[A-Z]/, "Muss mindestens einen Großbuchstaben enthalten")
		.regex(/[a-z]/, "Muss mindestens einen Kleinbuchstaben enthalten")
		.regex(/[0-9]/, "Muss mindestens eine Zahl enthalten")
		.regex(/[\W_]/, "Muss mindestens ein Sonderzeichen enthalten"),
	confirm_password: z.string().min(1, "Bitte bestätige das Passwort"),
});
type PasswordSchema = z.output<typeof passwordSchema>;

const passwordOpen = ref(false);
const passwordTarget = ref<AdminUser | null>(null);
const passwordSaving = ref(false);
const passwordState = reactive({ password: "", confirm_password: "" });

function validatePassword(state: Partial<PasswordSchema>): FormError[] {
	if (state.password && state.confirm_password && state.password !== state.confirm_password) {
		return [{ name: "confirm_password", message: "Passwörter stimmen nicht überein" }];
	}
	return [];
}

function openPassword(user: AdminUser) {
	passwordTarget.value = user;
	passwordState.password = "";
	passwordState.confirm_password = "";
	passwordOpen.value = true;
}

async function submitPassword(event: FormSubmitEvent<PasswordSchema>) {
	const target = passwordTarget.value;
	if (!target) return;
	passwordSaving.value = true;
	const result = await useAPI((api) =>
		api.putAdminUsersByUserIdPassword({
			path: { userId: target.id },
			body: { password: event.data.password },
		}),
	);
	passwordSaving.value = false;

	if (!result.success) {
		toast.add({
			title: "Passwort konnte nicht gesetzt werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({
		title: "Passwort gesetzt",
		description: `${target.display_name} wurde auf allen Geräten abgemeldet.`,
		icon: "i-lucide-check",
		color: "success",
	});
	passwordOpen.value = false;
}

// --- delete ---------------------------------------------------------------------------------

const deleteOpen = ref(false);
const deleteTarget = ref<AdminUser | null>(null);

function openDelete(user: AdminUser) {
	if (isSelf(user)) return;
	deleteTarget.value = user;
	deleteOpen.value = true;
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteAdminUsersByUserId({ path: { userId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: `${target.display_name} gelöscht`, icon: "i-lucide-check", color: "success" });
	await refresh();
}
</script>

<template>
	<UDashboardPanel id="admin-users">
		<template #header>
			<DashboardPageHeader
				title="Benutzer"
				icon="i-lucide-users"
				description="Konten, Rollen und Zugänge"
			>
				<template #right>
					<UButton label="Einladen" icon="i-lucide-mail-plus" to="/admin/invitations" />
				</template>
			</DashboardPageHeader>
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
					<template #display_name-cell="{ row }">
						<div class="flex items-center gap-3">
							<UAvatar :text="initials(row.original.display_name)" size="sm" />
							<div class="min-w-0">
								<p class="flex items-center gap-2 font-medium text-white">
									{{ row.original.display_name }}
									<UBadge
										v-if="isSelf(row.original)"
										label="Du"
										color="neutral"
										variant="outline"
										size="sm"
									/>
								</p>
								<p class="text-xs text-slate-500">@{{ row.original.username }}</p>
							</div>
						</div>
					</template>

					<template #email-cell="{ row }">
						<span class="text-slate-300">{{ row.original.email }}</span>
					</template>

					<template #phone-cell="{ row }">
						<span class="text-slate-400">{{ row.original.phone || "–" }}</span>
					</template>

					<template #role-cell="{ row }">
						<UBadge
							:label="getRoleLabel(row.original.role)"
							:color="getRoleColor(row.original.role)"
							variant="subtle"
						/>
					</template>

					<template #created_at-cell="{ row }">
						<span class="text-slate-400">{{ formatDay(row.original.created_at) }}</span>
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
								<UButton
									icon="i-lucide-ellipsis-vertical"
									color="neutral"
									variant="ghost"
									size="xs"
									aria-label="Aktionen"
								/>
							</UDropdownMenu>
						</div>
					</template>
				</DashboardDataTable>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="editOpen"
		:title="`${editTarget?.display_name ?? 'Benutzer'} bearbeiten`"
		icon="i-lucide-pencil"
	>
		<UForm :schema="editSchema" :state="editState" class="space-y-4" @submit="submitEdit">
			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Anzeigename" name="display_name" required>
					<UInput v-model="editState.display_name" class="w-full" />
				</UFormField>
				<UFormField label="Benutzername" name="username" required>
					<UInput v-model="editState.username" class="w-full" />
				</UFormField>
				<UFormField label="E-Mail" name="email" required>
					<UInput v-model="editState.email" type="email" class="w-full" />
				</UFormField>
				<UFormField label="Telefon" name="phone">
					<UInput v-model="editState.phone" type="tel" class="w-full" />
				</UFormField>
				<UFormField
					label="Rolle"
					name="role"
					class="sm:col-span-2"
					:help="editTarget && isSelf(editTarget) ? 'Deine eigene Rolle kannst du nicht ändern.' : undefined"
				>
					<USelect
						v-model="editState.role"
						:items="ORG_ROLE_OPTIONS"
						:disabled="!!editTarget && isSelf(editTarget)"
						class="w-full"
					/>
				</UFormField>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="editOpen = false" />
				<UButton type="submit" label="Speichern" :loading="editSaving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardModal
		v-model:open="passwordOpen"
		:title="`Passwort für ${passwordTarget?.display_name ?? ''} setzen`"
		icon="i-lucide-key-round"
		icon-color="amber"
		description="Die Person wird auf allen Geräten abgemeldet."
	>
		<UForm
			:schema="passwordSchema"
			:state="passwordState"
			:validate="validatePassword"
			class="space-y-4"
			@submit="submitPassword"
		>
			<UFormField
				label="Neues Passwort"
				name="password"
				description="8–50 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen."
				required
			>
				<UInput v-model="passwordState.password" type="password" autocomplete="new-password" class="w-full" />
			</UFormField>
			<UFormField label="Passwort bestätigen" name="confirm_password" required>
				<UInput
					v-model="passwordState.confirm_password"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="passwordOpen = false" />
				<UButton type="submit" label="Passwort setzen" :loading="passwordSaving" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Benutzer löschen"
		:warning-text="`Das Konto von ${deleteTarget?.display_name} wird mit allen persönlichen Daten gelöscht. Einträge in Events bleiben ohne Namen erhalten.`"
		:on-delete="confirmDelete"
	/>
</template>
