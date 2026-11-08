<script setup lang="ts">
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { GetAccountApikeysResponses } from "~/api-client";
import { zPostAccountApikeysBody } from "~/api-client/zod.gen";
import { Utils } from "~/utils";

type ApiKey = GetAccountApikeysResponses["200"]["data"][number];
type Expiry = "7d" | "30d" | "90d" | "180d" | "365d" | "never";

definePageMeta({ layout: "dashboard" });

useSeoMeta({
	title: "API-Schlüssel | Einstellungen | CMP",
	description: "API-Schlüssel für Integrationen verwalten",
});

const toast = useToast();

const {
	data: apiKeys,
	loading,
	refresh,
} = await useAPIAsyncData("account-apikeys", async () => {
	const result = await useAPI((api) => api.getAccountApikeys({}));
	if (!result.success) {
		toast.add({
			title: "API-Schlüssel konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as ApiKey[];
	}
	return result.data;
});

// --- create ---------------------------------------------------------------------------------

const EXPIRY_OPTIONS: { label: string; value: Expiry }[] = [
	{ label: "7 Tage", value: "7d" },
	{ label: "30 Tage", value: "30d" },
	{ label: "90 Tage", value: "90d" },
	{ label: "180 Tage", value: "180d" },
	{ label: "1 Jahr", value: "365d" },
	{ label: "Läuft nicht ab", value: "never" },
];

// The API takes `null` for "never"; the select needs a non-null value.
const createSchema = zPostAccountApikeysBody.extend({
	description: z.string().trim().min(1, "Beschreibung ist erforderlich").max(255),
	expires_at: z.enum(["7d", "30d", "90d", "180d", "365d", "never"]),
});
type CreateSchema = z.output<typeof createSchema>;

const createOpen = ref(false);
const creating = ref(false);
const createState = reactive<{ description: string; expires_at: Expiry }>({
	description: "",
	expires_at: "90d",
});

const createdToken = ref<string | null>(null);
const tokenOpen = ref(false);

function openCreate() {
	createState.description = "";
	createState.expires_at = "90d";
	createOpen.value = true;
}

async function onCreate(event: FormSubmitEvent<CreateSchema>) {
	creating.value = true;
	const result = await useAPI((api) =>
		api.postAccountApikeys({
			body: {
				description: event.data.description,
				expires_at: event.data.expires_at === "never" ? null : event.data.expires_at,
			},
		}),
	);
	creating.value = false;

	if (!result.success) {
		toast.add({
			title: "API-Schlüssel konnte nicht erstellt werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	createOpen.value = false;
	createdToken.value = result.data.token;
	tokenOpen.value = true;
	await refresh();
}

async function copyToken() {
	if (!createdToken.value) return;
	const ok = await Utils.copyToClipboard(createdToken.value);
	toast.add(
		ok
			? { title: "In die Zwischenablage kopiert", icon: "i-lucide-check", color: "success" }
			: {
					title: "Kopieren nicht möglich",
					description: "Bitte markiere den Schlüssel manuell.",
					color: "warning",
				},
	);
}

watch(tokenOpen, (open) => {
	// Never keep the secret around after the dialog closes.
	if (!open) createdToken.value = null;
});

// --- delete ---------------------------------------------------------------------------------

const deleteTarget = ref<ApiKey | null>(null);
const deleteOpen = ref(false);

function openDelete(key: ApiKey) {
	deleteTarget.value = key;
	deleteOpen.value = true;
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteAccountApikeysByApiKeyId({ path: { apiKeyID: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "API-Schlüssel gelöscht", icon: "i-lucide-check", color: "success" });
	await refresh();
}

function isExpired(key: ApiKey) {
	return key.expires_at !== null && key.expires_at < Date.now();
}
</script>

<template>
	<UDashboardPanel id="settings-api-keys" :ui="{ body: 'lg:py-12' }">
		<template #header>
			<DashboardPageHeader
				title="API-Schlüssel"
				icon="i-lucide-key"
				description="Zugriff für Skripte und Integrationen"
			>
				<template #right>
					<UButton label="Neuer Schlüssel" icon="i-lucide-plus" @click="openCreate" />
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full lg:max-w-3xl">
				<UAlert
					icon="i-lucide-info"
					color="neutral"
					variant="subtle"
					title="Wofür API-Schlüssel?"
					description="Ein API-Schlüssel handelt mit deinen Rechten. Gib ihn nur an Programme weiter, denen du vertraust, und lösche ihn, wenn du ihn nicht mehr brauchst."
				/>

				<DashboardSectionCard title="Deine Schlüssel" icon="i-lucide-key-round" flush>
					<div v-if="loading && !apiKeys" class="flex justify-center py-8">
						<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
					</div>

					<UEmpty
						v-else-if="!apiKeys?.length"
						icon="i-lucide-key"
						title="Noch keine API-Schlüssel"
						description="Lege einen Schlüssel an, um die CMP-API aus eigenen Programmen zu nutzen."
						variant="naked"
						class="py-8"
					>
						<template #actions>
							<UButton label="Schlüssel anlegen" icon="i-lucide-plus" @click="openCreate" />
						</template>
					</UEmpty>

					<ul v-else class="divide-y divide-slate-800">
						<li
							v-for="key in apiKeys"
							:key="key.id"
							class="flex flex-wrap items-center gap-3 px-6 py-4"
						>
							<div class="flex size-9 items-center justify-center rounded-lg bg-slate-800">
								<UIcon name="i-lucide-key-round" class="size-4 text-primary-400" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="flex items-center gap-2 truncate text-sm font-medium text-white">
									{{ key.description }}
									<UBadge
										v-if="isExpired(key)"
										label="Abgelaufen"
										color="error"
										variant="subtle"
										size="sm"
									/>
								</p>
								<p class="text-xs text-slate-500">
									Erstellt {{ formatDate(key.created_at) }} ·
									{{ key.expires_at ? `läuft ab ${formatDate(key.expires_at)}` : "läuft nicht ab" }}
								</p>
							</div>
							<UButton
								icon="i-lucide-trash-2"
								color="error"
								variant="ghost"
								size="sm"
								aria-label="Schlüssel löschen"
								@click="openDelete(key)"
							/>
						</li>
					</ul>
				</DashboardSectionCard>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<DashboardModal v-model:open="createOpen" title="Neuer API-Schlüssel" icon="i-lucide-key">
		<UForm :schema="createSchema" :state="createState" class="space-y-4" @submit="onCreate">
			<UFormField
				label="Beschreibung"
				name="description"
				description="Wofür ist der Schlüssel, z. B. „Teilnehmer-Import“?"
				required
			>
				<UInput v-model="createState.description" class="w-full" autofocus />
			</UFormField>
			<UFormField label="Gültigkeit" name="expires_at" required>
				<USelect v-model="createState.expires_at" :items="EXPIRY_OPTIONS" class="w-full" />
			</UFormField>
			<div class="flex justify-end gap-2 pt-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="createOpen = false" />
				<UButton type="submit" label="Erstellen" :loading="creating" />
			</div>
		</UForm>
	</DashboardModal>

	<DashboardModal
		v-model:open="tokenOpen"
		title="Dein neuer API-Schlüssel"
		icon="i-lucide-key-round"
		icon-color="emerald"
	>
		<div class="space-y-4">
			<UAlert
				icon="i-lucide-triangle-alert"
				color="warning"
				variant="subtle"
				title="Nur jetzt sichtbar"
				description="Kopiere den Schlüssel und bewahre ihn sicher auf. Er wird nicht noch einmal angezeigt."
			/>
			<div class="flex items-center gap-2">
				<UInput :model-value="createdToken ?? ''" readonly class="w-full font-mono" />
				<UButton icon="i-lucide-copy" aria-label="Kopieren" @click="copyToken" />
			</div>
			<p class="text-xs text-slate-500">
				Verwendung: <code class="text-slate-300">Authorization: Bearer &lt;Schlüssel&gt;</code>
			</p>
		</div>

		<template #footer>
			<UButton label="Fertig" @click="tokenOpen = false" />
		</template>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Schlüssel löschen"
		:warning-text="`Der Schlüssel „${deleteTarget?.description}“ funktioniert danach nicht mehr.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
