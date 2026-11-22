<script setup lang="ts">
/**
 * "Link & QR-Code" of a published form: the link to copy or open, and the QR code to show on a
 * slide or print — downloaded as PNG (any presentation program) or SVG (sharp at any size).
 */
import { Utils } from "~/utils";

const props = defineProps<{
	title: string;
	url: string;
	/** Not taking answers right now: the link says so. */
	accepting: boolean;
}>();

const open = defineModel<boolean>("open", { required: true });
const toast = useToast();

async function copy() {
	const ok = await Utils.copyToClipboard(props.url);
	toast.add(
		ok
			? { title: "Link kopiert", icon: "i-lucide-clipboard-check", color: "success" }
			: { title: "Kopieren nicht möglich", color: "warning" },
	);
}

async function downloadPng() {
	const blob = await qrPng(props.url);
	if (!blob) {
		toast.add({ title: "Das Bild konnte nicht erstellt werden", color: "error" });
		return;
	}
	downloadBlob(blob, `qr-${fileSlug(props.title, "formular")}.png`);
}

function downloadSvg() {
	downloadBlob(
		new Blob([qrSvg(props.url)], { type: "image/svg+xml" }),
		`qr-${fileSlug(props.title, "formular")}.svg`,
	);
}
</script>

<template>
	<DashboardModal v-model:open="open" title="Link & QR-Code" icon="i-lucide-qr-code" :description="title">
		<div class="space-y-5">
			<UAlert
				v-if="!accepting"
				icon="i-lucide-lock"
				color="warning"
				variant="subtle"
				title="Nimmt gerade keine Antworten an"
				description="Wer den Link öffnet, sieht, dass das Formular geschlossen ist."
			/>

			<UFormField label="Link zum Ausfüllen" help="Jede Person mit dem Link kann antworten, ohne Konto.">
				<div class="flex gap-2">
					<UInput :model-value="url" readonly class="min-w-0 flex-1" @focus="($event.target as HTMLInputElement).select()" />
					<UButton icon="i-lucide-copy" color="neutral" variant="outline" aria-label="Link kopieren" @click="copy" />
					<UButton
						icon="i-lucide-external-link"
						color="neutral"
						variant="outline"
						aria-label="Formular öffnen"
						:to="url"
						target="_blank"
					/>
				</div>
			</UFormField>

			<div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
				<FormsQrCode :value="url" class="size-48 shrink-0 rounded-lg" />
				<div class="space-y-3 text-sm text-slate-400">
					<p>Zum Einbinden in eine Präsentation oder zum Ausdrucken: Wer den Code mit dem Handy scannt, landet direkt im Formular.</p>
					<div class="flex flex-wrap gap-2">
						<UButton icon="i-lucide-image-down" label="PNG herunterladen" color="neutral" variant="outline" @click="downloadPng" />
						<UButton icon="i-lucide-file-down" label="SVG herunterladen" color="neutral" variant="ghost" @click="downloadSvg" />
					</div>
				</div>
			</div>
		</div>
	</DashboardModal>
</template>
