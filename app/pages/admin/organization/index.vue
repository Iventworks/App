<script setup lang="ts">
/**
 * "Allgemein": the org's name, primary colour, logo and icon. The slug — the name in the default
 * address — can't be changed.
 */
import * as z from "zod";
import { DEFAULT_BRAND } from "~/composables/stores/useInstanceStore";
import type { OrgPrimaryColor, OrgSettings } from "~/utils/types";

const toast = useToast();
const settings = useSubrouterInjectedData<OrgSettings>("organization").inject();
const org = computed(() => settings.data.value.org);

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

// Preview the colour while picking; the saved one comes back when leaving without saving.
const appConfig = useAppConfig();
watch(
	() => formState.primary_color,
	(color) => {
		appConfig.ui.colors.primary = color;
	},
);
onBeforeUnmount(() => {
	appConfig.ui.colors.primary = org.value.primary_color;
});

const saving = ref(false);
async function onSave() {
	saving.value = true;
	const result = await useAPI((api) =>
		api.putAdminOrganization({
			body: { display_name: formState.display_name.trim(), primary_color: formState.primary_color },
		}),
	);
	saving.value = false;
	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Organisation gespeichert", icon: "i-lucide-check", color: "success" });
	await settings.refresh();
}

// --- logo & icon -------------------------------------------------------------------------------

type AssetKind = "logo" | "icon";
const ASSETS: Record<AssetKind, { title: string; hint: string; accept: string; fallback: string }> =
	{
		logo: {
			title: "Logo",
			hint:
				"Seitenleiste und Anmeldung. SVG, PNG, WebP oder JPEG, für dunklen Hintergrund, höchstens 512 KB.",
			accept: "image/svg+xml,image/png,image/webp,image/jpeg",
			fallback: DEFAULT_BRAND.logo,
		},
		icon: {
			title: "Icon",
			hint:
				"Browser-Tab und App-Symbol. Quadratisches SVG oder PNG ab 192 × 192 px (besser 512 × 512), höchstens 512 KB.",
			accept: "image/svg+xml,image/png",
			fallback: DEFAULT_BRAND.icon,
		},
	};

const uploading = ref<AssetKind | null>(null);
const inputs = ref<Record<AssetKind, HTMLInputElement | null>>({ logo: null, icon: null });

async function onPicked(kind: AssetKind, event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;

	uploading.value = kind;
	const result = await useAPI((api) =>
		api.putAdminOrganizationAssetsByKind({ path: { kind }, body: { file } }),
	);
	uploading.value = null;
	if (!result.success) {
		toast.add({
			title: `${ASSETS[kind].title} abgelehnt`,
			description: result.message,
			color: "error",
		});
		return;
	}
	toast.add({
		title: `${ASSETS[kind].title} gespeichert`,
		icon: "i-lucide-check",
		color: "success",
	});
	await settings.refresh();
}

async function onRemove(kind: AssetKind) {
	const result = await useAPI((api) => api.deleteAdminOrganizationAssetsByKind({ path: { kind } }));
	if (!result.success) {
		toast.add({ title: "Entfernen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: `${ASSETS[kind].title} entfernt`, icon: "i-lucide-check", color: "success" });
	await settings.refresh();
}

function assetUrl(kind: AssetKind) {
	return kind === "logo" ? org.value.logo_url : org.value.icon_url;
}
</script>

<template>
	<div class="mx-auto w-full space-y-6 lg:w-3xl">
		<DashboardSectionCard title="Organisation" description="Name und Farbe überall in der App" icon="i-lucide-building">
			<UForm class="divide-y divide-slate-800" :schema="formSchema" :state="formState" @submit="onSave">
				<UFormField
					name="display_name"
					label="Name"
					description="So heißt deine Organisation in der App, in E-Mails und als installierte App."
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
					:description="
						settings.data.value.multi_org
							? 'Der Name in der Standard-Adresse lässt sich nicht ändern. Eigene Domains richtest du unter „Domains“ ein.'
							: 'Die Adresse der Installation.'
					"
					class="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
					:ui="{ container: 'w-full sm:w-72' }"
				>
					<UInput :model-value="org.default_domain" disabled class="w-full font-mono" />
				</UFormField>

				<UFormField
					name="primary_color"
					label="Hauptfarbe"
					description="Buttons, Links und Hervorhebungen. Die Vorschau gilt sofort, gespeichert wird mit „Speichern“."
					class="flex flex-col gap-3 py-4"
				>
					<OrgColorPicker v-model="formState.primary_color" />
				</UFormField>

				<div class="flex justify-end gap-2 pt-4">
					<UButton
						v-if="dirty"
						label="Verwerfen"
						color="neutral"
						variant="ghost"
						@click="
							formState.display_name = org.display_name;
							formState.primary_color = org.primary_color;
						"
					/>
					<UButton label="Speichern" color="primary" type="submit" icon="i-lucide-save" :loading="saving" :disabled="!dirty" />
				</div>
			</UForm>
		</DashboardSectionCard>

		<DashboardSectionCard title="Logo & Icon" description="Ohne eigene Bilder zeigt die App das Iventworks-Logo" icon="i-lucide-image">
			<div class="grid gap-4 sm:grid-cols-2">
				<div
					v-for="kind in (['logo', 'icon'] as const)"
					:key="kind"
					class="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4"
				>
					<div class="flex items-center justify-between">
						<h3 class="font-medium text-white">{{ ASSETS[kind].title }}</h3>
						<UBadge v-if="!assetUrl(kind)" label="Standard" color="neutral" variant="subtle" size="sm" />
					</div>
					<div class="flex h-24 items-center justify-center rounded-md bg-slate-900 p-3">
						<img
							:src="assetUrl(kind) ?? ASSETS[kind].fallback"
							:alt="ASSETS[kind].title"
							:class="kind === 'logo' ? 'max-h-full max-w-full' : 'size-16'"
							class="object-contain"
						/>
					</div>
					<p class="text-xs text-slate-500">{{ ASSETS[kind].hint }}</p>
					<div class="mt-auto flex gap-2">
						<input
							:ref="(el) => (inputs[kind] = el as HTMLInputElement | null)"
							type="file"
							:accept="ASSETS[kind].accept"
							class="hidden"
							@change="onPicked(kind, $event)"
						/>
						<UButton
							:label="assetUrl(kind) ? 'Ersetzen' : 'Hochladen'"
							icon="i-lucide-upload"
							size="sm"
							color="neutral"
							variant="subtle"
							:loading="uploading === kind"
							@click="inputs[kind]?.click()"
						/>
						<UButton
							v-if="assetUrl(kind)"
							label="Entfernen"
							icon="i-lucide-trash-2"
							size="sm"
							color="error"
							variant="ghost"
							@click="onRemove(kind)"
						/>
					</div>
				</div>
			</div>
		</DashboardSectionCard>
	</div>
</template>
