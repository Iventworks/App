<script setup lang="ts">
/**
 * A shared single file: size and date, open / download / new version (as the link allows), and a
 * preview where there is one (PDF, image, Markdown, CSV, text).
 */
import type { PublicShareInfo, PublicShareItem } from "~/utils/types";

const props = defineProps<{
	token: string;
	item: PublicShareItem;
	permissions: NonNullable<PublicShareInfo["permissions"]>;
}>();

const emit = defineEmits<{ changed: [] }>();

const fileURL = useFileURL();
const replacement = useShareReplacement(props.token, () => emit("changed"));
const replaceInput = replacement.input;

const previewable = computed(
	() => !["none", "office"].includes(filePreviewKind(props.item.name, props.item.mime_type)),
);
</script>

<template>
	<UCard class="border-slate-800 bg-slate-900/60">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
			<div class="flex-1 space-y-1 text-sm text-slate-400">
				<p>{{ formatFileSize(item.size) }} · zuletzt geändert {{ formatDate(item.updated_at) }}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<UButton
					v-if="item.content_url"
					label="Öffnen"
					icon="i-lucide-external-link"
					color="neutral"
					variant="subtle"
					:to="fileURL(item.content_url)"
					target="_blank"
				/>
				<UButton
					v-if="item.content_url"
					label="Herunterladen"
					icon="i-lucide-download"
					color="primary"
					:to="fileURL(item.content_url, true)"
					target="_blank"
				/>
				<UButton
					v-if="permissions.edit"
					label="Neue Fassung"
					icon="i-lucide-file-up"
					color="neutral"
					variant="subtle"
					:loading="replacement.replacing.value"
					@click="replacement.pick(item)"
				/>
			</div>
		</div>
	</UCard>

	<FilesPreview
		v-if="previewable && item.content_url && permissions.read"
		:key="`${item.id}-${item.updated_at}`"
		:url="fileURL(item.content_url) as string"
		:download-url="fileURL(item.content_url, true)"
		:name="item.name"
		:mime-type="item.mime_type"
		:size="item.size"
	/>

	<input ref="replaceInput" type="file" class="hidden" @change="replacement.onPicked" />
</template>
