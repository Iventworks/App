<script setup lang="ts">
/**
 * Messaging (Teams-like): conversation list + open conversation side by side; on phones either
 * the list or the conversation. The open chat lives in `?c=<conversationId>` (with `&m=<messageId>`
 * to open it at a message, e.g. a search hit); deep links `?channel=core_team`,
 * `?event=<eventId>` and `?group=<groupId>` resolve to the matching channel, and
 * `/messages/<conversationId>` redirects here.
 */
import {
	breakpointsTailwind,
	refDebounced,
	useBreakpoints,
	useDocumentVisibility,
	useIntervalFn,
} from "@vueuse/core";
import type { ChatConversation, ChatSearchHit } from "~/utils/types";

type Conversation = ChatConversation;

definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Nachrichten" });

const LIST_POLL_MS = 15_000;

const route = useRoute();
const router = useRouter();
const toast = useToast();
const isMobile = useBreakpoints(breakpointsTailwind).smaller("lg");
const visibility = useDocumentVisibility();

const {
	data: conversations,
	loading,
	refresh,
} = await useAPIAsyncData("conversations", async () => {
	const result = await useAPI((api) => api.getConversations({}));
	if (!result.success) {
		toast.add({
			title: "Chats konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Conversation[];
	}
	return result.data;
});

// --- selection & deep links -----------------------------------------------------------------

const selectedId = computed(() => {
	const id = Number(route.query.c);
	return Number.isInteger(id) && id > 0 ? id : null;
});

const selected = computed(
	() => conversations.value?.find((conversation) => conversation.id === selectedId.value) ?? null,
);

/** The message to open the chat at (`?m=`), handed to the pane once. */
const jumpTo = computed(() => {
	const id = Number(route.query.m);
	return Number.isInteger(id) && id > 0 ? id : null;
});

function select(conversationId: number | null, messageId?: number) {
	return router.push({
		query: conversationId
			? { c: String(conversationId), ...(messageId ? { m: String(messageId) } : {}) }
			: {},
	});
}

function onJumped() {
	if (route.query.m === undefined) return;
	const { m: _handled, ...query } = route.query;
	void router.replace({ query });
}

let retriedMissing = false;

async function resolveRoute() {
	const list = conversations.value ?? [];
	const { channel, event, group } = route.query;

	if (channel || event || group) {
		const match =
			channel === "core_team"
				? list.find((conversation) => conversation.type === "core_team")
				: event
					? list.find(
							(conversation) => conversation.type === "event" && conversation.event?.id === Number(event),
						)
					: list.find(
							(conversation) =>
								conversation.type === "event_group" && conversation.group?.id === Number(group),
						);

		if (match) {
			await router.replace({ query: { c: String(match.id) } });
		} else {
			toast.add({
				title: "Chat nicht gefunden",
				description: "Du hast keinen Zugriff auf diesen Kanal.",
				color: "warning",
			});
			await router.replace({ query: {} });
		}
		return;
	}

	// A conversation that is not in the list yet (just created): reload once.
	if (selectedId.value && !selected.value && !loading.value) {
		if (!retriedMissing) {
			retriedMissing = true;
			await refresh();
			return;
		}
		toast.add({ title: "Chat nicht gefunden", color: "warning" });
		await router.replace({ query: {} });
	}
}

watch(
	() => [
		route.query.c,
		route.query.channel,
		route.query.event,
		route.query.group,
		conversations.value,
	],
	() => void resolveRoute(),
	{ immediate: true },
);

watch(selectedId, () => {
	retriedMissing = false;
});

// --- list ------------------------------------------------------------------------------------

const search = ref("");

const filtered = computed(() => {
	const term = search.value.trim().toLowerCase();
	const list = conversations.value ?? [];
	if (!term) return list;
	return list.filter((conversation) =>
		[conversation.title, conversation.name, conversation.event?.name, conversation.group?.name]
			.filter(Boolean)
			.some((value) => value!.toLowerCase().includes(term)),
	);
});

// Messages found in any chat, searched on the server while the term is long enough.
const searchDebounced = refDebounced(search, 300);
const messageHits = ref<ChatSearchHit[]>([]);
const searchingMessages = ref(false);
let searchRequest = 0;

watch(searchDebounced, async (value) => {
	const term = value.trim();
	const current = ++searchRequest;
	if (term.length < 2) {
		messageHits.value = [];
		searchingMessages.value = false;
		return;
	}
	searchingMessages.value = true;
	const result = await useAPI((api) => api.getConversationsSearch({ query: { q: term } }));
	if (current !== searchRequest) return;
	searchingMessages.value = false;
	messageHits.value = result.success ? result.data : [];
});

function openHit(hit: ChatSearchHit) {
	void select(hit.conversation.id, hit.message.id);
}

const { pause, resume } = useIntervalFn(() => void refresh(), LIST_POLL_MS, { immediate: false });

watch(visibility, (state) => (state === "visible" ? resume() : pause()), { immediate: true });

onBeforeUnmount(pause);

function onRead(conversationId: number) {
	if (!conversations.value) return;
	conversations.value = conversations.value.map((conversation) =>
		conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation,
	);
}

async function onLeft() {
	await select(null);
	await refresh();
}

// --- new chat ------------------------------------------------------------------------------

const newOpen = ref(false);

async function onCreated(conversationId: number) {
	await refresh();
	await select(conversationId);
}
</script>

<template>
	<UDashboardPanel
		v-if="!isMobile || !selected"
		id="messages-list"
		:default-size="28"
		:min-size="20"
		:max-size="40"
		:resizable="!isMobile"
		:ui="{ body: 'gap-0 p-2 sm:gap-0 sm:p-2' }"
	>
		<template #header>
			<DashboardPageHeader title="Nachrichten" icon="i-lucide-messages-square" />
		</template>

		<template #body>
			<!-- The list column's own filter row: search + new chat stay on top while the list scrolls. -->
			<div class="main-bg-color sticky top-0 z-10 flex items-center gap-2 pb-3">
				<UInput
					v-model="search"
					icon="i-lucide-search"
					placeholder="Chats und Nachrichten suchen"
					class="min-w-0 flex-1"
				/>
				<UTooltip text="Neuer Chat">
					<UButton icon="i-lucide-square-pen" aria-label="Neuer Chat" @click="newOpen = true" />
				</UTooltip>
			</div>

			<ChatConversationList
				:conversations="filtered"
				:selected-id="selectedId"
				:loading="loading"
				:search="search"
				:message-hits="messageHits"
				:searching-messages="searchingMessages"
				@select="select"
				@open-hit="openHit"
			/>
		</template>
	</UDashboardPanel>

	<ChatConversationPane
		v-if="selected"
		:conversation="selected"
		:show-back="isMobile"
		:jump-to="jumpTo"
		@back="select(null)"
		@read="onRead"
		@changed="refresh"
		@left="onLeft"
		@jumped="onJumped"
		@open-chat="onCreated"
	/>

	<UDashboardPanel v-else-if="!isMobile" id="messages-empty">
		<template #body>
			<UEmpty
				icon="i-lucide-messages-square"
				title="Wähle einen Chat"
				description="Links findest du die Kanäle deiner Events und Gruppen sowie deine Direkt- und Gruppenchats."
				variant="naked"
				class="my-auto"
			/>
		</template>
	</UDashboardPanel>

	<ChatNewConversationModal v-model:open="newOpen" @created="onCreated" />
</template>
