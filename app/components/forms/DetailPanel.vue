<script setup lang="ts">
/**
 * The frame of one form's pages, in the Kernteam area and in events: the header with its status
 * and actions (publish, link & QR code, close, preview, copy, delete), the tabs "Fragen" /
 * "Einstellungen" / "Antworten" (templates have no answers) and the tab's page.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import type { UseSubrouterPathDynamics } from "~/composables/useSubrouterPathDynamics";
import { FormFields } from "~~/server/lib/forms/fields";

const props = defineProps<{
	/** The list's name in the breadcrumbs ("Formulare"). */
	listLabel: string;
	/** Where it lives, for the page title ("Kernteam", the event's name). */
	place: string;
}>();

const detail = useFormDetail();
const { form, basePath, listPath, isTemplate } = detail;
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ask = useConfirmDialog();

const state = computed(() => FORM_STATES[formStateOf(form.value)]);

const tabs = computed(() => [
	{ label: "Fragen", icon: "i-lucide-list-checks", path: basePath },
	{ label: "Einstellungen", icon: "i-lucide-settings-2", path: `${basePath}/settings` },
	...(isTemplate.value
		? []
		: [
				{
					label: "Antworten",
					icon: "i-lucide-inbox",
					path: `${basePath}/responses`,
					badge: form.value.response_count || undefined,
				},
			]),
]);

const subrouter = useSubrouterPathDynamics({
	baseTitle: props.place,
	routes: computed<UseSubrouterPathDynamics.RoutesConfig>(() =>
		Object.fromEntries(
			tabs.value.map((tab) => [
				tab.path,
				{
					isNavLink: true,
					label: tab.label,
					icon: tab.icon,
					badge: "badge" in tab ? tab.badge : undefined,
					// "Fragen" must not stay highlighted on the other tabs.
					exact: tab.path === basePath,
					getDynamicValues: () => ({
						seoSettings: { title: tab.label, description: form.value.title },
						breadcrumbItems: [{ label: tab.label }],
					}),
				},
			]),
		),
	),
});

const tabLabel = computed(
	() => [...tabs.value].reverse().find((tab) => route.path.startsWith(tab.path))?.label ?? "Fragen",
);

useSeoMeta({ title: () => `${tabLabel.value}: ${form.value.title} | ${props.place}` });

const breadcrumbs = computed(() => [
	{
		label: isTemplate.value ? "Vorlagen" : props.listLabel,
		to: isTemplate.value ? `${listPath}?type=templates` : listPath,
	},
	{ label: form.value.title },
]);

// --- status ----------------------------------------------------------------------------------

const shareOpen = ref(false);
const busy = ref(false);

function needsSaving() {
	if (!detail.dirty.value) return false;
	toast.add({
		title: "Bitte speichere zuerst deine Änderungen",
		color: "warning",
		icon: "i-lucide-save",
	});
	return true;
}

async function publish() {
	if (needsSaving()) return;
	if (!FormFields.questionsOf(form.value.fields).length) {
		toast.add({ title: "Füge zuerst mindestens eine Frage hinzu", color: "warning" });
		return;
	}
	const choice = await ask({
		title: "Formular veröffentlichen?",
		description:
			"Danach kann jede Person mit dem Link oder dem QR-Code antworten, ohne Konto. Du kannst das Formular jederzeit schließen.",
		icon: "i-lucide-send",
		confirmLabel: "Veröffentlichen",
		confirmIcon: "i-lucide-send",
	});
	if (choice !== "confirm") return;
	busy.value = true;
	const ok = await detail.setStatus("open");
	busy.value = false;
	if (!ok) return;
	toast.add({ title: "Formular veröffentlicht", icon: "i-lucide-check", color: "success" });
	shareOpen.value = true;
}

async function close() {
	const choice = await ask({
		title: "Formular schließen?",
		description:
			"Der Link bleibt gleich, nimmt aber keine Antworten mehr an. Du kannst das Formular wieder öffnen.",
		icon: "i-lucide-lock",
		confirmLabel: "Schließen",
		confirmIcon: "i-lucide-lock",
	});
	if (choice !== "confirm") return;
	if (await detail.setStatus("closed")) {
		toast.add({ title: "Formular geschlossen", icon: "i-lucide-lock", color: "success" });
	}
}

async function reopen() {
	const hadDeadline = form.value.closes_at !== null && form.value.closes_at <= Date.now();
	if (!(await detail.setStatus("open"))) return;
	toast.add({
		title: "Formular wieder geöffnet",
		description: hadDeadline ? "Die abgelaufene Frist wurde entfernt." : undefined,
		icon: "i-lucide-radio",
		color: "success",
	});
}

// --- preview, copies, delete -----------------------------------------------------------------

const previewOpen = ref(false);
const previewFields = computed(() => detail.draftFields.value ?? form.value.fields);

/** "Titel (Kopie)", shortened to fit the title limit. */
function copyTitle(title: string) {
	const suffix = " (Kopie)";
	return `${title.slice(0, FormFields.MAX_TITLE - suffix.length).trimEnd()}${suffix}`;
}

async function copy(asTemplate: boolean) {
	if (needsSaving()) return;
	const result = await useAPI((api) =>
		api.postFormsByFormIdCopy({
			path: { formId: form.value.id },
			body: {
				title: asTemplate ? form.value.title : copyTitle(form.value.title),
				as_template: asTemplate,
			},
		}),
	);
	if (!result.success) {
		toast.add({ title: "Kopieren fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	const target = asTemplate ? `/core-team/forms/${result.data.id}` : `${listPath}/${result.data.id}`;
	if (asTemplate) {
		toast.add({
			title: "Als Vorlage gespeichert",
			description: "Neue Formulare können jetzt mit diesen Fragen starten.",
			icon: "i-lucide-check",
			color: "success",
			actions: [{ label: "Vorlage öffnen", onClick: () => void router.push(target) }],
		});
		return;
	}
	toast.add({ title: "Kopie angelegt", icon: "i-lucide-check", color: "success" });
	await router.push(target);
}

const deleteOpen = ref(false);
const deleteWarning = computed(() => {
	if (isTemplate.value)
		return `Die Vorlage „${form.value.title}“ wird gelöscht. Formulare, die mit ihr angelegt wurden, bleiben.`;
	const answers = form.value.response_count;
	return `„${form.value.title}“ wird mit ${answers === 1 ? "einer Antwort" : `${answers} Antworten`} gelöscht. Der Link funktioniert danach nicht mehr.`;
});

async function onDelete() {
	const result = await useAPI((api) => api.deleteFormsByFormId({ path: { formId: form.value.id } }));
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({
		title: isTemplate.value ? "Vorlage gelöscht" : "Formular gelöscht",
		color: "success",
	});
	detail.deleted.value = true;
	detail.dirty.value = false;
	await router.push(isTemplate.value ? `${listPath}?type=templates` : listPath);
}

const menu = computed<DropdownMenuItem[][]>(() => [
	[
		...(!isTemplate.value && form.value.status === "open"
			? [{ label: "Schließen", icon: "i-lucide-lock", onSelect: close }]
			: []),
		// Past its closing time it is still `open`: reopening drops the closing time.
		...(!isTemplate.value && (form.value.status === "closed" || formStateOf(form.value) === "expired")
			? [{ label: "Wieder öffnen", icon: "i-lucide-radio", onSelect: reopen }]
			: []),
		{ label: "Vorschau", icon: "i-lucide-eye", onSelect: () => (previewOpen.value = true) },
	],
	[
		{ label: "Duplizieren", icon: "i-lucide-copy", onSelect: () => copy(false) },
		...(detail.canManageTemplates && !isTemplate.value
			? [
					{
						label: "Als Vorlage speichern",
						icon: "i-lucide-layout-template",
						onSelect: () => copy(true),
					},
				]
			: []),
	],
	[
		{
			label: "Löschen",
			icon: "i-lucide-trash-2",
			color: "error" as const,
			onSelect: () => (deleteOpen.value = true),
		},
	],
]);
</script>

<template>
	<UDashboardPanel id="form-detail">
		<template #header>
			<DashboardPageHeader icon="i-lucide-clipboard-list" :breadcrumb-items="breadcrumbs">
				<template #right>
					<UBadge
						v-if="isTemplate"
						label="Vorlage"
						icon="i-lucide-layout-template"
						color="info"
						variant="subtle"
						class="hidden sm:inline-flex"
					/>
					<UBadge
						v-else
						:label="state.label"
						:icon="state.icon"
						:color="state.color"
						variant="subtle"
						class="hidden sm:inline-flex"
					/>
					<UButton
						icon="i-lucide-eye"
						label="Vorschau"
						color="neutral"
						variant="ghost"
						class="hidden md:inline-flex"
						@click="previewOpen = true"
					/>
					<template v-if="!isTemplate">
						<UButton
							v-if="form.status === 'draft'"
							icon="i-lucide-send"
							label="Veröffentlichen"
							:loading="busy"
							@click="publish"
						/>
						<UButton
							v-else-if="form.public_url"
							icon="i-lucide-qr-code"
							label="Link & QR-Code"
							@click="shareOpen = true"
						/>
					</template>
					<UDropdownMenu :items="menu" :content="{ align: 'end' }">
						<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" aria-label="Weitere Aktionen" />
					</UDropdownMenu>
				</template>
			</DashboardPageHeader>

			<UDashboardToolbar>
				<!-- `-mx-1` aligns the menu with the sidebar collapse button. -->
				<UNavigationMenu :items="subrouter.links.value" highlight class="-mx-1 flex-1" />
			</UDashboardToolbar>
		</template>

		<template #body>
			<DashboardPageBody>
				<NuxtPage />
			</DashboardPageBody>
		</template>
	</UDashboardPanel>

	<FormsShareModal
		v-if="form.public_url"
		v-model:open="shareOpen"
		:title="form.title"
		:url="form.public_url"
		:accepting="form.accepting"
	/>

	<DashboardModal
		v-model:open="previewOpen"
		title="Vorschau"
		icon="i-lucide-eye"
		description="So sieht das Formular für alle aus, die den Link öffnen."
		width="sm:max-w-3xl"
	>
		<div class="space-y-6">
			<div class="space-y-3">
				<h2 class="text-2xl font-bold text-white">{{ form.title }}</h2>
				<ContentMarkdownView v-if="form.description" :content="form.description" />
			</div>
			<UEmpty
				v-if="!previewFields.length"
				icon="i-lucide-list-plus"
				title="Noch keine Fragen"
				description="Füge unter „Fragen“ die erste Frage hinzu."
			/>
			<FormsFill
				v-else
				:fields="previewFields"
				preview
				@submit="toast.add({ title: 'Alles richtig ausgefüllt', icon: 'i-lucide-check', color: 'success' })"
			/>
		</div>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		:title="isTemplate ? 'Vorlage löschen' : 'Formular löschen'"
		:warning-text="deleteWarning"
		:require-confirm-text="!isTemplate && form.response_count > 0"
		:on-delete="onDelete"
	/>
</template>
