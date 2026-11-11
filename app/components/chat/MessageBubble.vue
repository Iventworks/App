<script setup lang="ts">
/**
 * One message: the bubble with the quoted message, attachments, text and time, the reactions
 * below it and the actions next to it (react, reply, pin, edit, delete).
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import { Utils } from "~/utils";
import type { ChatAttachment, ChatMessage } from "~/utils/types";

const fileIcon = Utils.getFileIcon;

const props = defineProps<{
	message: ChatMessage;
	/** First message of a run by the same person: shows their avatar and name. */
	showHeader: boolean;
	/** Chats with several people show who wrote a message; a direct chat doesn't need to. */
	showSender: boolean;
	/** Everyone else has read up to this instant (the ticks of own messages). */
	readByAllUntil: number;
	highlighted?: boolean;
}>();

const emit = defineEmits<{
	reply: [];
	edit: [];
	remove: [];
	info: [];
	react: [emoji: string];
	pin: [pinned: boolean];
	/** Jump to the quoted message. */
	jump: [messageId: number];
	openImage: [attachment: ChatAttachment];
}>();

const fileURL = useFileURL();

const images = computed(() => props.message.attachments.filter((entry) => entry.is_image));
const files = computed(() => props.message.attachments.filter((entry) => !entry.is_image));
const parts = computed(() => linkify(props.message.content));
const read = computed(
	() => props.message.is_own && props.message.created_at <= props.readByAllUntil,
);

/** Room kept free at the end of the last line of text, so the time never covers it. */
const metaWidth = computed(() => {
	let rem = 2.5;
	if (props.message.edited_at) rem += 4.2;
	if (props.message.is_own) rem += 1.2;
	if (props.message.pinned_at) rem += 1;
	return `${rem}rem`;
});

const quote = computed(() => {
	const original = props.message.reply_to;
	if (!original) return null;
	if (original.is_deleted) return { name: original.sender_name, text: "Nachricht gelöscht" };
	return {
		name: original.sender_name,
		text:
			original.content ||
			(original.attachment_count === 1 ? "Anhang" : `${original.attachment_count} Anhänge`),
	};
});

// --- reactions ------------------------------------------------------------------------------

const reactionOpen = ref(false);
const pickerOpen = ref(false);

watch(reactionOpen, (open) => {
	if (!open) pickerOpen.value = false;
});

function react(emoji: string) {
	reactionOpen.value = false;
	emit("react", emoji);
}

function reactionNames(reaction: ChatMessage["reactions"][number]) {
	return reaction.users.map((user) => user.display_name).join(", ");
}

// --- menu -----------------------------------------------------------------------------------

const actions = computed<DropdownMenuItem[][]>(() => {
	const message = props.message;
	const groups: DropdownMenuItem[][] = [
		[
			{ label: "Antworten", icon: "i-lucide-reply", onSelect: () => emit("reply") },
			...(message.content
				? [
						{
							label: "Kopieren",
							icon: "i-lucide-copy",
							onSelect: () => void Utils.copyToClipboard(message.content),
						},
					]
				: []),
			message.pinned_at
				? { label: "Nicht mehr anheften", icon: "i-lucide-pin-off", onSelect: () => emit("pin", false) }
				: { label: "Anheften", icon: "i-lucide-pin", onSelect: () => emit("pin", true) },
		],
	];
	if (message.is_own) {
		groups.push([
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => emit("edit") },
			{ label: "Gelesen von …", icon: "i-lucide-check-check", onSelect: () => emit("info") },
		]);
		groups.push([
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => emit("remove"),
			},
		]);
	}
	return groups;
});
</script>

<template>
	<div
		:data-message-id="message.id"
		:class="[
			'group/message flex gap-2',
			message.is_own ? 'flex-row-reverse' : 'flex-row',
			showHeader ? 'pt-2' : '',
		]"
	>
		<div v-if="showSender && !message.is_own" class="w-8 shrink-0">
			<UAvatar
				v-if="showHeader"
				:text="initials(message.sender?.display_name ?? '?')"
				size="sm"
			/>
		</div>

		<div
			:class="[
				'flex min-w-0 max-w-[88%] flex-col sm:max-w-[72%]',
				message.is_own ? 'items-end' : 'items-start',
			]"
		>
			<div :class="['flex min-w-0 max-w-full items-center gap-0.5', message.is_own ? 'flex-row-reverse' : '']">
				<div
					:class="[
						'relative min-w-0 rounded-2xl p-1.5 text-sm transition-shadow duration-500',
						message.is_own
							? 'border border-primary/30 bg-primary/15 text-white'
							: 'bg-slate-800/80 text-slate-100',
						showHeader ? (message.is_own ? 'rounded-tr-sm' : 'rounded-tl-sm') : '',
						highlighted ? 'ring-2 ring-primary-400' : 'ring-0 ring-transparent',
					]"
				>
					<p
						v-if="showSender && !message.is_own && showHeader"
						:class="['px-1.5 pb-0.5 text-xs font-semibold', senderColor(message.sender?.id)]"
					>
						{{ message.sender?.display_name ?? "Gelöschter Account" }}
					</p>

					<!-- The message this one answers -->
					<button
						v-if="quote"
						type="button"
						class="mb-1 block w-full min-w-40 rounded-lg border-l-2 border-primary-400 bg-black/25 px-2 py-1 text-left transition hover:bg-black/35"
						@click="emit('jump', message.reply_to!.id)"
					>
						<span class="block truncate text-xs font-semibold text-primary-300">
							{{ quote.name ?? "Gelöschter Account" }}
						</span>
						<span class="line-clamp-2 break-words text-xs text-slate-300">{{ quote.text }}</span>
					</button>

					<!-- Images -->
					<div
						v-if="images.length"
						:class="['mb-1 gap-1', images.length > 1 ? 'grid grid-cols-2' : 'flex']"
					>
						<button
							v-for="image in images"
							:key="image.id"
							type="button"
							class="overflow-hidden rounded-xl bg-black/30"
							:aria-label="`${image.name} ansehen`"
							@click="emit('openImage', image)"
						>
							<img
								:src="fileURL(image.content_url)"
								:alt="image.name"
								loading="lazy"
								:class="[
									'block object-cover',
									images.length > 1 ? 'aspect-square w-40 max-w-full' : 'max-h-72 max-w-full',
								]"
							/>
						</button>
					</div>

					<!-- Other files -->
					<a
						v-for="file in files"
						:key="file.id"
						:href="fileURL(file.content_url)"
						target="_blank"
						rel="noopener"
						class="mb-1 flex min-w-48 items-center gap-2.5 rounded-xl bg-black/25 px-2.5 py-2 transition hover:bg-black/35"
					>
						<UIcon :name="fileIcon(file.name, file.mime_type)" class="size-6 shrink-0 text-primary-300" />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium">{{ file.name }}</span>
							<span class="block text-xs text-slate-400">{{ formatFileSize(file.size) }}</span>
						</span>
						<UIcon name="i-lucide-download" class="size-4 shrink-0 text-slate-400" />
					</a>

					<template v-if="message.content">
						<p class="whitespace-pre-wrap break-words px-1.5 py-0.5 [overflow-wrap:anywhere]">
							<template v-for="(part, index) in parts" :key="index">
								<a
									v-if="part.type === 'link'"
									:href="part.href"
									target="_blank"
									rel="noopener noreferrer"
									class="text-primary-300 underline underline-offset-2 hover:text-primary-200"
									>{{ part.text }}</a
								>
								<template v-else>{{ part.text }}</template>
							</template>
							<span class="inline-block h-0" :style="{ width: metaWidth }" aria-hidden="true" />
						</p>
						<ChatMessageMeta
							class="absolute bottom-1.5 right-2.5"
							:created-at="message.created_at"
							:edited="Boolean(message.edited_at)"
							:pinned="Boolean(message.pinned_at)"
							:own="message.is_own"
							:read="read"
						/>
					</template>
					<div v-else class="flex justify-end px-1 pb-0.5">
						<ChatMessageMeta
							:created-at="message.created_at"
							:edited="Boolean(message.edited_at)"
							:pinned="Boolean(message.pinned_at)"
							:own="message.is_own"
							:read="read"
						/>
					</div>
				</div>

				<!-- Actions: always there on touch screens, on hover with a mouse -->
				<div
					:class="[
						'flex shrink-0 items-center transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover/message:opacity-100',
						reactionOpen ? 'sm:opacity-100' : '',
					]"
				>
					<UPopover v-model:open="reactionOpen" :content="{ side: 'top', align: 'center' }">
						<UButton
							icon="i-lucide-smile-plus"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Reagieren"
						/>
						<template #content>
							<div v-if="!pickerOpen" class="flex items-center gap-0.5 p-1.5">
								<button
									v-for="emoji in QUICK_REACTIONS"
									:key="emoji"
									type="button"
									class="flex size-9 items-center justify-center rounded-full text-xl transition hover:scale-110 hover:bg-slate-800"
									@click="react(emoji)"
								>
									{{ emoji }}
								</button>
								<UButton
									icon="i-lucide-plus"
									color="neutral"
									variant="ghost"
									size="sm"
									class="rounded-full"
									aria-label="Mehr Emojis"
									@click="pickerOpen = true"
								/>
							</div>
							<ChatEmojiPicker v-else @select="react" />
						</template>
					</UPopover>
					<UButton
						icon="i-lucide-reply"
						color="neutral"
						variant="ghost"
						size="xs"
						class="hidden sm:inline-flex"
						aria-label="Antworten"
						@click="emit('reply')"
					/>
					<UDropdownMenu :items="actions" :ui="{ viewport: 'main-bg-color' }">
						<UButton
							icon="i-lucide-ellipsis"
							color="neutral"
							variant="ghost"
							size="xs"
							aria-label="Weitere Aktionen"
						/>
					</UDropdownMenu>
				</div>
			</div>

			<!-- Reactions -->
			<div
				v-if="message.reactions.length"
				:class="['relative z-[1] -mt-1 flex flex-wrap gap-1 px-2', message.is_own ? 'justify-end' : '']"
			>
				<UTooltip
					v-for="reaction in message.reactions"
					:key="reaction.emoji"
					:text="reactionNames(reaction)"
				>
					<button
						type="button"
						:class="[
							'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition',
							reaction.reacted_by_me
								? 'border-primary/60 bg-primary/25 text-white'
								: 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600',
						]"
						:aria-label="`${reaction.emoji} ${reaction.count}`"
						@click="emit('react', reaction.emoji)"
					>
						<span class="text-sm leading-none">{{ reaction.emoji }}</span>
						<span v-if="reaction.count > 1" class="tabular-nums">{{ reaction.count }}</span>
					</button>
				</UTooltip>
			</div>
		</div>
	</div>
</template>
