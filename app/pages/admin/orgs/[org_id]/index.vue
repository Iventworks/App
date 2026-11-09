<script setup lang="ts">
/**
 * "Allgemein" of one org (system admins): name and colour, the numbers, inviting an admin (e.g.
 * when the org's admins lost access), and deleting the org with all its data.
 */
import * as z from "zod";
import { DEFAULT_BRAND } from "~/composables/stores/useInstanceStore";
import { Utils } from "~/utils";
import type { OrgPrimaryColor, SystemOrg } from "~/utils/types";

const toast = useToast();
const injected = useSubrouterInjectedData<SystemOrg>("system_org").inject();
const org = computed(() => injected.data.value);

const formState = reactive<{ display_name: string; primary_color: OrgPrimaryColor }>({
	display_name: org.value.display_name,
	primary_color: org.value.primary_color,
});
const formSchema = z.object({
	display_name: z.string().trim().min(2, "Mindestens 2 Zeichen").max(80, "Höchstens 80 Zeichen"),
});
const dirty = computed(
	() =>
		formState.display_name.trim() !== org.value.display_name ||
		formState.primary_color !== org.value.primary_color,
);

const saving = ref(false);
async function onSave() {
	saving.value = true;
	const result = await useAPI((api) =>
		api.putSystemOrgsByOrgId({
			path: { orgId: org.value.id },
			body: { display_name: formState.display_name.trim(), primary_color: formState.primary_color },
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Organisation gespeichert", icon: "i-lucide-check", color: "success" });
	await injected.refresh();
}

// --- invite an admin ---------------------------------------------------------------------------

const inviteOpen = ref(false);
const inviting = ref(false);
const inviteState = reactive({ email: "", display_name: "" });
const inviteSchema = z.object({ email: z.email("Keine gültige E-Mail-Adresse") });
const issued = ref<{ invite_url: string; email_sent: boolean; email: string } | null>(null);

async function onInvite() {
	inviting.value = true;
	const result = await useAPI((api) =>
		api.postSystemOrgsByOrgIdInvitations({
			path: { orgId: org.value.id },
			body: {
				email: inviteState.email.trim(),
				...(inviteState.display_name.trim() ? { display_name: inviteState.display_name.trim() } : {}),
			},
		}),
	);
	inviting.value = false;
	if (!result.success) {
		toast.add({ title: "Einladung fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	inviteOpen.value = false;
	inviteState.email = "";
	inviteState.display_name = "";
	issued.value = result.data;
}

async function copyLink() {
	if (!issued.value) return;
	const ok = await Utils.copyToClipboard(issued.value.invite_url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: { title: "Kopieren nicht möglich", color: "warning" },
	);
}

// --- delete ------------------------------------------------------------------------------------

const deleteOpen = ref(false);
async function onDelete() {
	const result = await useAPI((api) =>
		api.deleteSystemOrgsByOrgId({ path: { orgId: org.value.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({
		title: `${org.value.display_name} gelöscht`,
		icon: "i-lucide-check",
		color: "success",
	});
	await navigateTo("/admin/orgs");
}
</script>

<template>
	<div class="mx-auto w-full space-y-6 lg:w-3xl">
		<div class="flex items-center gap-4">
			<img :src="org.icon_url ?? DEFAULT_BRAND.icon" alt="" class="size-12 rounded-lg object-contain" />
			<div class="min-w-0">
				<h2 class="truncate text-xl font-semibold text-white">{{ org.display_name }}</h2>
				<ULink :to="org.url" external target="_blank" class="font-mono text-sm text-primary-400 hover:underline">
					{{ org.primary_domain ?? org.default_domain }}
				</ULink>
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<DashboardStatCard label="Benutzer" :value="org.user_count" icon="i-lucide-users" />
			<DashboardStatCard label="Freizeiten & Events" :value="org.event_count" icon="i-lucide-tent" />
			<DashboardStatCard label="Eigene Domains" :value="org.domain_count" icon="i-lucide-globe" :to="`/admin/orgs/${org.id}/domains`" />
		</div>

		<DashboardSectionCard title="Organisation" description="Name und Farbe" icon="i-lucide-building">
			<UForm class="divide-y divide-slate-800" :schema="formSchema" :state="formState" @submit="onSave">
				<UFormField
					name="display_name"
					label="Name"
					required
					eager-validation
					class="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
					:ui="{ container: 'w-full sm:w-72' }"
				>
					<UInput v-model="formState.display_name" class="w-full" />
				</UFormField>
				<UFormField
					name="slug"
					label="Adresse"
					description="Lässt sich nicht ändern."
					class="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
					:ui="{ container: 'w-full sm:w-72' }"
				>
					<UInput :model-value="org.default_domain" disabled class="w-full font-mono" />
				</UFormField>
				<UFormField name="primary_color" label="Hauptfarbe" class="flex flex-col gap-3 py-4">
					<OrgColorPicker v-model="formState.primary_color" />
				</UFormField>
				<div class="flex justify-end pt-4">
					<UButton label="Speichern" color="primary" type="submit" icon="i-lucide-save" :loading="saving" :disabled="!dirty" />
				</div>
			</UForm>
		</DashboardSectionCard>

		<DashboardSectionCard
			title="Admins"
			description="Die Organisation verwaltet ihre Benutzer selbst"
			icon="i-lucide-user-plus"
		>
			<template #actions>
				<UButton label="Admin einladen" icon="i-lucide-mail-plus" color="primary" size="sm" @click="inviteOpen = true" />
			</template>
			<p class="text-sm text-slate-400">
				Lade jemanden als Admin ein, z. B. für eine neue Organisation oder wenn ihre Admins keinen Zugang mehr haben.
				Die Einladung gilt 7 Tage.
			</p>
		</DashboardSectionCard>

		<DashboardSectionCard title="Gefahrenzone" description="Nicht umkehrbare Aktionen" icon="i-lucide-alert-triangle" tone="danger">
			<div class="flex flex-col gap-4 md:flex-row md:items-center">
				<div class="flex-1">
					<h4 class="font-medium text-white">Organisation löschen</h4>
					<p class="mt-1 text-sm text-slate-400">
						Löscht alle Benutzer, Freizeiten, Teilnehmenden, Dateien und Domains der Organisation.
					</p>
				</div>
				<UButton label="Organisation löschen" color="error" variant="soft" icon="i-lucide-trash-2" @click="deleteOpen = true" />
			</div>
		</DashboardSectionCard>

		<DashboardModal v-model:open="inviteOpen" title="Admin einladen" :description="`Als Admin von ${org.display_name}`" icon="i-lucide-mail-plus">
			<UForm id="org-invite-form" :schema="inviteSchema" :state="inviteState" class="space-y-4" @submit="onInvite">
				<UFormField name="email" label="E-Mail" required eager-validation>
					<UInput v-model="inviteState.email" type="email" class="w-full" autofocus />
				</UFormField>
				<UFormField name="display_name" label="Name">
					<UInput v-model="inviteState.display_name" placeholder="Optional" class="w-full" />
				</UFormField>
			</UForm>
			<template #footer>
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="inviteOpen = false" />
				<UButton label="Einladen" color="primary" type="submit" form="org-invite-form" :loading="inviting" />
			</template>
		</DashboardModal>

		<DashboardModal
			:open="!!issued"
			title="Einladung erstellt"
			:description="
				issued?.email_sent
					? `Die Einladung ist an ${issued.email} unterwegs. Hier ist der Link noch einmal:`
					: `Es wurde keine E-Mail verschickt. Gib ${issued?.email} diesen Link:`
			"
			icon="i-lucide-check-circle"
			icon-color="emerald"
			:dismissible="false"
			:close="false"
		>
			<UInput :model-value="issued?.invite_url" readonly class="w-full font-mono" :ui="{ trailing: 'pe-1' }">
				<template #trailing>
					<UButton color="neutral" variant="link" size="sm" icon="i-lucide-copy" aria-label="Link kopieren" @click="copyLink" />
				</template>
			</UInput>
			<template #footer>
				<UButton label="Fertig" color="primary" @click="issued = null" />
			</template>
		</DashboardModal>

		<DashboardDeleteModal
			v-model:open="deleteOpen"
			title="Organisation löschen"
			:warning-text="`${org.display_name} wird mit allen Daten gelöscht. Das lässt sich nicht rückgängig machen.`"
			:on-delete="onDelete"
		/>
	</div>
</template>
