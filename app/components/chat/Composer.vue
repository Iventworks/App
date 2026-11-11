<script lang="ts">
// Unsent text per chat, kept while the app is open: switching chats doesn't lose a draft.
const drafts = new Map<number, string>();
</script>

<script setup lang="ts">
/**
 * The message composer: text, emoji, attachments (file picker, paste, or files dropped on the
 * chat via `addFiles`), answering a message and editing an own one.
 */
import { Utils } from "~/utils";
import type { ChatAttachment, ChatMessage } from "~/utils/types";

const fileIcon = Utils.getFileIcon;

interface Upload {
	key: number;
	conversationId: number;
	name: string;
	size: number;
	mimeType: string;
	/** Object URL for an image preview. */
	previewUrl: string | null;
	/** Set once the server has the file. */
	attachment: ChatAttachment | null;
}

const props = defineProps<{
	conversationId: number;
	/** The message being answered. */
	replyTo: ChatMessage | null;
	/** The own message being edited. */
	editing: ChatMessage | null;
}>();

const emit = defineEmits<{
	sent: [message: ChatMessage];
	edited: [message: ChatMessage];
	cancelReply: [];
	cancelEdit: [];
	/** Arrow up in the empty composer: edit the last own message. */
	editLast: [];
}>();

const MAX_LENGTH = 4000;
const MAX_ATTACHMENTS = 10;

const toast = useToast();

const text = ref(drafts.get(props.conversationId) ?? "");
const sending = ref(false);
const uploads = ref<Upload[]>([]);
const emojiOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const textarea = useTemplateRef<{ textareaRef?: HTMLTextAreaElement | null }>("textarea");
let nextKey = 1;

function input() {
	return textarea.value?.textareaRef ?? null;
}

function focus() {
	void nextTick(() => input()?.focus());
}

// --- drafts, reply and edit mode ------------------------------------------------------------

watch(text, (value) => {
	if (props.editing) return;
	if (value) drafts.set(props.conversationId, value);
	else drafts.delete(props.conversationId);
});

watch(
	() => props.conversationId,
	(id, previous) => {
		// Uploads belong to the chat they were made in.
		discardUploads(uploads.value.filter((upload) => upload.conversationId === previous));
		uploads.value = [];
		text.value = drafts.get(id) ?? "";
	},
);

watch(
	() => props.editing,
	(message) => {
		text.value = message ? message.content : (drafts.get(props.conversationId) ?? "");
		if (message) focus();
	},
);

watch(
	() => props.replyTo,
	(message) => {
		if (message) focus();
	},
);

const modeBar = computed(() => {
	if (props.editing) {
		return {
			icon: "i-lucide-pencil",
			title: "Nachricht bearbeiten",
			text: props.editing.content || "Anhang",
		};
	}
	const original = props.replyTo;
	if (!original) return null;
	const images = original.attachments.filter((attachment) => attachment.is_image);
	return {
		icon: "i-lucide-reply",
		title: original.is_own
			? "Antwort an dich selbst"
			: `Antwort an ${original.sender?.display_name ?? "gelöschten Account"}`,
		text:
			original.content ||
			attachmentLabel(
				original.attachments.length,
				original.attachments[0]?.name,
				images.length === original.attachments.length,
			),
	};
});

function cancelMode() {
	if (props.editing) emit("cancelEdit");
	else if (props.replyTo) emit("cancelReply");
}

// --- attachments ----------------------------------------------------------------------------

function release(upload: Upload) {
	if (upload.previewUrl) URL.revokeObjectURL(upload.previewUrl);
}

/** Take uploads that will not be sent back from the server (best effort; housekeeping covers the rest). */
function discardUploads(list: Upload[]) {
	for (const upload of list) {
		release(upload);
		const attachment = upload.attachment;
		if (!attachment) continue;
		void useAPI(
			(api) =>
				api.deleteConversationsByConversationIdAttachmentsByFileId({
					path: { conversationId: upload.conversationId, fileId: attachment.id },
				}),
			true,
		);
	}
}

function removeUpload(upload: Upload) {
	uploads.value = uploads.value.filter((entry) => entry.key !== upload.key);
	discardUploads([upload]);
}

async function addFiles(files: File[] | FileList | null | undefined) {
	const list = [...(files ?? [])];
	if (!list.length || props.editing) return;

	const free = MAX_ATTACHMENTS - uploads.value.length;
	if (list.length > free) {
		toast.add({
			title: `Höchstens ${MAX_ATTACHMENTS} Anhänge pro Nachricht`,
			color: "warning",
		});
	}

	const conversationId = props.conversationId;
	await Promise.all(
		list.slice(0, Math.max(free, 0)).map(async (file) => {
			const upload: Upload = {
				key: nextKey++,
				conversationId,
				name: file.name || "Datei",
				size: file.size,
				mimeType: file.type,
				previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
				attachment: null,
			};
			uploads.value.push(upload);

			const result = await useAPI((api) =>
				api.postConversationsByConversationIdAttachments({
					path: { conversationId },
					body: { file },
				}),
			);

			const current = uploads.value.find((entry) => entry.key === upload.key);
			if (!result.success) {
				toast.add({
					title: `„${upload.name}“ konnte nicht hochgeladen werden`,
					description:
						// 413: the server refused the upload before the API saw it.
						result.message === "File is too large" || (result.code as number) === 413
							? "Die Datei ist zu groß."
							: result.message,
					color: "error",
				});
				if (current) {
					release(current);
					uploads.value = uploads.value.filter((entry) => entry.key !== upload.key);
				}
				return;
			}

			if (current) {
				current.attachment = result.data;
			} else {
				// Removed (or the chat was switched) while it was uploading.
				discardUploads([{ ...upload, attachment: result.data }]);
			}
		}),
	);
}

function onPick(event: Event) {
	const element = event.target as HTMLInputElement;
	void addFiles(element.files);
	element.value = "";
}

function onPaste(event: ClipboardEvent) {
	const files = event.clipboardData?.files;
	if (!files?.length) return;
	event.preventDefault();
	void addFiles(files);
}

const uploading = computed(() => uploads.value.some((upload) => !upload.attachment));

// --- text -----------------------------------------------------------------------------------

function insertEmoji(emoji: string) {
	emojiOpen.value = false;
	const element = input();
	const start = element?.selectionStart ?? text.value.length;
	const end = element?.selectionEnd ?? text.value.length;
	text.value = `${text.value.slice(0, start)}${emoji}${text.value.slice(end)}`.slice(0, MAX_LENGTH);
	void nextTick(() => {
		const position = start + emoji.length;
		element?.focus();
		element?.setSelectionRange(position, position);
	});
}

const canSubmit = computed(() => {
	if (sending.value || uploading.value) return false;
	const content = text.value.trim();
	if (props.editing) {
		return (content.length > 0 || props.editing.attachments.length > 0) && content !== props.editing.content;
	}
	return content.length > 0 || uploads.value.length > 0;
});

async function submit() {
	if (!canSubmit.value) return;
	const content = text.value.trim();
	const conversationId = props.conversationId;
	sending.value = true;

	if (props.editing) {
		const messageId = props.editing.id;
		const result = await useAPI((api) =>
			api.putConversationsByConversationIdMessagesByMessageId({
				path: { conversationId, messageId },
				body: { content },
			}),
		);
		sending.value = false;
		if (!result.success) {
			toast.add({ title: "Bearbeiten fehlgeschlagen", description: result.message, color: "error" });
			return;
		}
		emit("edited", result.data);
		return;
	}

	const sentUploads = [...uploads.value];
	const result = await useAPI((api) =>
		api.postConversationsByConversationIdMessages({
			path: { conversationId },
			body: {
				content,
				attachment_ids: sentUploads.map((upload) => upload.attachment?.id as number),
				reply_to_id: props.replyTo?.id ?? null,
			},
		}),
	);
	sending.value = false;

	if (!result.success) {
		toast.add({
			title: "Nachricht konnte nicht gesendet werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	for (const upload of sentUploads) release(upload);
	const sent = new Set(sentUploads.map((upload) => upload.key));
	uploads.value = uploads.value.filter((upload) => !sent.has(upload.key));
	drafts.delete(conversationId);
	if (conversationId === props.conversationId) text.value = "";
	emit("sent", result.data);
	focus();
}

function onKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void submit();
		return;
	}
	if (event.key === "Escape" && (props.editing || props.replyTo)) {
		event.preventDefault();
		cancelMode();
		return;
	}
	if (event.key === "ArrowUp" && !text.value && !props.editing && !uploads.value.length) {
		event.preventDefault();
		emit("editLast");
	}
}

onBeforeUnmount(() => discardUploads(uploads.value));

defineExpose({ addFiles, focus });
</script>

<template>
	<div class="border-t border-default">
		<!-- Answering or editing -->
		<div
			v-if="modeBar"
			class="flex items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-3 py-2 sm:px-6"
		>
			<UIcon :name="modeBar.icon" class="size-4 shrink-0 text-primary-400" />
			<div class="min-w-0 flex-1 border-l-2 border-primary-400 pl-2">
				<p class="truncate text-xs font-semibold text-primary-300">{{ modeBar.title }}</p>
				<p class="truncate text-xs text-slate-400">{{ modeBar.text }}</p>
			</div>
			<UButton
				icon="i-lucide-x"
				color="neutral"
				variant="ghost"
				size="xs"
				aria-label="Abbrechen"
				@click="cancelMode"
			/>
		</div>

		<!-- Attachments waiting to be sent -->
		<ul v-if="uploads.length" class="flex gap-2 overflow-x-auto px-3 pt-3 sm:px-6">
			<li v-for="upload in uploads" :key="upload.key" class="relative shrink-0">
				<img
					v-if="upload.previewUrl"
					:src="upload.previewUrl"
					:alt="upload.name"
					class="size-16 rounded-lg object-cover"
				/>
				<div v-else class="flex h-16 w-44 items-center gap-2 rounded-lg bg-slate-800/80 px-2.5">
					<UIcon
						:name="fileIcon(upload.name, upload.mimeType)"
						class="size-6 shrink-0 text-primary-300"
					/>
					<div class="min-w-0">
						<p class="truncate text-xs font-medium text-slate-200">{{ upload.name }}</p>
						<p class="text-xs text-slate-500">{{ formatFileSize(upload.size) }}</p>
					</div>
				</div>
				<div
					v-if="!upload.attachment"
					class="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55"
				>
					<UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-white" />
				</div>
				<button
					type="button"
					class="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-slate-600 text-white transition hover:bg-slate-500"
					:aria-label="`${upload.name} entfernen`"
					@click="removeUpload(upload)"
				>
					<UIcon name="i-lucide-x" class="size-3" />
				</button>
			</li>
		</ul>

		<form class="flex items-end gap-1 p-3 sm:gap-1.5 sm:px-6 sm:py-4" @submit.prevent="submit">
			<input ref="fileInput" type="file" multiple class="hidden" @change="onPick" />
			<UTooltip text="Datei anhängen">
				<UButton
					icon="i-lucide-paperclip"
					color="neutral"
					variant="ghost"
					:disabled="Boolean(editing)"
					aria-label="Datei anhängen"
					@click="fileInput?.click()"
				/>
			</UTooltip>
			<UPopover v-model:open="emojiOpen" :content="{ side: 'top', align: 'start' }">
				<UButton
					icon="i-lucide-smile"
					color="neutral"
					variant="ghost"
					class="hidden sm:inline-flex"
					aria-label="Emoji einfügen"
				/>
				<template #content>
					<ChatEmojiPicker @select="insertEmoji" />
				</template>
			</UPopover>
			<UTextarea
				ref="textarea"
				v-model="text"
				:rows="1"
				autoresize
				:maxrows="8"
				placeholder="Nachricht schreiben …"
				class="min-w-0 flex-1"
				:maxlength="MAX_LENGTH"
				@keydown="onKeydown"
				@paste="onPaste"
			/>
			<UButton
				type="submit"
				:icon="editing ? 'i-lucide-check' : 'i-lucide-send-horizontal'"
				:loading="sending"
				:disabled="!canSubmit"
				:aria-label="editing ? 'Änderung speichern' : 'Senden'"
			/>
		</form>
	</div>
</template>
