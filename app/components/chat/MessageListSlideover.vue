<script setup lang="ts">
/**
 * Messages of one chat in a side panel: either the search ("Im Chat suchen") or the pinned
 * messages. Picking one jumps to it in the chat.
 */
import { refDebounced } from "@vueuse/core";
import type { ChatMessage } from "~/utils/types";

const props = defineProps<{
	conversationId: number;
	mode: "search" | "pinned";
	/** The chat's pinned messages (mode `pinned`). */
	pinned: ChatMessage[];
}>();

const emit = defineEmits<{
	jump: [messageId: number];
	unpin: [message: ChatMessage];
}>();

const open = defineModel<boolean>("open", { required: true });

const PAGE_SIZE = 30;

const toast = useToast();

const term = ref("");
const termDebounced = refDebounced(term, 300);
const hits = ref<ChatMessage[]>([]);
const searching = ref(false);
const hasMore = ref(false);
let request = 0;

const query = computed(() => termDebounced.value.trim());
const tooShort = computed(() => query.value.length < 2);

async function search(more = false) {
	if (props.mode !== "search" || tooShort.value) {
		hits.value = [];
		hasMore.value = false;
		return;
	}
	const current = ++request;
	searching.value = true;
	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessagesSearch({
			path: { conversationId: props.conversationId },
			query: {
				q: query.value,
				limit: PAGE_SIZE,
				...(more && hits.value.length ? { before: hits.value.at(-1)?.id } : {}),
			},
		}),
	);
	if (current !== request) return;
	searching.value = false;

	if (!result.success) {
		toast.add({ title: "Suche fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	hits.value = more ? [...hits.value, ...result.data] : result.data;
	hasMore.value = result.data.length >= PAGE_SIZE;
}

watch(query, () => void search());

watch(
	() => [props.conversationId, open.value, props.mode],
	() => {
		// A fresh search every time the panel opens or the chat changes.
		term.value = "";
		hits.value = [];
		hasMore.value = false;
	},
);

const messages = computed(() => (props.mode === "pinned" ? props.pinned : hits.value));

function text(message: ChatMessage) {
	if (message.content) {
		return props.mode === "search" ? excerptAround(message.content, query.value) : message.content;
	}
	const images = message.attachments.filter((attachment) => attachment.is_image);
	return attachmentLabel(
		message.attachments.length,
		message.attachments[0]?.name,
		images.length === message.attachments.length,
	);
}

function pick(message: ChatMessage) {
	open.value = false;
	emit("jump", message.id);
}
</script>

<template>
	<USlideover
		v-model:open="open"
		:title="mode === 'pinned' ? 'Angeheftete Nachrichten' : 'Im Chat suchen'"
		:description="
			mode === 'pinned'
				? 'Für alle im Chat angeheftet.'
				: 'Durchsucht Nachrichten und die Namen von Anhängen.'
		"
	>
		<template #body>
			<div class="space-y-3">
				<UInput
					v-if="mode === 'search'"
					v-model="term"
					icon="i-lucide-search"
					placeholder="Suchbegriff"
					autofocus
					class="w-full"
					:loading="searching"
				/>

				<UEmpty
					v-if="mode === 'pinned' && !messages.length"
					icon="i-lucide-pin"
					title="Nichts angeheftet"
					description="Hefte wichtige Nachrichten über ihr Menü an, damit alle sie schnell wiederfinden."
					variant="naked"
					class="py-10"
				/>
				<p v-else-if="mode === 'search' && tooShort" class="px-1 text-sm text-slate-500">
					Gib mindestens zwei Zeichen ein.
				</p>
				<UEmpty
					v-else-if="mode === 'search' && !searching && !messages.length"
					icon="i-lucide-search-x"
					title="Nichts gefunden"
					:description="`Keine Nachricht enthält „${query}“.`"
					variant="naked"
					class="py-10"
				/>

				<ul v-if="messages.length" class="space-y-1.5">
					<li v-for="message in messages" :key="message.id" class="group relative">
						<button
							type="button"
							class="block w-full rounded-lg border border-slate-800 px-3 py-2 text-left transition hover:border-slate-700 hover:bg-slate-800/40"
							@click="pick(message)"
						>
							<span class="flex items-baseline justify-between gap-2">
								<span class="truncate text-sm font-medium text-slate-200">
									{{ message.is_own ? "Du" : (message.sender?.display_name ?? "Gelöschter Account") }}
								</span>
								<span class="shrink-0 text-xs text-slate-500">{{ formatDate(message.created_at) }}</span>
							</span>
							<span class="mt-0.5 line-clamp-3 block break-words text-sm text-slate-400">
								<UIcon
									v-if="!message.content && message.attachments.length"
									name="i-lucide-paperclip"
									class="mr-1 inline size-3.5 align-[-2px]"
								/>
								<template v-if="mode === 'search' && message.content">
									<template v-for="(part, index) in highlightTerm(text(message), query)" :key="index">
										<mark v-if="part.type === 'mark'" class="rounded bg-primary/30 px-0.5 text-white">{{
											part.text
										}}</mark>
										<template v-else>{{ part.text }}</template>
									</template>
								</template>
								<template v-else>{{ text(message) }}</template>
							</span>
							<span
								v-if="mode === 'pinned' && message.pinned_by"
								class="mt-1 block text-xs text-slate-500"
							>
								Angeheftet von {{ message.pinned_by.display_name }}
							</span>
						</button>
						<UTooltip v-if="mode === 'pinned'" text="Nicht mehr anheften">
							<UButton
								icon="i-lucide-pin-off"
								color="neutral"
								variant="ghost"
								size="xs"
								class="absolute bottom-1.5 right-1.5"
								aria-label="Nicht mehr anheften"
								@click="emit('unpin', message)"
							/>
						</UTooltip>
					</li>
				</ul>

				<div v-if="mode === 'search' && hasMore" class="flex justify-center">
					<UButton
						label="Weitere Treffer laden"
						color="neutral"
						variant="subtle"
						size="sm"
						:loading="searching"
						@click="search(true)"
					/>
				</div>
			</div>
		</template>
	</USlideover>
</template>
