<script setup lang="ts">
/** An image attachment in full size, with a download button. */
import type { ChatAttachment } from "~/utils/types";

defineProps<{
	attachment: ChatAttachment | null;
}>();

const open = defineModel<boolean>("open", { required: true });

const fileURL = useFileURL();
</script>

<template>
	<DashboardModal
		v-model:open="open"
		:title="attachment?.name ?? 'Bild'"
		icon="i-lucide-image"
		width="sm:max-w-4xl"
	>
		<img
			v-if="attachment"
			:src="fileURL(attachment.content_url)"
			:alt="attachment.name"
			class="mx-auto max-h-[70vh] max-w-full rounded-lg object-contain"
		/>

		<template #footer>
			<span v-if="attachment" class="mr-auto text-sm text-slate-400">
				{{ formatFileSize(attachment.size) }}
			</span>
			<UButton
				v-if="attachment"
				:to="fileURL(attachment.content_url, true)"
				external
				label="Herunterladen"
				icon="i-lucide-download"
				color="neutral"
				variant="subtle"
			/>
			<UButton label="Schließen" @click="open = false" />
		</template>
	</DashboardModal>
</template>
