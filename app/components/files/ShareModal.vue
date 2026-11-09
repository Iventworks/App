<script setup lang="ts">
/**
 * Share links of one file or folder: the existing links (copy, edit, delete) and a form for a new
 * one — what the link allows (presets), expiry, optional password and an internal note.
 */
import { Utils } from "~/utils";
import type { FileItem, FileShare, SharePermissions } from "~/utils/types";

const props = defineProps<{ item: FileItem | null }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const instance = useInstance();

type PresetKey = "view" | "upload" | "edit" | "full" | "dropbox" | "file-edit";
interface Preset {
	key: PresetKey;
	label: string;
	description: string;
	icon: string;
	permissions: SharePermissions;
}

const FOLDER_PRESETS: Preset[] = [
	{
		key: "view",
		label: "Nur ansehen",
		description: "Ansehen und herunterladen",
		icon: "i-lucide-eye",
		permissions: { read: true, upload: false, edit: false, delete: false },
	},
	{
		key: "upload",
		label: "Ansehen & hochladen",
		description: "Dazu Dateien und Ordner hinzufügen",
		icon: "i-lucide-upload",
		permissions: { read: true, upload: true, edit: false, delete: false },
	},
	{
		key: "edit",
		label: "Bearbeiten",
		description: "Dazu umbenennen und Dateien ersetzen",
		icon: "i-lucide-pencil",
		permissions: { read: true, upload: true, edit: true, delete: false },
	},
	{
		key: "full",
		label: "Vollzugriff",
		description: "Dazu Dateien und Ordner löschen",
		icon: "i-lucide-shield",
		permissions: { read: true, upload: true, edit: true, delete: true },
	},
	{
		key: "dropbox",
		label: "Nur hochladen",
		description: "Dateiablage: hochladen, ohne den Inhalt zu sehen",
		icon: "i-lucide-inbox",
		permissions: { read: false, upload: true, edit: false, delete: false },
	},
];
const FILE_PRESETS: Preset[] = [
	{
		key: "view",
		label: "Nur ansehen",
		description: "Ansehen und herunterladen",
		icon: "i-lucide-eye",
		permissions: { read: true, upload: false, edit: false, delete: false },
	},
	{
		key: "file-edit",
		label: "Bearbeiten",
		description: "Dazu eine neue Fassung hochladen",
		icon: "i-lucide-pencil",
		permissions: { read: true, upload: false, edit: true, delete: false },
	},
];

const presets = computed(() => (props.item?.kind === "folder" ? FOLDER_PRESETS : FILE_PRESETS));

function presetFor(permissions: SharePermissions): Preset | undefined {
	return presets.value.find(
		(preset) =>
			preset.permissions.read === permissions.read &&
			preset.permissions.upload === permissions.upload &&
			preset.permissions.edit === permissions.edit &&
			preset.permissions.delete === permissions.delete,
	);
}

// --- links ------------------------------------------------------------------------------------

const shares = ref<FileShare[]>([]);
const loading = ref(false);

async function load() {
	if (!props.item) return;
	loading.value = true;
	const result = await useAPI((api) =>
		api.getFilesByFileIdShares({ path: { fileId: props.item!.id } }),
	);
	loading.value = false;
	if (result.success) {
		shares.value = result.data;
	} else {
		toast.add({
			title: "Freigaben konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
	}
}

watch(open, (isOpen) => {
	if (isOpen) {
		editing.value = null;
		formOpen.value = false;
		void load();
	}
});

async function copy(url: string) {
	const ok = await Utils.copyToClipboard(url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: { title: "Kopieren nicht möglich", description: url, color: "warning" },
	);
}

async function remove(share: FileShare) {
	if (!props.item) return;
	const result = await useAPI((api) =>
		api.deleteFilesByFileIdSharesByShareId({ path: { fileId: props.item!.id, shareId: share.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: "Link gelöscht",
		description: "Er funktioniert ab sofort nicht mehr.",
		icon: "i-lucide-check",
		color: "success",
	});
	await load();
	emit("changed");
}

// --- form (new link or edit) --------------------------------------------------------------------

const formOpen = ref(false);
const editing = ref<FileShare | null>(null);
const saving = ref(false);
const form = reactive({
	preset: "view" as PresetKey,
	label: "",
	/** `YYYY-MM-DD`; "" = never. */
	expires: "",
	passwordMode: "none" as "none" | "keep" | "set",
	password: "",
});

function defaultExpiry() {
	const days = instance.value?.org?.share_default_expiry_days;
	if (!days) return "";
	const date = new Date();
	date.setDate(date.getDate() + days);
	return toDayString(date);
}

function openNew() {
	editing.value = null;
	form.preset = "view";
	form.label = "";
	form.expires = defaultExpiry();
	form.passwordMode = "none";
	form.password = "";
	formOpen.value = true;
}

function openEdit(share: FileShare) {
	editing.value = share;
	form.preset = presetFor(share.permissions)?.key ?? "view";
	form.label = share.label ?? "";
	form.expires = share.expires_at ? toDayString(share.expires_at) : "";
	form.passwordMode = share.has_password ? "keep" : "none";
	form.password = "";
	formOpen.value = true;
}

/** End of the chosen day, local time. */
function expiresAt(): number | null {
	if (!form.expires) return null;
	const day = parseDay(form.expires);
	day.setHours(23, 59, 59, 999);
	return day.getTime();
}

const passwordValid = computed(() => form.passwordMode !== "set" || form.password.length >= 4);

async function save() {
	if (!props.item || !passwordValid.value) return;
	const permissions = presets.value.find((preset) => preset.key === form.preset)?.permissions;
	if (!permissions) return;
	saving.value = true;

	const fileId = props.item.id;
	const common = { permissions, label: form.label.trim() || null, expires_at: expiresAt() };
	let result: { success: boolean; message: string; data?: unknown };
	if (editing.value) {
		const shareId = editing.value.id;
		const password =
			form.passwordMode === "set" ? form.password : form.passwordMode === "none" ? null : undefined;
		result = await useAPI((api) =>
			api.putFilesByFileIdSharesByShareId({
				path: { fileId, shareId },
				body: { ...common, ...(password !== undefined ? { password } : {}) },
			}),
		);
	} else {
		result = await useAPI((api) =>
			api.postFilesByFileIdShares({
				path: { fileId },
				body: { ...common, ...(form.passwordMode === "set" ? { password: form.password } : {}) },
			}),
		);
	}
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	if (!editing.value) await copy((result.data as FileShare).url);
	formOpen.value = false;
	editing.value = null;
	await load();
	emit("changed");
}

function expiryText(share: FileShare) {
	if (share.expired) return `Abgelaufen am ${formatDate(share.expires_at)}`;
	return share.expires_at ? `Gültig bis ${formatDate(share.expires_at)}` : "Läuft nicht ab";
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="item ? `„${item.name}“ teilen` : 'Teilen'"
		description="Links für Menschen ohne Konto. Wer den Link hat, kann damit tun, was er erlaubt."
		icon="i-lucide-share-2"
		width="sm:max-w-2xl"
		:loading="loading && !shares.length"
	>
		<div class="space-y-4">
			<template v-if="!formOpen">
				<div v-if="!shares.length" class="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
					Noch kein Link. {{ item?.kind === "folder" ? "Ein Ordner-Link öffnet alles, was darin liegt." : "" }}
				</div>

				<ul v-else class="space-y-2">
					<li
						v-for="share in shares"
						:key="share.id"
						class="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center"
						:class="share.expired ? 'opacity-60' : ''"
					>
						<div class="min-w-0 flex-1 space-y-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-medium text-white">{{ share.label || "Link" }}</span>
								<UBadge :label="presetFor(share.permissions)?.label ?? 'Eigene Rechte'" color="neutral" variant="subtle" size="sm" />
								<UBadge v-if="share.has_password" label="Passwort" icon="i-lucide-lock" color="neutral" variant="subtle" size="sm" />
								<UBadge v-if="share.expired" label="Abgelaufen" color="error" variant="soft" size="sm" />
							</div>
							<p class="text-xs text-slate-500">
								{{ expiryText(share) }} ·
								{{ share.access_count }}× geöffnet<template v-if="share.last_accessed_at">, zuletzt {{ formatRelative(share.last_accessed_at) }}</template>
								<template v-if="share.created_by"> · von {{ share.created_by.display_name }}</template>
							</p>
						</div>
						<div class="flex gap-1">
							<UButton icon="i-lucide-copy" label="Kopieren" size="sm" color="neutral" variant="subtle" :disabled="share.expired" @click="copy(share.url)" />
							<UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="ghost" aria-label="Link bearbeiten" @click="openEdit(share)" />
							<UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" aria-label="Link löschen" @click="remove(share)" />
						</div>
					</li>
				</ul>
			</template>

			<form v-else id="share-form" class="space-y-5" @submit.prevent="save">
				<UFormField label="Was der Link erlaubt">
					<div class="grid gap-2 sm:grid-cols-2">
						<button
							v-for="preset in presets"
							:key="preset.key"
							type="button"
							class="flex items-start gap-3 rounded-lg border p-3 text-left transition"
							:class="form.preset === preset.key ? 'border-primary bg-primary/10' : 'border-slate-800 hover:border-slate-600'"
							:aria-pressed="form.preset === preset.key"
							@click="form.preset = preset.key"
						>
							<UIcon :name="preset.icon" class="mt-0.5 size-5 shrink-0 text-primary-400" />
							<span>
								<span class="block text-sm font-medium text-white">{{ preset.label }}</span>
								<span class="block text-xs text-slate-400">{{ preset.description }}</span>
							</span>
						</button>
					</div>
				</UFormField>

				<div class="grid gap-4 sm:grid-cols-2">
					<UFormField label="Gültig bis" description="Leer: läuft nicht ab">
						<FormDatePicker v-model="form.expires" :min="toDayString()" clearable class="w-full" />
					</UFormField>
					<UFormField label="Notiz (nur intern)" description="Z. B. „Für die Eltern“">
						<UInput v-model="form.label" maxlength="100" class="w-full" />
					</UFormField>
				</div>

				<UFormField label="Passwort" :error="passwordValid ? undefined : 'Mindestens 4 Zeichen'">
					<div class="space-y-2">
						<URadioGroup
							v-model="form.passwordMode"
							orientation="horizontal"
							:items="[
								{ label: 'Ohne', value: 'none' },
								...(editing?.has_password ? [{ label: 'Beibehalten', value: 'keep' }] : []),
								{ label: editing?.has_password ? 'Neues Passwort' : 'Mit Passwort', value: 'set' },
							]"
						/>
						<UInput v-if="form.passwordMode === 'set'" v-model="form.password" type="password" autocomplete="new-password" placeholder="Mindestens 4 Zeichen" class="w-full sm:w-72" />
					</div>
				</UFormField>
			</form>
		</div>

		<template #footer>
			<template v-if="formOpen">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
				<UButton
					:label="editing ? 'Speichern' : 'Link erstellen & kopieren'"
					color="primary"
					type="submit"
					form="share-form"
					:loading="saving"
					:disabled="!passwordValid"
				/>
			</template>
			<template v-else>
				<UButton label="Schließen" color="neutral" variant="ghost" @click="open = false" />
				<UButton label="Neuer Link" icon="i-lucide-link" color="primary" @click="openNew" />
			</template>
		</template>
	</DashboardModal>
</template>
