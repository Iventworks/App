<script setup lang="ts">
/**
 * Custom domains of one org: add, see the DNS records to create, verify, choose the primary domain
 * (every other address of the org redirects to it), remove. Used by the org's admins
 * (`/admin/organization/domains`) and by the system admins (`/admin/orgs/:id/domains`, `orgId`),
 * who also approve domains after adding them to the reverse proxy. A domain is active once it is
 * verified and approved.
 */
import type { TableColumn } from "@nuxt/ui";
import { Utils } from "~/utils";
import type { OrgDomain } from "~/utils/types";

const props = defineProps<{
	/** System admins: manage this org through the system API. Otherwise the caller's own org. */
	orgId?: number;
	/** `<slug>.<base host>`, the address that always exists. */
	defaultDomain: string;
	/** Org admins' domains go live without approval (`IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE`). */
	selfService?: boolean;
}>();

const isSystem = computed(() => props.orgId !== undefined);

const emit = defineEmits<{ changed: [] }>();

const toast = useToast();

const domains = ref<OrgDomain[]>([]);
const loading = ref(false);

async function load() {
	loading.value = true;
	const result = props.orgId
		? await useAPI((api) => api.getSystemOrgsByOrgIdDomains({ path: { orgId: props.orgId! } }))
		: await useAPI((api) => api.getAdminOrganizationDomains({}));
	loading.value = false;
	if (result.success) {
		domains.value = result.data;
	} else {
		toast.add({
			title: "Domains konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
	}
}
await load();

function fail(title: string, message: string) {
	toast.add({ title, description: message, icon: "i-lucide-alert-circle", color: "error" });
}

// --- add -------------------------------------------------------------------------------------

const addOpen = ref(false);
const adding = ref(false);
const addState = reactive({ domain: "" });

async function onAdd() {
	adding.value = true;
	const body = { domain: addState.domain };
	const result = props.orgId
		? await useAPI((api) => api.postSystemOrgsByOrgIdDomains({ path: { orgId: props.orgId! }, body }))
		: await useAPI((api) => api.postAdminOrganizationDomains({ body }));
	adding.value = false;

	if (!result.success) return fail("Domain konnte nicht hinzugefügt werden", result.message);
	addOpen.value = false;
	addState.domain = "";
	await load();
	setupTarget.value = result.data;
}

// --- DNS setup + verify ----------------------------------------------------------------------

const setupTarget = ref<OrgDomain | null>(null);
const setupOpen = computed({
	get: () => setupTarget.value !== null,
	set: (open) => {
		if (!open) setupTarget.value = null;
	},
});
const verifying = ref<number | null>(null);

async function verify(domain: OrgDomain) {
	verifying.value = domain.id;
	const path = { domainId: domain.id };
	const result = props.orgId
		? await useAPI((api) =>
				api.postSystemOrgsByOrgIdDomainsByDomainIdVerify({ path: { orgId: props.orgId!, ...path } }),
			)
		: await useAPI((api) => api.postAdminOrganizationDomainsByDomainIdVerify({ path }));
	verifying.value = null;

	if (!result.success) return fail("Prüfung fehlgeschlagen", result.message);
	await load();
	if (result.data.verified) {
		setupTarget.value = null;
		toast.add({
			title: `${result.data.domain} ist verifiziert`,
			description: result.data.is_primary ? "Sie ist jetzt die Hauptdomain." : undefined,
			icon: "i-lucide-badge-check",
			color: "success",
		});
		emit("changed");
	} else {
		if (setupTarget.value?.id === result.data.id) setupTarget.value = result.data;
		toast.add({
			title: "Noch nicht verifiziert",
			description: result.data.last_check_error ?? undefined,
			icon: "i-lucide-clock",
			color: "warning",
		});
	}
}

async function setApproval(domain: OrgDomain, approved: boolean) {
	if (!props.orgId) return;
	const path = { orgId: props.orgId, domainId: domain.id };
	const result = approved
		? await useAPI((api) => api.postSystemOrgsByOrgIdDomainsByDomainIdApproval({ path }))
		: await useAPI((api) => api.deleteSystemOrgsByOrgIdDomainsByDomainIdApproval({ path }));
	if (!result.success) return fail("Änderung fehlgeschlagen", result.message);
	toast.add({
		title: approved ? `${domain.domain} freigegeben` : `Freigabe für ${domain.domain} zurückgezogen`,
		description:
			approved && !result.data.verified ? "Sie wird aktiv, sobald die DNS-Prüfung klappt." : undefined,
		icon: "i-lucide-check",
		color: "success",
	});
	await load();
	emit("changed");
}

async function setPrimary(domain: OrgDomain, isPrimary: boolean) {
	const path = { domainId: domain.id };
	const body = { is_primary: isPrimary };
	const result = props.orgId
		? await useAPI((api) =>
				api.putSystemOrgsByOrgIdDomainsByDomainId({ path: { orgId: props.orgId!, ...path }, body }),
			)
		: await useAPI((api) => api.putAdminOrganizationDomainsByDomainId({ path, body }));
	if (!result.success) return fail("Änderung fehlgeschlagen", result.message);
	await load();
	emit("changed");
}

// --- remove ------------------------------------------------------------------------------------

const removeTarget = ref<OrgDomain | null>(null);
const removeOpen = computed({
	get: () => removeTarget.value !== null,
	set: (open) => {
		if (!open) removeTarget.value = null;
	},
});

async function onRemove() {
	const domain = removeTarget.value;
	if (!domain) return;
	const path = { domainId: domain.id };
	const result = props.orgId
		? await useAPI((api) =>
				api.deleteSystemOrgsByOrgIdDomainsByDomainId({ path: { orgId: props.orgId!, ...path } }),
			)
		: await useAPI((api) => api.deleteAdminOrganizationDomainsByDomainId({ path }));
	if (!result.success) {
		fail("Entfernen fehlgeschlagen", result.message);
		throw new Error(result.message);
	}
	toast.add({ title: `${domain.domain} entfernt`, icon: "i-lucide-check", color: "success" });
	await load();
	emit("changed");
}

async function copy(value: string) {
	const ok = await Utils.copyToClipboard(value);
	toast.add(
		ok
			? { title: "In die Zwischenablage kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: { title: "Kopieren nicht möglich", color: "warning" },
	);
}

const primary = computed(() => domains.value.find((domain) => domain.is_primary) ?? null);

const columns: TableColumn<OrgDomain>[] = [
	{ accessorKey: "domain", header: "Domain" },
	{ id: "status", header: "Status" },
	{ accessorKey: "created_at", header: "Hinzugefügt" },
	{ id: "actions", header: "" },
];
</script>

<template>
	<div class="space-y-4">
		<UAlert
			color="neutral"
			variant="subtle"
			icon="i-lucide-info"
			:title="primary ? `Hauptdomain: ${primary.domain}` : `Standard-Adresse: ${defaultDomain}`"
			:description="
				primary
					? `Alle anderen Adressen – auch ${defaultDomain} – leiten beim Öffnen auf ${primary.domain} weiter.`
					: `Die Organisation ist unter ${defaultDomain} erreichbar. Die erste aktive eigene Domain wird zur Hauptdomain.`
			"
		/>

		<UAlert
			v-if="!isSystem && !selfService"
			color="info"
			variant="subtle"
			icon="i-lucide-shield-question"
			title="Neue Domains gibt die Systemverwaltung frei"
			description="Lege die DNS-Einträge an und lass die Domain prüfen. Danach richtet ein System-Admin sie im Reverse Proxy ein und gibt sie frei – erst dann ist sie aktiv."
		/>

		<DashboardDataTable
			:data="domains"
			:columns="columns"
			:loading="loading"
			:filters="[{ column: 'domain', type: 'text', placeholder: 'Domain suchen …', icon: 'i-lucide-search' }]"
			empty-title="Noch keine eigene Domain"
			empty-description="Füge eine Domain hinzu, die du besitzt, z. B. plan.deine-organisation.de."
			empty-icon="i-lucide-globe"
			@refresh="load"
		>
			<template #header-right>
				<UButton label="Domain hinzufügen" icon="i-lucide-plus" color="primary" @click="addOpen = true" />
			</template>

			<template #domain-cell="{ row }">
				<div class="flex items-center gap-2">
					<span class="font-mono text-sm text-white">{{ row.original.domain }}</span>
					<UBadge v-if="row.original.is_primary" label="Hauptdomain" color="primary" variant="subtle" size="sm" />
				</div>
			</template>

			<template #status-cell="{ row }">
				<OrgDomainStatus :domain="row.original" />
			</template>

			<template #created_at-cell="{ row }">
				<span class="text-sm">{{ formatDate(row.original.created_at) }}</span>
			</template>

			<template #actions-cell="{ row }">
				<div class="flex justify-end gap-1">
					<UButton
						v-if="!row.original.verified"
						label="Einrichten"
						icon="i-lucide-settings-2"
						size="sm"
						color="neutral"
						variant="subtle"
						@click="setupTarget = row.original"
					/>
					<UButton
						v-if="isSystem && !row.original.approved"
						label="Freigeben"
						icon="i-lucide-shield-check"
						size="sm"
						color="primary"
						variant="subtle"
						@click="setApproval(row.original, true)"
					/>
					<UButton
						v-else-if="row.original.active && !row.original.is_primary"
						label="Als Hauptdomain"
						icon="i-lucide-star"
						size="sm"
						color="neutral"
						variant="subtle"
						@click="setPrimary(row.original, true)"
					/>
					<UButton
						v-else-if="row.original.is_primary"
						label="Weiterleitung aufheben"
						icon="i-lucide-star-off"
						size="sm"
						color="neutral"
						variant="ghost"
						@click="setPrimary(row.original, false)"
					/>
					<UTooltip v-if="isSystem && row.original.approved" text="Freigabe zurückziehen">
						<UButton
							icon="i-lucide-shield-off"
							size="sm"
							color="neutral"
							variant="ghost"
							aria-label="Freigabe zurückziehen"
							@click="setApproval(row.original, false)"
						/>
					</UTooltip>
					<UButton
						icon="i-lucide-trash-2"
						size="sm"
						color="error"
						variant="ghost"
						aria-label="Domain entfernen"
						@click="removeTarget = row.original"
					/>
				</div>
			</template>

			<template #empty-actions>
				<UButton label="Domain hinzufügen" color="primary" @click="addOpen = true" />
			</template>
		</DashboardDataTable>

		<DashboardModal
			v-model:open="addOpen"
			title="Domain hinzufügen"
			:description="
				isSystem
					? 'Richte die Domain zuerst im Reverse Proxy ein: Von dir hinzugefügte Domains sind direkt freigegeben und werden nach der DNS-Prüfung aktiv.'
					: 'Eine Domain, die dir gehört. Danach legst du zwei DNS-Einträge an.'
			"
			icon="i-lucide-globe"
		>
			<UForm id="add-domain-form" :state="addState" @submit="onAdd">
				<UFormField name="domain" label="Domain" required eager-validation>
					<UInput v-model="addState.domain" placeholder="plan.deine-organisation.de" class="w-full font-mono" autofocus />
				</UFormField>
			</UForm>
			<template #footer>
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="addOpen = false" />
				<UButton
					label="Hinzufügen"
					color="primary"
					type="submit"
					form="add-domain-form"
					:loading="adding"
					:disabled="addState.domain.trim().length < 3"
				/>
			</template>
		</DashboardModal>

		<DashboardModal
			v-model:open="setupOpen"
			:title="setupTarget ? `${setupTarget.domain} einrichten` : 'Domain einrichten'"
			description="Lege bei deinem DNS-Anbieter diese zwei Einträge an. Die Prüfung läuft auch automatisch alle 15 Minuten."
			icon="i-lucide-settings-2"
			width="sm:max-w-2xl"
		>
			<div v-if="setupTarget" class="space-y-4">
				<div
					v-for="record in [
						{ type: 'TXT', purpose: 'Beweist, dass dir die Domain gehört', name: setupTarget.dns.txt_name, value: setupTarget.dns.txt_value },
						{ type: 'CNAME', purpose: 'Leitet die Domain hierher', name: setupTarget.dns.cname_name, value: setupTarget.dns.cname_target },
					]"
					:key="record.type"
					class="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 p-4"
				>
					<div class="flex items-center gap-2">
						<UBadge :label="record.type" color="neutral" variant="subtle" />
						<span class="text-sm text-slate-400">{{ record.purpose }}</span>
					</div>
					<div class="grid gap-2 sm:grid-cols-[6rem_1fr_auto] sm:items-center">
						<span class="text-xs text-slate-500">Name</span>
						<code class="break-all text-sm text-slate-200">{{ record.name }}</code>
						<UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Name kopieren" @click="copy(record.name)" />
						<span class="text-xs text-slate-500">{{ record.type === "TXT" ? "Wert" : "Ziel" }}</span>
						<code class="break-all text-sm text-slate-200">{{ record.value }}</code>
						<UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" aria-label="Wert kopieren" @click="copy(record.value)" />
					</div>
				</div>
				<p class="text-xs text-slate-500">
					Für eine Domain ohne Subdomain (z. B. deine-organisation.de) erlauben viele Anbieter keinen
					CNAME – dann reicht ein ALIAS/ANAME bzw. „CNAME-Flattening“ auf dasselbe Ziel.
				</p>
				<UAlert
					v-if="setupTarget.last_check_error"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					title="Letzte Prüfung"
					:description="setupTarget.last_check_error"
				/>
			</div>
			<template #footer>
				<UButton label="Schließen" color="neutral" variant="ghost" @click="setupOpen = false" />
				<UButton
					label="Jetzt prüfen"
					icon="i-lucide-refresh-cw"
					color="primary"
					:loading="verifying === setupTarget?.id"
					@click="setupTarget && verify(setupTarget)"
				/>
			</template>
		</DashboardModal>

		<DashboardDeleteModal
			v-model:open="removeOpen"
			title="Domain entfernen"
			:warning-text="`Unter ${removeTarget?.domain} ist die Organisation danach nicht mehr erreichbar.`"
			:require-confirm-text="false"
			:on-delete="onRemove"
		/>
	</div>
</template>
