<script setup lang="ts">
/**
 * "Allgemein" of one API key (style guide template `dashboard/apikeys/[api_key_id]/index.vue`):
 * the create form on `/new`, the read-only details otherwise, the one-time token dialog after
 * creating, and the danger zone.
 */
import * as z from "zod";
import type { PostAccountApikeysResponses } from "~/api-client";
import { zPostAccountApikeysBody } from "~/api-client/zod.gen";
import { Utils } from "~/utils";
import type { APIKey, NewAPIKey } from "~/utils/types";

type Expiry = NonNullable<NewAPIKey["expires_at"]> | "never";

const toast = useToast();

const apiKey = useSubrouterInjectedData<APIKey, NewAPIKey>("api_key", true).inject();

// The API takes `null` for "never"; a select item needs a non-null value.
const formState = ref<{ description: string; expires_at: Expiry }>(
	apiKey.isNew
		? {
				description: apiKey.data.value.description,
				expires_at: apiKey.data.value.expires_at ?? "never",
			}
		: { description: apiKey.data.value.description, expires_at: "never" },
);

// Referenced here (not only in the template) so Biome keeps it a value import.
const formSchema = apiKey.isNew
	? zPostAccountApikeysBody.extend({
			description: z.string().trim().min(1, "Beschreibung ist erforderlich").max(255),
			expires_at: z.enum(["7d", "30d", "90d", "180d", "365d", "never"]),
		})
	: undefined;

const expiryOptions: { label: string; value: Expiry }[] = [
	{ label: "7 Tage", value: "7d" },
	{ label: "30 Tage", value: "30d" },
	{ label: "90 Tage", value: "90d" },
	{ label: "180 Tage", value: "180d" },
	{ label: "1 Jahr", value: "365d" },
	{ label: "Läuft nicht ab", value: "never" },
];

const creating = ref(false);
const createdKey = ref<PostAccountApikeysResponses["200"]["data"] | null>(null);
const revealToken = ref(false);

async function onCreate() {
	creating.value = true;

	const result = await useAPI((api) =>
		api.postAccountApikeys({
			body: {
				description: formState.value.description,
				expires_at: formState.value.expires_at === "never" ? null : formState.value.expires_at,
			},
		}),
	);

	creating.value = false;

	if (result.success) {
		toast.add({
			title: "API-Schlüssel erstellt",
			description: "Kopiere ihn jetzt – er wird nur einmal angezeigt.",
			icon: "i-lucide-check",
			color: "success",
		});
		createdKey.value = result.data;
	} else {
		toast.add({
			title: "API-Schlüssel konnte nicht erstellt werden",
			description: result.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
	}
}

async function copyToken() {
	if (!createdKey.value) return;
	const ok = await Utils.copyToClipboard(createdKey.value.token);
	toast.add(
		ok
			? { title: "In die Zwischenablage kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: {
					title: "Kopieren nicht möglich",
					description: "Bitte markiere den Schlüssel und kopiere ihn manuell.",
					color: "warning",
				},
	);
}

/** Close the one-time token dialog and go to the new key's page. */
async function onTokenDialogClose() {
	if (!createdKey.value) return;
	const id = createdKey.value.id;
	createdKey.value = null;
	await navigateTo(`/settings/api-keys/${id}`);
}

const deleteConfirmOpen = ref(false);

async function onDeleteApiKey() {
	if (apiKey.isNew) return;
	const apiKeyID = apiKey.data.value.id;

	const res = await useAPI((api) => api.deleteAccountApikeysByApiKeyId({ path: { apiKeyID } }));
	if (!res.success) {
		toast.add({
			title: "Löschen fehlgeschlagen",
			description: res.message,
			icon: "i-lucide-alert-circle",
			color: "error",
		});
		throw new Error(res.message);
	}

	toast.add({ title: "API-Schlüssel gelöscht", icon: "i-lucide-check", color: "success" });
	await navigateTo("/settings/api-keys");
}

function isExpired(key: APIKey) {
	return key.expires_at !== null && key.expires_at < Date.now();
}

const headerTexts = computed(() =>
	apiKey.isNew
		? {
				title: "Neuen API-Schlüssel anlegen",
				description:
					"Ein API-Schlüssel handelt mit deinen Rechten. Gib ihn nur an Programme weiter, denen du vertraust.",
			}
		: {
				title: `API-Schlüssel ${apiKey.data.value.id}`,
				description: "Details ansehen oder den Schlüssel löschen.",
			},
);
</script>

<template>
	<div class="mx-auto w-full space-y-6 lg:w-3xl">
		<div>
			<h2 class="text-xl font-semibold text-white">{{ headerTexts.title }}</h2>
			<p class="mt-1 text-sm text-slate-400">{{ headerTexts.description }}</p>
		</div>

		<DashboardSectionCard
			title="Schlüssel"
			description="API-Schlüssel lassen sich nicht bearbeiten – lege stattdessen einen neuen an."
			icon="i-lucide-info"
		>
			<UForm
				class="divide-y divide-slate-800"
				:schema="formSchema"
				:state="formState"
				:disabled="!apiKey.isNew"
				@submit="onCreate"
			>
				<UFormField
					name="description"
					label="Beschreibung"
					description="Wofür ist der Schlüssel, z. B. „Teilnehmer-Import“?"
					:required="apiKey.isNew"
					eager-validation
					class="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
					:ui="{ container: 'w-full' }"
				>
					<UTextarea
						v-model="formState.description"
						placeholder="Keine Beschreibung"
						:rows="3"
						autoresize
						class="w-full"
					/>
				</UFormField>

				<UFormField
					name="expires_at"
					label="Gültigkeit"
					description="Ab wann der Schlüssel nicht mehr funktioniert."
					class="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
					:ui="{ container: 'w-full sm:w-60' }"
				>
					<USelect
						v-if="apiKey.isNew"
						v-model="formState.expires_at"
						:items="expiryOptions"
						class="w-full"
					/>
					<UInput
						v-else
						:model-value="apiKey.data.value.expires_at ? formatDate(apiKey.data.value.expires_at) : 'Läuft nicht ab'"
						disabled
						class="w-full"
					/>
				</UFormField>

				<template v-if="!apiKey.isNew">
					<UFormField
						name="created_at"
						label="Erstellt"
						class="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
						:ui="{ container: 'w-full sm:w-60' }"
					>
						<UInput :model-value="formatDate(apiKey.data.value.created_at)" disabled class="w-full" />
					</UFormField>

					<UFormField
						name="status"
						label="Status"
						class="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
					>
						<UBadge v-if="isExpired(apiKey.data.value)" color="error" variant="soft">Abgelaufen</UBadge>
						<UBadge v-else color="success" variant="soft">Aktiv</UBadge>
					</UFormField>
				</template>

				<div v-if="apiKey.isNew" class="pt-4">
					<UButton
						label="Schlüssel anlegen"
						color="primary"
						type="submit"
						:loading="creating"
						icon="i-lucide-plus-circle"
					/>
				</div>
			</UForm>
		</DashboardSectionCard>

		<DashboardSectionCard
			v-if="!apiKey.isNew"
			title="Gefahrenzone"
			description="Nicht umkehrbare Aktionen"
			icon="i-lucide-alert-triangle"
			tone="danger"
		>
			<div class="flex flex-col gap-4 md:flex-row md:items-center">
				<div class="flex-1">
					<h4 class="font-medium text-white">Schlüssel löschen</h4>
					<p class="mt-1 text-sm text-slate-400">Alles, was diesen Schlüssel nutzt, funktioniert sofort nicht mehr.</p>
				</div>
				<UButton
					label="Schlüssel löschen"
					color="error"
					variant="soft"
					icon="i-lucide-trash-2"
					@click="deleteConfirmOpen = true"
				/>
			</div>
		</DashboardSectionCard>

		<DashboardDeleteModal
			v-if="!apiKey.isNew"
			v-model:open="deleteConfirmOpen"
			title="Schlüssel löschen"
			:warning-text="`Der Schlüssel „${apiKey.data.value.description}“ funktioniert danach nicht mehr. Das lässt sich nicht rückgängig machen.`"
			:require-confirm-text="false"
			:on-delete="onDeleteApiKey"
		/>

		<!-- One-time token dialog -->
		<DashboardModal
			:open="!!createdKey"
			title="API-Schlüssel erstellt"
			description="Kopiere deinen neuen Schlüssel jetzt. Er wird nicht noch einmal angezeigt."
			icon="i-lucide-check-circle"
			icon-color="emerald"
			:dismissible="false"
			:close="false"
		>
			<div class="space-y-4">
				<div class="rounded-lg border border-red-900/50 bg-red-950/50 p-4">
					<p class="text-sm text-red-300">
						<strong>Achtung:</strong>
						Der Schlüssel wird nur einmal angezeigt. Bewahre ihn sicher auf.
					</p>
				</div>

				<UFormField label="API-Schlüssel">
					<UInput
						:model-value="createdKey?.token"
						readonly
						:type="revealToken ? 'text' : 'password'"
						class="w-full font-mono"
						:ui="{ trailing: 'pe-1' }"
					>
						<template #trailing>
							<UButton
								color="neutral"
								variant="link"
								size="sm"
								:icon="revealToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
								:aria-label="revealToken ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'"
								:aria-pressed="revealToken"
								@click="revealToken = !revealToken"
							/>
							<UButton
								color="neutral"
								variant="link"
								size="sm"
								icon="i-lucide-copy"
								aria-label="Schlüssel kopieren"
								@click="copyToken"
							/>
						</template>
					</UInput>
				</UFormField>

				<p class="text-xs text-slate-500">
					Verwendung: <code class="text-slate-300">Authorization: Bearer &lt;Schlüssel&gt;</code>
				</p>
			</div>

			<template #footer>
				<UButton label="Fertig" color="primary" @click="onTokenDialogClose" />
			</template>
		</DashboardModal>
	</div>
</template>
