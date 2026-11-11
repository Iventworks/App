<script setup lang="ts">
/**
 * One open conversation: the message history with day separators, polling for new messages and
 * for changes to loaded ones (`/messages/sync` every few seconds while the tab is visible), older
 * and newer history on demand, jumping to a message (search hit, pin, quoted message), reactions,
 * pins, the composer and the read marker.
 */
import { useDocumentVisibility, useEventListener, useIntervalFn } from "@vueuse/core";
import type { ChatAttachment, ChatConversation, ChatMessage } from "~/utils/types";

type Row =
	| { kind: "day"; key: string; label: string }
	| { kind: "unread"; key: string }
	| { kind: "message"; key: string; message: ChatMessage; showHeader: boolean };

const props = defineProps<{
	conversation: ChatConversation;
	/** Phones: show a back button instead of the sidebar toggle. */
	showBack?: boolean;
	/** Open the chat at this message (a hit of the search across all chats). */
	jumpTo?: number | null;
}>();

const emit = defineEmits<{
	back: [];
	/** The conversation was marked read (the list resets its unread badge). */
	read: [conversationId: number];
	/** Something changed that the list should reload (new message, rename, members, settings). */
	changed: [];
	/** The caller left the group chat. */
	left: [];
	/** `jumpTo` was handled. */
	jumped: [];
	/** Open the direct chat with a person (from the member list). */
	openChat: [conversationId: number];
}>();

const PAGE_SIZE = 50;
const POLL_MS = 4_000;
/** With the realtime channel, the socket says when to sync; polling is only a safety net. */
const POLL_REALTIME_MS = 30_000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
// `after` for a sync that should only report changes, not new messages (while reading history).
const ALL_IDS = Number.MAX_SAFE_INTEGER;

const TYPE_ICONS: Record<ChatConversation["type"], string> = {
	core_team: "i-lucide-building-2",
	event: "i-lucide-tent",
	event_group: "i-lucide-users-round",
	group: "i-lucide-users",
	direct: "i-lucide-user",
};

const toast = useToast();
const { refreshBadges } = useDashboard();
const visibility = useDocumentVisibility();
const realtime = useRealtime();

const messages = ref<ChatMessage[]>([]);
const loading = ref(false);
const loadingOlder = ref(false);
const loadingNewer = ref(false);
const hasOlder = ref(false);
/** Reading history after a jump: there are newer messages than the loaded ones. */
const hasNewer = ref(false);
const pinned = ref<ChatMessage[]>([]);
const readByAllUntil = ref(0);
/** Messages after this instant were unread when the chat was opened ("Neue Nachrichten"). */
const unreadMarker = ref<number | null>(null);
const replyTo = ref<ChatMessage | null>(null);
const editing = ref<ChatMessage | null>(null);
const highlightedId = ref<number | null>(null);
const bottomAnchor = ref<HTMLElement | null>(null);
const composer = useTemplateRef<{
	addFiles: (files: FileList | File[] | null | undefined) => Promise<void>;
	focus: () => void;
}>("composer");
// Server time of the last sync: changes by others after it arrive on the next poll. 0 after
// (re)loading a chat, so client clock skew can never hide a change.
let syncSince = 0;

// --- scrolling ------------------------------------------------------------------------------

const scroller = ref<HTMLElement | null>(null);
const atBottom = ref(true);
/** Messages from others that arrived while the caller was scrolled up. */
const newBelow = ref(0);

function isNearBottom() {
	const el = scroller.value;
	if (!el) return true;
	return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
}

async function scrollToBottom(smooth = false) {
	await nextTick();
	bottomAnchor.value?.scrollIntoView({ block: "end", behavior: smooth ? "smooth" : "auto" });
	newBelow.value = 0;
}

onMounted(() => {
	scroller.value = bottomAnchor.value?.closest<HTMLElement>("[data-slot=body]") ?? null;
});

useEventListener(
	scroller,
	"scroll",
	() => {
		atBottom.value = isNearBottom();
		if (atBottom.value && !hasNewer.value) newBelow.value = 0;
	},
	{ passive: true },
);

let highlightTimer: ReturnType<typeof setTimeout> | undefined;

/** Bring a loaded message into view and flash it. */
async function reveal(messageId: number) {
	await nextTick();
	const element = scroller.value?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
	if (!element) return false;
	element.scrollIntoView({ block: "center", behavior: "auto" });
	highlightedId.value = messageId;
	clearTimeout(highlightTimer);
	highlightTimer = setTimeout(() => {
		highlightedId.value = null;
	}, 2_000);
	return true;
}

// --- loading ----------------------------------------------------------------------------------

function merge(incoming: ChatMessage[]) {
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

async function loadPinned() {
	const conversationId = props.conversation.id;
	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessagesPinned({ path: { conversationId } }),
	);
	if (result.success && conversationId === props.conversation.id) pinned.value = result.data;
}

/** The latest page of the chat. */
async function loadLatest() {
	const conversationId = props.conversation.id;
	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessages({
			path: { conversationId },
			query: { limit: PAGE_SIZE },
		}),
	);
	// The user switched to another chat while this request was running.
	if (conversationId !== props.conversation.id) return false;

	if (!result.success) {
		toast.add({
			title: "Nachrichten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return false;
	}

	messages.value = result.data;
	hasOlder.value = result.data.length >= PAGE_SIZE;
	hasNewer.value = false;
	return true;
}

/** A page with `messageId` in the middle — for messages outside of what is loaded. */
async function loadAround(messageId: number) {
	const conversationId = props.conversation.id;
	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessages({
			path: { conversationId },
			query: { around: messageId, limit: PAGE_SIZE },
		}),
	);
	if (conversationId !== props.conversation.id) return false;

	if (!result.success || !result.data.some((message) => message.id === messageId)) {
		toast.add({
			title: "Nachricht nicht gefunden",
			description: result.success ? "Sie wurde inzwischen gelöscht." : result.message,
			color: "warning",
		});
		return false;
	}

	const half = Math.floor(PAGE_SIZE / 2);
	messages.value = result.data;
	hasOlder.value =
		result.data.filter((message) => message.id <= messageId).length >= PAGE_SIZE - half;
	hasNewer.value = result.data.filter((message) => message.id > messageId).length >= half;
	// Everything loaded from now on is reported by `updated`, not as new.
	syncSince = 0;
	return true;
}

/** Direct chats: when the other person was last online (unless they hide it). */
async function loadLastSeen() {
	const result = await useAPI(
		(api) =>
			api.getConversationsByConversationIdMembers({ path: { conversationId: props.conversation.id } }),
		true,
	);
	if (result.success) {
		realtime.rememberLastSeen(result.data.map((member) => [member.user.id, member.last_seen_at]));
	}
}

async function loadInitial() {
	loading.value = true;
	messages.value = [];
	pinned.value = [];
	syncSince = 0;
	hasOlder.value = false;
	hasNewer.value = false;
	readByAllUntil.value = 0;
	newBelow.value = 0;
	replyTo.value = null;
	editing.value = null;
	unreadMarker.value = props.conversation.unread_count > 0 ? props.conversation.last_read_at : null;

	const conversationId = props.conversation.id;
	const target = props.jumpTo ?? null;
	void loadPinned();
	if (props.conversation.type === "direct") void loadLastSeen();

	const jumped = target !== null && (await loadAround(target));
	if (target !== null) emit("jumped");
	const loaded = jumped || (await loadLatest());
	if (conversationId !== props.conversation.id) return;
	loading.value = false;
	if (!loaded) return;

	if (jumped && target !== null) {
		await reveal(target);
	} else {
		// Start at the first unread message when there is one, else at the end.
		await nextTick();
		const divider = scroller.value?.querySelector<HTMLElement>("[data-unread-divider]");
		if (divider) divider.scrollIntoView({ block: "start" });
		else await scrollToBottom();
	}
	atBottom.value = isNearBottom();
	await markRead();
}

async function loadOlder() {
	const first = messages.value[0];
	if (!first || loadingOlder.value) return;
	const conversationId = props.conversation.id;
	loadingOlder.value = true;

	const el = scroller.value;
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

async function loadNewer() {
	const last = messages.value.at(-1);
	if (!last || loadingNewer.value) return;
	const conversationId = props.conversation.id;
	loadingNewer.value = true;

	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessages({
			path: { conversationId },
			query: { after: last.id, limit: PAGE_SIZE },
		}),
	);
	loadingNewer.value = false;
	if (conversationId !== props.conversation.id) return;

	if (!result.success) {
		toast.add({
			title: "Neuere Nachrichten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	hasNewer.value = result.data.length >= PAGE_SIZE;
	merge(result.data);
}

/** Go to a message: scroll to it when it is loaded, else load the page around it. */
async function jump(messageId: number) {
	if (await reveal(messageId)) return;
	if (await loadAround(messageId)) {
		await reveal(messageId);
		atBottom.value = isNearBottom();
	}
}

/** Back to the newest messages (after reading history, or just scrolled up). */
async function backToLatest() {
	if (hasNewer.value) {
		syncSince = 0;
		if (!(await loadLatest())) return;
	}
	await scrollToBottom(!hasNewer.value);
	atBottom.value = true;
}

let polling = false;
/** A sync was asked for while one was running: run once more afterwards. */
let pollAgain = false;
/** Messages from others arrived while the tab was hidden: mark them read when it is shown. */
let unreadWhileHidden = false;

async function poll() {
	if (polling) {
		pollAgain = true;
		return;
	}
	if (loading.value) return;
	polling = true;
	try {
		do {
			pollAgain = false;
			await syncOnce();
		} while (pollAgain && !loading.value);
	} finally {
		polling = false;
	}
}

async function syncOnce() {
	const conversationId = props.conversation.id;
	const history = hasNewer.value;
	const after = history ? ALL_IDS : (messages.value.at(-1)?.id ?? 0);

	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMessagesSync({
			path: { conversationId },
			query: { after, since: syncSince, from: messages.value[0]?.id ?? 0 },
		}),
	);

	if (conversationId !== props.conversation.id || !result.success) return;
	const {
		messages: fresh,
		updated,
		deleted_ids,
		pinned_ids,
		read_by_all_until,
		server_time,
	} = result.data;
	syncSince = server_time;
	readByAllUntil.value = read_by_all_until;

	if (deleted_ids.length) {
		const deleted = new Set(deleted_ids);
		messages.value = messages.value.filter((message) => !deleted.has(message.id));
		if (editing.value && deleted.has(editing.value.id)) editing.value = null;
		if (replyTo.value && deleted.has(replyTo.value.id)) replyTo.value = null;
	}
	if (updated.length) {
		// Only replace messages that are loaded.
		const loaded = new Set(messages.value.map((message) => message.id));
		merge(updated.filter((message) => loaded.has(message.id)));
	}

	// Someone pinned or unpinned a message (maybe one that is not loaded here).
	const known = new Set(pinned.value.map((message) => message.id));
	if (pinned_ids.length !== known.size || pinned_ids.some((id) => !known.has(id))) {
		void loadPinned();
	} else if (updated.length) {
		const byId = new Map(updated.map((message) => [message.id, message]));
		pinned.value = pinned.value.map((message) => byId.get(message.id) ?? message);
	}

	// The chat list shows the last message as a preview: refresh it when that may have changed.
	if (history || !fresh.length) {
		if (deleted_ids.length || updated.length) emit("changed");
		return;
	}

	const stickToBottom = isNearBottom();
	merge(fresh);
	const fromOthers = fresh.filter((message) => !message.is_own);
	// Whoever just sent a message has stopped typing.
	realtime.clearTyping(
		conversationId,
		fromOthers.map((message) => message.sender?.id).filter((id): id is number => id !== undefined),
	);
	if (stickToBottom) await scrollToBottom(true);
	else newBelow.value += fromOthers.length;
	if (fromOthers.length > 0) {
		if (visibility.value === "visible") await markRead();
		else unreadWhileHidden = true;
		emit("changed");
	}
}

const pollInterval = computed(() => (realtime.connected.value ? POLL_REALTIME_MS : POLL_MS));
const { pause, resume } = useIntervalFn(poll, pollInterval, { immediate: false });

watch(
	visibility,
	(state) => {
		if (state === "visible") {
			resume();
			void poll();
			if (unreadWhileHidden) {
				unreadWhileHidden = false;
				void markRead();
			}
		} else {
			pause();
		}
	},
	{ immediate: true },
);

// The realtime channel: sync as soon as this chat changes (also while the tab is in the
// background, so the messages are there when it comes back), and after a reconnect.
useRealtimeEvent((event) => {
	if (event.type === "resync") void poll();
	if (event.type === "conversation" && event.conversation_id === props.conversation.id) void poll();
});

const typists = computed(() => realtime.typingIn(props.conversation.id));

watch(() => props.conversation.id, loadInitial, { immediate: true });

watch(
	() => props.jumpTo,
	(messageId) => {
		// While the chat is (re)loading, `loadInitial` takes care of it.
		if (!messageId || loading.value) return;
		emit("jumped");
		void jump(messageId);
	},
);

onBeforeUnmount(() => {
	pause();
	clearTimeout(highlightTimer);
});

// --- rows (day separators, the unread divider, grouped sender headers) ----------------------

function dayLabel(day: string) {
	if (day === toDayString()) return "Heute";
	if (day === toDayString(Date.now() - 86_400_000)) return "Gestern";
	return formatLongDay(day);
}

const rows = computed<Row[]>(() => {
	const result: Row[] = [];
	let lastDay = "";
	let previous: ChatMessage | null = null;
	let dividerPlaced = unreadMarker.value === null;

	for (const message of messages.value) {
		const day = toDayString(message.created_at);
		if (day !== lastDay) {
			result.push({ kind: "day", key: `day-${day}`, label: dayLabel(day) });
			lastDay = day;
			previous = null;
		}

		if (!dividerPlaced && !message.is_own && message.created_at > (unreadMarker.value ?? 0)) {
			result.push({ kind: "unread", key: "unread" });
			dividerPlaced = true;
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

// --- composer: sending, answering, editing --------------------------------------------------

async function onSent(message: ChatMessage) {
	replyTo.value = null;
	if (message.conversation_id === props.conversation.id) {
		if (hasNewer.value) {
			// Sent while reading history: back to the end, where the new message is.
			syncSince = 0;
			await loadLatest();
		} else {
			merge([message]);
		}
		await scrollToBottom(true);
		atBottom.value = true;
	}
	emit("changed");
}

function onEdited(message: ChatMessage) {
	editing.value = null;
	merge([message]);
	emit("changed");
}

function startReply(message: ChatMessage) {
	editing.value = null;
	replyTo.value = message;
}

function startEdit(message: ChatMessage) {
	replyTo.value = null;
	editing.value = message;
}

function editLast() {
	const last = messages.value.findLast((message) => message.is_own);
	if (last) startEdit(last);
}

// --- reactions, pins, deleting --------------------------------------------------------------

async function react(message: ChatMessage, emoji: string) {
	const result = await useAPI((api) =>
		api.postConversationsByConversationIdMessagesByMessageIdReactions({
			path: { conversationId: message.conversation_id, messageId: message.id },
			body: { emoji },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Reaktion fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	merge([result.data]);
}

async function setPinned(message: ChatMessage, value: boolean) {
	const path = { conversationId: message.conversation_id, messageId: message.id };
	const result = await useAPI((api) =>
		value
			? api.putConversationsByConversationIdMessagesByMessageIdPin({ path })
			: api.deleteConversationsByConversationIdMessagesByMessageIdPin({ path }),
	);
	if (!result.success) {
		toast.add({
			title: value ? "Anheften fehlgeschlagen" : "Lösen fehlgeschlagen",
			description:
				result.message === "Too many pinned messages in this chat"
					? "In diesem Chat sind schon sehr viele Nachrichten angeheftet."
					: result.message,
			color: "error",
		});
		return;
	}
	if (messages.value.some((entry) => entry.id === message.id)) merge([result.data]);
	pinned.value = value
		? [result.data, ...pinned.value.filter((entry) => entry.id !== message.id)]
		: pinned.value.filter((entry) => entry.id !== message.id);
	toast.add({
		title: value ? "Nachricht angeheftet" : "Nachricht nicht mehr angeheftet",
		color: "success",
		icon: value ? "i-lucide-pin" : "i-lucide-pin-off",
	});
}

const deleteTarget = ref<ChatMessage | null>(null);
const deleteOpen = ref(false);

function openDelete(message: ChatMessage) {
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
	pinned.value = pinned.value.filter((message) => message.id !== target.id);
	if (editing.value?.id === target.id) editing.value = null;
	if (replyTo.value?.id === target.id) replyTo.value = null;
	emit("changed");
}

// --- side panels and dialogs ----------------------------------------------------------------

const infoOpen = ref(false);
const listOpen = ref(false);
const listMode = ref<"search" | "pinned">("search");
const viewerOpen = ref(false);
const viewerAttachment = ref<ChatAttachment | null>(null);
const readInfoOpen = ref(false);
const readInfoMessage = ref<ChatMessage | null>(null);

function openList(mode: "search" | "pinned") {
	listMode.value = mode;
	listOpen.value = true;
}

function openImage(attachment: ChatAttachment) {
	viewerAttachment.value = attachment;
	viewerOpen.value = true;
}

function openReadInfo(message: ChatMessage) {
	readInfoMessage.value = message;
	readInfoOpen.value = true;
}

function pinnedText(message: ChatMessage) {
	if (message.content) return message.content;
	const images = message.attachments.filter((attachment) => attachment.is_image);
	return attachmentLabel(
		message.attachments.length,
		message.attachments[0]?.name,
		images.length === message.attachments.length,
	);
}

// --- files dropped on the chat --------------------------------------------------------------

const dragDepth = ref(0);

function hasFiles(event: DragEvent) {
	return Boolean(event.dataTransfer?.types.includes("Files"));
}

function onDragEnter(event: DragEvent) {
	if (hasFiles(event)) dragDepth.value++;
}

function onDragLeave(event: DragEvent) {
	if (hasFiles(event)) dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function onDrop(event: DragEvent) {
	dragDepth.value = 0;
	void composer.value?.addFiles(event.dataTransfer?.files);
}

// --- header ----------------------------------------------------------------------------------

/** The other person of a direct chat. */
const otherPerson = computed(() =>
	props.conversation.type === "direct"
		? (props.conversation.members.find((member) => member.id !== realtime.selfId.value) ?? null)
		: null,
);

const description = computed(() => {
	const conversation = props.conversation;
	const people = `${conversation.member_count} ${conversation.member_count === 1 ? "Mitglied" : "Mitglieder"}`;
	switch (conversation.type) {
		case "event":
			return `Alle Mitarbeitenden des Events · ${people}`;
		case "event_group":
			return conversation.event ? `Gruppe · ${conversation.event.name} · ${people}` : people;
		case "core_team":
			return `Internes Kernteam · ${people}`;
		case "group": {
			const online = conversation.members.filter(
				(member) => member.id !== realtime.selfId.value && realtime.isOnline(member.id),
			).length;
			return online ? `${people} · ${online} online` : people;
		}
		default: {
			if (typists.value.length) return "schreibt …";
			if (realtime.isOnline(otherPerson.value?.id)) return "Online";
			const seen = realtime.lastSeenOf(otherPerson.value?.id);
			return seen ? `zuletzt online ${formatRelative(seen)}` : "Direktnachricht";
		}
	}
});
</script>

<template>
	<UDashboardPanel
		id="messages-conversation"
		:ui="{ body: 'gap-0 sm:gap-0 px-3 py-4 sm:px-6 sm:py-6' }"
		@dragenter.prevent="onDragEnter"
		@dragover.prevent
		@dragleave="onDragLeave"
		@drop.prevent="onDrop"
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
					<UTooltip text="Im Chat suchen">
						<UButton
							icon="i-lucide-search"
							color="neutral"
							variant="ghost"
							aria-label="Im Chat suchen"
							@click="openList('search')"
						/>
					</UTooltip>
					<UTooltip text="Mitglieder und Einstellungen">
						<UButton
							icon="i-lucide-info"
							color="neutral"
							variant="ghost"
							aria-label="Chat-Details"
							@click="infoOpen = true"
						/>
					</UTooltip>
				</template>
			</DashboardPageHeader>

			<!-- Pinned messages: the latest one, and the list behind the counter -->
			<div
				v-if="pinned.length"
				class="flex items-center gap-1 border-b border-default bg-slate-900/50 px-3 py-1.5 sm:px-6"
			>
				<button
					type="button"
					class="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left transition hover:text-white"
					@click="jump(pinned[0]!.id)"
				>
					<UIcon name="i-lucide-pin" class="size-4 shrink-0 text-primary-400" />
					<span class="min-w-0 truncate text-sm text-slate-300">
						<span class="font-medium text-slate-100">
							{{ pinned[0]!.is_own ? "Du" : (pinned[0]!.sender?.display_name ?? "Gelöschter Account") }}:
						</span>
						{{ pinnedText(pinned[0]!) }}
					</span>
				</button>
				<UButton
					:label="pinned.length > 1 ? `Alle ${pinned.length}` : undefined"
					icon="i-lucide-list"
					color="neutral"
					variant="ghost"
					size="xs"
					aria-label="Alle angehefteten Nachrichten"
					@click="openList('pinned')"
				/>
			</div>
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
						<div v-if="row.kind === 'day'" class="sticky top-0 z-[5] flex justify-center py-2">
							<span
								class="rounded-full border border-slate-800 bg-slate-900/95 px-3 py-1 text-xs font-medium text-slate-300 shadow-sm"
							>
								{{ row.label }}
							</span>
						</div>

						<div
							v-else-if="row.kind === 'unread'"
							data-unread-divider
							class="flex scroll-mt-12 items-center gap-3 py-2"
						>
							<div class="h-px flex-1 bg-primary/40" />
							<span class="text-xs font-semibold uppercase tracking-wide text-primary-300">
								Neue Nachrichten
							</span>
							<div class="h-px flex-1 bg-primary/40" />
						</div>

						<ChatMessageBubble
							v-else
							:message="row.message"
							:show-header="row.showHeader"
							:show-sender="conversation.type !== 'direct'"
							:read-by-all-until="readByAllUntil"
							:highlighted="highlightedId === row.message.id"
							@reply="startReply(row.message)"
							@edit="startEdit(row.message)"
							@remove="openDelete(row.message)"
							@info="openReadInfo(row.message)"
							@react="react(row.message, $event)"
							@pin="setPinned(row.message, $event)"
							@jump="jump"
							@open-image="openImage"
						/>
					</template>
				</div>

				<div v-if="hasNewer" class="flex justify-center pt-4">
					<UButton
						label="Neuere Nachrichten laden"
						icon="i-lucide-arrow-down"
						color="neutral"
						variant="subtle"
						size="sm"
						:loading="loadingNewer"
						@click="loadNewer"
					/>
				</div>
			</template>

			<div ref="bottomAnchor" class="h-px shrink-0" />

			<div
				v-if="dragDepth > 0"
				class="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/85"
			>
				<UIcon name="i-lucide-upload" class="size-10 text-primary-400" />
				<p class="text-sm font-medium text-slate-200">Dateien hier ablegen, um sie anzuhängen</p>
			</div>
		</template>

		<template #footer>
			<div class="relative">
				<div
					v-if="typists.length"
					class="pointer-events-none absolute -top-8 left-3 z-10 flex items-center gap-2 rounded-full bg-slate-900/95 px-3 py-1 text-xs text-slate-300 shadow-lg ring-1 ring-slate-800 sm:left-6"
					aria-live="polite"
				>
					<span class="flex gap-0.5" aria-hidden="true">
						<span
							v-for="dot in 3"
							:key="dot"
							class="size-1.5 animate-bounce rounded-full bg-primary-400"
							:style="{ animationDelay: `${(dot - 1) * 150}ms` }"
						/>
					</span>
					{{ typingLabel(typists) }}
				</div>

				<div v-if="!atBottom || hasNewer" class="absolute -top-12 right-4 z-10 sm:right-6">
					<UChip :show="newBelow > 0" :text="newBelow > 99 ? '99+' : newBelow" size="3xl" inset>
						<UButton
							icon="i-lucide-arrow-down"
							color="neutral"
							variant="subtle"
							class="rounded-full shadow-lg"
							aria-label="Zu den neuesten Nachrichten"
							@click="backToLatest"
						/>
					</UChip>
				</div>

				<ChatComposer
					ref="composer"
					:conversation-id="conversation.id"
					:reply-to="replyTo"
					:editing="editing"
					@sent="onSent"
					@edited="onEdited"
					@cancel-reply="replyTo = null"
					@cancel-edit="editing = null"
					@edit-last="editLast"
				/>
			</div>
		</template>
	</UDashboardPanel>

	<ChatConversationInfoModal
		v-model:open="infoOpen"
		:conversation="conversation"
		@changed="emit('changed')"
		@left="emit('left')"
		@open-chat="emit('openChat', $event)"
	/>

	<ChatMessageListSlideover
		v-model:open="listOpen"
		:conversation-id="conversation.id"
		:mode="listMode"
		:pinned="pinned"
		@jump="jump"
		@unpin="setPinned($event, false)"
	/>

	<ChatImageViewer v-model:open="viewerOpen" :attachment="viewerAttachment" />

	<ChatMessageInfoModal
		v-model:open="readInfoOpen"
		:conversation-id="conversation.id"
		:message="readInfoMessage"
	/>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Nachricht löschen"
		warning-text="Die Nachricht wird mit ihren Anhängen für alle im Chat entfernt."
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
