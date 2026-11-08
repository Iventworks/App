<script setup lang="ts">
/**
 * Shows a freshly created one-time password link once, with a copy button. The link is not
 * stored in plain text, so closing the dialog is the last chance to copy it.
 */
import { Utils } from "~/utils";
import type { PasswordLink } from "~/utils/types";

const props = defineProps<{
	link: PasswordLink | null;
	/** Whose link it is, e.g. "Lea Leiterin". */
	name: string;
	/** Wording for a brand-new account instead of a reset. */
	isNewAccount?: boolean;
}>();

const open = defineModel<boolean>("open", { required: true });
const toast = useToast();

async function copy() {
	if (!props.link) return;
	const ok = await Utils.copyToClipboard(props.link.url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-check", color: "success" }
			: {
					title: "Kopieren nicht möglich",
					description: "Markiere den Link und kopiere ihn von Hand.",
					icon: "i-lucide-alert-circle",
					color: "warning",
				},
	);
}
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="isNewAccount ? 'Konto angelegt' : 'Passwort-Link erstellt'"
		:description="
			isNewAccount
				? `Gib ${name} diesen Link, damit das Konto ein Passwort bekommt.`
				: `Mit diesem Link kann ${name} ein neues Passwort wählen.`
		"
		icon="i-lucide-link"
		icon-color="emerald"
		:dismissible="false"
	>
		<div v-if="link" class="space-y-3">
			<UInput :model-value="link.url" readonly class="w-full" :ui="{ base: 'font-mono text-xs' }" @focus="($event.target as HTMLInputElement).select()">
				<template #trailing>
					<UButton icon="i-lucide-copy" color="neutral" variant="link" size="sm" aria-label="Link kopieren" @click="copy" />
				</template>
			</UInput>
			<UAlert
				icon="i-lucide-info"
				color="warning"
				variant="subtle"
				title="Nur jetzt sichtbar"
				:description="`Der Link funktioniert einmal und läuft am ${formatDate(link.expires_at)} ab. Gib ihn nur persönlich oder über einen sicheren Kanal weiter.`"
			/>
		</div>

		<template #footer>
			<UButton label="Link kopieren" icon="i-lucide-copy" color="neutral" variant="subtle" @click="copy" />
			<UButton label="Fertig" @click="open = false" />
		</template>
	</DashboardModal>
</template>
