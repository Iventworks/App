<script setup lang="ts">
/**
 * Create an org (system admins): name, slug — the fixed name in `<slug>.<base host>` — colour,
 * and optionally an invitation for its first admin. The invite link is shown once.
 */
import * as z from "zod";
import { Utils } from "~/utils";
import type { OrgPrimaryColor, SystemOrg } from "~/utils/types";

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Organisation anlegen", description: "Eine neue Organisation anlegen" });

const toast = useToast();
const instance = useInstance();
const baseHost = computed(() => {
	try {
		return new URL(instance.value?.base_url ?? "").host;
	} catch {
		return "";
	}
});

const state = reactive<{
	display_name: string;
	slug: string;
	primary_color: OrgPrimaryColor;
	admin_email: string;
	admin_display_name: string;
}>({
	display_name: "",
	slug: "",
	primary_color: "fuchsia",
	admin_email: "",
	admin_display_name: "",
});

// Suggest the slug from the name until it is edited by hand.
const slugTouched = ref(false);
watch(
	() => state.display_name,
	(name) => {
		if (slugTouched.value) return;
		state.slug = name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/ß/g, "ss")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40);
	},
);

const schema = z.object({
	display_name: z.string().trim().min(2, "Mindestens 2 Zeichen").max(80),
	slug: z
		.string()
		.regex(
			/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/,
			"2–40 Kleinbuchstaben, Ziffern oder Bindestriche, ohne Bindestrich am Rand",
		),
	admin_email: z.union([z.literal(""), z.email("Keine gültige E-Mail-Adresse")]),
	admin_display_name: z.string().max(100),
});

const creating = ref(false);
const created = ref<{
	org: SystemOrg;
	invitation: { invite_url: string; email_sent: boolean; email: string } | null;
} | null>(null);

async function onSubmit() {
	creating.value = true;
	const result = await useAPI((api) =>
		api.postSystemOrgs({
			body: {
				display_name: state.display_name.trim(),
				slug: state.slug,
				primary_color: state.primary_color,
				...(state.admin_email ? { admin_email: state.admin_email.trim() } : {}),
				...(state.admin_display_name.trim()
					? { admin_display_name: state.admin_display_name.trim() }
					: {}),
			},
		}),
	);
	creating.value = false;

	if (!result.success) {
		toast.add({
			title: "Organisation konnte nicht angelegt werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({
		title: `${result.data.org.display_name} angelegt`,
		icon: "i-lucide-check",
		color: "success",
	});
	if (result.data.invitation) {
		created.value = result.data;
	} else {
		await navigateTo(`/admin/orgs/${result.data.org.id}`);
	}
}

async function copyLink() {
	if (!created.value?.invitation) return;
	const ok = await Utils.copyToClipboard(created.value.invitation.invite_url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: { title: "Kopieren nicht möglich", color: "warning" },
	);
}

async function finish() {
	const id = created.value?.org.id;
	created.value = null;
	if (id) await navigateTo(`/admin/orgs/${id}`);
}
</script>

<template>
	<UDashboardPanel id="system-org-new">
		<template #header>
			<DashboardPageHeader
				icon="i-lucide-building"
				:breadcrumb-items="[{ label: 'Organisationen', to: '/admin/orgs' }, { label: 'Neu' }]"
			/>
		</template>

		<template #body>
			<DashboardPageBody>
				<div class="mx-auto w-full space-y-6 lg:w-3xl">
					<div>
						<h2 class="text-xl font-semibold text-white">Organisation anlegen</h2>
						<p class="mt-1 text-sm text-slate-400">
							Die Organisation bekommt eigene Benutzer, Daten und die Adresse
							<code class="text-slate-300">{{ state.slug || "name" }}.{{ baseHost }}</code>.
						</p>
					</div>

					<UForm id="org-new-form" :schema="schema" :state="state" class="space-y-6" @submit="onSubmit">
						<DashboardSectionCard title="Organisation" icon="i-lucide-building">
							<div class="divide-y divide-slate-800">
								<UFormField
									name="display_name"
									label="Name"
									required
									eager-validation
									class="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
									:ui="{ container: 'w-full sm:w-72' }"
								>
									<UInput v-model="state.display_name" placeholder="Crossover e.V." class="w-full" autofocus />
								</UFormField>
								<UFormField
									name="slug"
									label="Adresse"
									description="Lässt sich später nicht ändern."
									required
									eager-validation
									class="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
									:ui="{ container: 'w-full sm:w-72' }"
								>
									<UInput v-model="state.slug" class="w-full font-mono" @update:model-value="slugTouched = true">
										<template #trailing>
											<span class="text-xs text-slate-500">.{{ baseHost }}</span>
										</template>
									</UInput>
								</UFormField>
								<UFormField name="primary_color" label="Hauptfarbe" class="flex flex-col gap-3 py-4 last:pb-0">
									<OrgColorPicker v-model="state.primary_color" />
								</UFormField>
							</div>
						</DashboardSectionCard>

						<DashboardSectionCard
							title="Erster Admin"
							description="Optional – du kannst auch später einladen"
							icon="i-lucide-user-plus"
						>
							<div class="divide-y divide-slate-800">
								<UFormField
									name="admin_email"
									label="E-Mail"
									description="Bekommt eine Einladung als Admin der Organisation."
									eager-validation
									class="flex flex-col gap-2 py-4 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
									:ui="{ container: 'w-full sm:w-72' }"
								>
									<UInput v-model="state.admin_email" type="email" placeholder="leitung@example.org" class="w-full" />
								</UFormField>
								<UFormField
									name="admin_display_name"
									label="Name"
									class="flex flex-col gap-2 py-4 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
									:ui="{ container: 'w-full sm:w-72' }"
								>
									<UInput v-model="state.admin_display_name" placeholder="Optional" class="w-full" />
								</UFormField>
							</div>
						</DashboardSectionCard>

						<div class="flex justify-end gap-2">
							<UButton label="Abbrechen" color="neutral" variant="ghost" to="/admin/orgs" />
							<UButton label="Organisation anlegen" icon="i-lucide-plus-circle" color="primary" type="submit" :loading="creating" />
						</div>
					</UForm>
				</div>

				<DashboardModal
					:open="!!created"
					title="Organisation angelegt"
					:description="
						created?.invitation?.email_sent
							? `Die Einladung ist an ${created.invitation.email} unterwegs. Hier ist der Link noch einmal:`
							: `Es wurde keine E-Mail verschickt. Gib ${created?.invitation?.email} diesen Link:`
					"
					icon="i-lucide-check-circle"
					icon-color="emerald"
					:dismissible="false"
					:close="false"
				>
					<UInput :model-value="created?.invitation?.invite_url" readonly class="w-full font-mono" :ui="{ trailing: 'pe-1' }">
						<template #trailing>
							<UButton color="neutral" variant="link" size="sm" icon="i-lucide-copy" aria-label="Link kopieren" @click="copyLink" />
						</template>
					</UInput>
					<template #footer>
						<UButton label="Zur Organisation" color="primary" @click="finish" />
					</template>
				</DashboardModal>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
