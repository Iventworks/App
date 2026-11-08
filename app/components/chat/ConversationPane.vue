<script setup lang="ts">
/**
 * One open conversation: message history, polling for new messages (REST, `?after=<id>` every
 * few seconds while the tab is visible), older history on demand, composer, edit/delete of own
 * messages and the read marker.
 */
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core";
import type {
	GetConversationsByConversationIdMessagesResponses,
	GetConversationsResponses,
} from "~/api-client";

type Conversation = GetConversationsResponses["200"]["data"][number];
type Message = GetConversationsByConversationIdMessagesResponses["200"]["data"][number];

type Row =
	| { kind: "day"; key: string; label: string }
	| { kind: "message"; key: string; message: Message; showHeader: boolean };

const props = defineProps<{
	conversation: Conversation;
	/** Phones: show a back button instead of the sidebar toggle. */
	showBack?: boolean;
}>();

const emit = defineEmits<{
	back: [];
	/** The conversation was marked read (the list resets its unread badge). */
	read: [conversationId: number];
	/** Something changed that the list should reload (new message, rename, members). */
	changed: [];
	/** The caller left the group chat. */
	left: [];
}>();

const PAGE_SIZE = 50;
const POLL_MS = 4_000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_LENGTH = 4000;

const TYPE_ICONS: Record<Conversation["type"], string> = {
	core_team: "i-lucide-building-2",
	event: "i-lucide-tent",
	event_group: "i-lucide-users-round",
	group: "i-lucide-users",
	direct: "i-lucide-user",
};

const toast = useToast();
const { refreshBadges } = useDashboard();
const visibility = useDocumentVisibility();

const messages = ref<Message[]>([]);
const loading = ref(false);
const loadingOlder = ref(false);
const hasOlder = ref(false);
const bottomAnchor = ref<HTMLElement | null>(null);
// Message editing state — declared before `loadInitial`, which an immediate watcher runs during setup.
const editingId = ref<number | null>(null);
const editDraft = ref("");
const savingEdit = ref(false);
// Server time of the last sync (`/messages/sync`): edits/deletions by others after it arrive on the
// next poll. 0 after (re)loading a chat, so client clock skew can never hide a change.
let syncSince = 0;

// --- scrolling ------------------------------------------------------------------------------

function scrollContainer() {
	return bottomAnchor.value?.closest<HTMLElement>("[data-slot=body]") ?? null;
}

function isNearBottom() {
	const el = scrollContainer();
	if (!el) return true;
	return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
}

async function scrollToBottom(smooth = false) {
	await nextTick();
	bottomAnchor.value?.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
}

// --- loading ----------------------------------------------------------------------------------

function merge(incoming: Message[]) {
	const byId = new Map(messages.value.map((message) => [message.id, message]));
	for (const message of incoming) byId.set(message.id, message);
	messages.value = [...byId.values()].sort((a, b) => a.id - b.id);
}

async function markRead() {
	if (visibility.value !== "visible") return;
	const conversationId = props.conversation.id;
	const result = await useAPI((api) =>
		api.postConversationsByConversationIdRead({ path: { conversationId } }),
	);
	if (result.success) {
		emit("read", conversationId);
		void refreshBadges();
	}
}

async function loadInitial() {
	const conversationId = props.conversation.id;
	loading.value = true;
	messages.value = [];
	syncSince = 0;
	hasOlder.value = false;
	cancelEdit();

	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessages({
			path: { conversationId },
			query: { limit: PAGE_SIZE },
		}),
	);

	// The user switched to another chat while this request was running.
	if (conversationId !== props.conversation.id) return;
	loading.value = false;

	if (!result.success) {
		toast.add({
			title: "Nachrichten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	messages.value = result.data;
	hasOlder.value = result.data.length >= PAGE_SIZE;
	await scrollToBottom();
	await markRead();
}

async function loadOlder() {
	const first = messages.value[0];
	if (!first || loadingOlder.value) return;
	const conversationId = props.conversation.id;
	loadingOlder.value = true;

	const el = scrollContainer();
	const previousHeight = el?.scrollHeight ?? 0;
	const previousTop = el?.scrollTop ?? 0;

	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessages({
			path: { conversationId },
			query: { before: first.id, limit: PAGE_SIZE },
		}),
	);
	loadingOlder.value = false;
	if (conversationId !== props.conversation.id) return;

	if (!result.success) {
		toast.add({
			title: "Ältere Nachrichten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	hasOlder.value = result.data.length >= PAGE_SIZE;
	merge(result.data);

	// Keep the message the user was looking at in place.
	await nextTick();
	if (el) el.scrollTop = el.scrollHeight - previousHeight + previousTop;
}

let polling = false;

async function poll() {
	if (polling || loading.value) return;
	polling = true;
	const conversationId = props.conversation.id;
	const after = messages.value.at(-1)?.id ?? 0;

	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessagesSync({
			path: { conversationId },
			query: { after, since: syncSince },
		}),
	);
	polling = false;

	if (conversationId !== props.conversation.id || !result.success) return;
	const { messages: fresh, updated, deleted_ids, server_time } = result.data;
	syncSince = server_time;

	if (deleted_ids.length) {
		const deleted = new Set(deleted_ids);
		messages.value = messages.value.filter((message) => !deleted.has(message.id));
		if (editingId.value !== null && deleted.has(editingId.value)) cancelEdit();
	}
	if (updated.length) {
		// Only replace messages that are loaded; never resurrect the one being edited locally.
		const loaded = new Set(messages.value.map((message) => message.id));
		merge(updated.filter((message) => loaded.has(message.id) && message.id !== editingId.value));
	}
	// The chat list shows the last message as a preview: refresh it when that may have changed.
	if (!fresh.length) {
		if (deleted_ids.length || updated.length) emit("changed");
		return;
	}

	const stickToBottom = isNearBottom();
	merge(fresh);
	if (stickToBottom) await scrollToBottom(true);
	if (fresh.some((message) => !message.is_own)) {
		await markRead();
		emit("changed");
	}
}

const { pause, resume } = useIntervalFn(poll, POLL_MS, { immediate: false });

watch(
	visibility,
	(state) => {
		if (state === "visible") {
			resume();
			void poll();
		} else {
			pause();
		}
	},
	{ immediate: true },
);

watch(() => props.conversation.id, loadInitial, { immediate: true });

onBeforeUnmount(pause);

// --- rows (day separators, grouped sender headers) ----------------------------------------

function dayLabel(day: string) {
	if (day === toDayString()) return "Heute";
	if (day === toDayString(Date.now() - 86_400_000)) return "Gestern";
	return formatLongDay(day);
}

const rows = computed<Row[]>(() => {
	const result: Row[] = [];
	let lastDay = "";
	let previous: Message | null = null;

	for (const message of messages.value) {
		const day = toDayString(message.created_at);
		if (day !== lastDay) {
			result.push({ kind: "day", key: `day-${day}`, label: dayLabel(day) });
			lastDay = day;
			previous = null;
		}

		const showHeader =
			!previous ||
			previous.sender?.id !== message.sender?.id ||
			message.created_at - previous.created_at > GROUP_WINDOW_MS;

		result.push({ kind: "message", key: `message-${message.id}`, message, showHeader });
		previous = message;
	}

	return result;
});

// --- composer -------------------------------------------------------------------------------

const draft = ref("");
const sending = ref(false);

async function send() {
	const content = draft.value.trim();
	if (!content || sending.value) return;
	if (content.length > MAX_LENGTH) {
		toast.add({
			title: `Nachrichten dürfen höchstens ${MAX_LENGTH} Zeichen lang sein`,
			color: "warning",
		});
		return;
	}

	sending.value = true;
	const conversationId = props.conversation.id;
	const result = await useAPI((api) =>
		api.postConversationsByConversationIdMessages({ path: { conversationId }, body: { content } }),
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

	draft.value = "";
	if (conversationId === props.conversation.id) {
		merge([result.data]);
		await scrollToBottom(true);
	}
	emit("changed");
}

function onComposerKeydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void send();
	}
}

// --- edit / delete own messages ------------------------------------------------------------

function startEdit(message: Message) {
	editingId.value = message.id;
	editDraft.value = message.content;
}

function cancelEdit() {
	editingId.value = null;
	editDraft.value = "";
}

async function saveEdit(message: Message) {
	const content = editDraft.value.trim();
	if (!content || content === message.content) {
		cancelEdit();
		return;
	}
	savingEdit.value = true;
	const result = await useAPI((api) =>
		api.putConversationsByConversationIdMessagesByMessageId({
			path: { conversationId: message.conversation_id, messageId: message.id },
			body: { content },
		}),
	);
	savingEdit.value = false;

	if (!result.success) {
		toast.add({ title: "Bearbeiten fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	merge([result.data]);
	cancelEdit();
	emit("changed");
}

function onEditKeydown(event: KeyboardEvent, message: Message) {
	if (event.key === "Escape") cancelEdit();
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		void saveEdit(message);
	}
}

const deleteTarget = ref<Message | null>(null);
const deleteOpen = ref(false);

function openDelete(message: Message) {
	deleteTarget.value = message;
	deleteOpen.value = true;
}

async function confirmDelete() {
	const target = deleteTarget.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteConversationsByConversationIdMessagesByMessageId({
			path: { conversationId: target.conversation_id, messageId: target.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	messages.value = messages.value.filter((message) => message.id !== target.id);
	emit("changed");
}

function messageActions(message: Message) {
	return [
		[
			{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => startEdit(message) },
			{
				label: "Kopieren",
				icon: "i-lucide-copy",
				onSelect: () => navigator.clipboard?.writeText(message.content),
			},
		],
		[
			{
				label: "Löschen",
				icon: "i-lucide-trash-2",
				color: "error" as const,
				onSelect: () => openDelete(message),
			},
		],
	];
}

// --- header ----------------------------------------------------------------------------------

const infoOpen = ref(false);

const description = computed(() => {
	const conversation = props.conversation;
	switch (conversation.type) {
		case "event":
			return "Alle Mitarbeitenden des Events";
		case "event_group":
			return conversation.event ? `Gruppe · ${conversation.event.name}` : "Gruppe";
		case "core_team":
			return "Internes Kernteam";
		case "group":
			return `${conversation.members.length} Mitglieder`;
		default:
			return "Direktnachricht";
	}
});
</script>

<template>
	<UDashboardPanel
		id="messages-conversation"
		:ui="{ body: 'gap-0 sm:gap-0 px-3 py-4 sm:px-6 sm:py-6' }"
	>
		<template #header>
			<DashboardPageHeader
				:title="conversation.title"
				:icon="showBack ? undefined : TYPE_ICONS[conversation.type]"
				:description="description"
			>
				<template v-if="showBack" #leading>
					<UButton
						icon="i-lucide-arrow-left"
						color="neutral"
						variant="ghost"
						aria-label="Zurück zur Chatliste"
						@click="emit('back')"
					/>
				</template>

				<template #right>
					<UButton
						v-if="conversation.event && conversation.type === 'event'"
						:to="`/events/${conversation.event.id}`"
						icon="i-lucide-tent"
						label="Zum Event"
						color="neutral"
						variant="ghost"
						class="hidden sm:inline-flex"
					/>
					<UButton
						icon="i-lucide-info"
						color="neutral"
						variant="ghost"
						aria-label="Chat-Details"
						@click="infoOpen = true"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<div v-if="loading" class="flex flex-1 items-center justify-center py-12">
				<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
			</div>

			<template v-else>
				<div v-if="hasOlder" class="flex justify-center pb-4">
					<UButton
						label="Ältere Nachrichten laden"
						icon="i-lucide-history"
						color="neutral"
						variant="subtle"
						size="sm"
						:loading="loadingOlder"
						@click="loadOlder"
					/>
				</div>

				<UEmpty
					v-if="!messages.length"
					icon="i-lucide-message-circle"
					title="Noch keine Nachrichten"
					description="Schreib die erste Nachricht in diesem Chat."
					variant="naked"
					class="my-auto"
				/>

				<div class="mt-auto space-y-1">
					<template v-for="row in rows" :key="row.key">
						<div v-if="row.kind === 'day'" class="flex items-center gap-3 py-3">
							<div class="h-px flex-1 bg-slate-800" />
							<span class="text-xs font-medium text-slate-500">{{ row.label }}</span>
							<div class="h-px flex-1 bg-slate-800" />
						</div>

						<div
							v-else
							:class="[
								'group flex gap-2',
								row.message.is_own ? 'flex-row-reverse' : 'flex-row',
								row.showHeader ? 'pt-2' : '',
							]"
						>
							<div v-if="!row.message.is_own" class="w-8 shrink-0">
								<UAvatar
									v-if="row.showHeader"
									:text="initials(row.message.sender?.display_name ?? '?')"
									size="sm"
								/>
							</div>

							<div
								:class="[
									'flex max-w-[85%] flex-col sm:max-w-[70%]',
									row.message.is_own ? 'items-end' : 'items-start',
								]"
							>
								<p v-if="row.showHeader" class="mb-0.5 flex items-baseline gap-2 px-1 text-xs">
									<span v-if="!row.message.is_own" class="font-medium text-slate-300">
										{{ row.message.sender?.display_name ?? "Gelöschter Account" }}
									</span>
									<span class="text-slate-500">{{ formatTime(row.message.created_at) }}</span>
								</p>

								<div v-if="editingId === row.message.id" class="w-72 max-w-full space-y-2 sm:w-96">
									<UTextarea
										v-model="editDraft"
										autoresize
										:rows="2"
										:maxrows="10"
										class="w-full"
										autofocus
										@keydown="onEditKeydown($event, row.message)"
									/>
									<div class="flex justify-end gap-2">
										<UButton label="Abbrechen" color="neutral" variant="ghost" size="xs" @click="cancelEdit" />
										<UButton
											label="Speichern"
											size="xs"
											:loading="savingEdit"
											@click="saveEdit(row.message)"
										/>
									</div>
								</div>

								<div v-else class="flex items-center gap-1" :class="row.message.is_own ? 'flex-row-reverse' : ''">
									<div
										:class="[
											'whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
											row.message.is_own
												? 'rounded-tr-sm border border-primary/30 bg-primary/15 text-white'
												: 'rounded-tl-sm bg-slate-800/80 text-slate-100',
										]"
									>
										{{ row.message.content }}
										<span v-if="row.message.edited_at" class="ml-1 text-[11px] text-slate-400">
											(bearbeitet)
										</span>
									</div>

									<UDropdownMenu
										v-if="row.message.is_own"
										:items="messageActions(row.message)"
										:ui="{ viewport: 'main-bg-color' }"
									>
										<UButton
											icon="i-lucide-ellipsis"
											color="neutral"
											variant="ghost"
											size="xs"
											class="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
											aria-label="Nachricht bearbeiten"
										/>
									</UDropdownMenu>
								</div>
							</div>
						</div>
					</template>
				</div>
			</template>

			<div ref="bottomAnchor" class="h-px shrink-0" />
		</template>

		<template #footer>
			<div class="border-t border-default p-3 sm:px-6 sm:py-4">
				<form class="flex items-end gap-2" @submit.prevent="send">
					<UTextarea
						v-model="draft"
						:rows="1"
						autoresize
						:maxrows="8"
						placeholder="Nachricht schreiben … (Enter senden, Shift+Enter neue Zeile)"
						class="flex-1"
						:maxlength="MAX_LENGTH"
						@keydown="onComposerKeydown"
					/>
					<UButton
						type="submit"
						icon="i-lucide-send-horizontal"
						:loading="sending"
						:disabled="!draft.trim()"
						aria-label="Senden"
					/>
				</form>
			</div>
		</template>
	</UDashboardPanel>

	<ChatConversationInfoModal
		v-model:open="infoOpen"
		:conversation="conversation"
		@changed="emit('changed')"
		@left="emit('left')"
	/>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Nachricht löschen"
		warning-text="Die Nachricht wird für alle im Chat entfernt."
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
