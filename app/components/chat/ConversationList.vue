<script setup lang="ts">
/**
 * Conversation list for the messaging page, grouped like Teams: pinned chats, Kernteam, event
 * channels, group/team channels, then direct and group chats. While searching it also lists the
 * messages found in any chat.
 */
import type { ChatConversation, ChatSearchHit } from "~/utils/types";

type ConversationType = ChatConversation["type"];

const props = defineProps<{
	conversations: ChatConversation[];
	selectedId: number | null;
	loading?: boolean;
	/** Active search term — words the empty state and highlights it in the hits. */
	search?: string;
	/** Messages found by the search across all chats. */
	messageHits?: ChatSearchHit[];
	searchingMessages?: boolean;
}>();

const emit = defineEmits<{
	select: [conversationId: number];
	/** Open a chat at a message found by the search. */
	openHit: [hit: ChatSearchHit];
}>();

const SECTIONS: { key: string; label: string; types: ConversationType[] }[] = [
	{ key: "core", label: "Kernteam", types: ["core_team"] },
	{ key: "events", label: "Events", types: ["event"] },
	{ key: "groups", label: "Gruppen & Teams", types: ["event_group"] },
	{ key: "chats", label: "Direkt- & Gruppenchats", types: ["direct", "group"] },
];

const TYPE_ICONS: Record<ConversationType, string> = {
	core_team: "i-lucide-building-2",
	event: "i-lucide-tent",
	event_group: "i-lucide-users-round",
	group: "i-lucide-users",
	direct: "i-lucide-user",
};

const sections = computed(() => {
	const pinned = props.conversations.filter((conversation) => conversation.pinned_at !== null);
	const rest = props.conversations.filter((conversation) => conversation.pinned_at === null);
	return [
		{ key: "pinned", label: "Angeheftet", items: pinned },
		...SECTIONS.map((section) => ({
			key: section.key,
			label: section.label,
			items: rest.filter((conversation) => section.types.includes(conversation.type)),
		})),
	].filter((section) => section.items.length > 0);
});

function subtitle(conversation: ChatConversation) {
	if (conversation.type === "event_group" && conversation.event) return conversation.event.name;
	if (conversation.type === "group") return `${conversation.member_count} Mitglieder`;
	return null;
}

function preview(conversation: ChatConversation) {
	const last = conversation.last_message;
	if (!last) return "Noch keine Nachrichten";
	const text =
		last.content ||
		attachmentLabel(last.attachment_count, last.attachment_name, last.attachment_is_image);
	if (last.is_own) return `Du: ${text}`;
	// In a direct chat it is clear who wrote.
	return last.sender_name && conversation.type !== "direct" ? `${last.sender_name}: ${text}` : text;
}

function timeLabel(ts: number | null) {
	if (!ts) return "";
	return toDayString(ts) === toDayString() ? formatTime(ts) : formatShortDay(ts);
}

function hitText(hit: ChatSearchHit) {
	const message = hit.message;
	if (message.content) return excerptAround(message.content, props.search ?? "", 40);
	const images = message.attachments.filter((attachment) => attachment.is_image);
	return attachmentLabel(
		message.attachments.length,
		message.attachments[0]?.name,
		images.length === message.attachments.length,
	);
}

const searchActive = computed(() => (props.search ?? "").trim().length >= 2);
const nothingFound = computed(
	() => !props.conversations.length && !(searchActive.value && props.messageHits?.length),
);
</script>

<template>
	<div>
		<div v-if="loading && !conversations.length" class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
		</div>

		<UEmpty
			v-else-if="nothingFound && !searchingMessages"
			icon="i-lucide-messages-square"
			:title="search ? 'Nichts gefunden' : 'Noch keine Chats'"
			:description="
				search
					? 'Kein Chat und keine Nachricht passt zu deiner Suche.'
					: 'Starte einen neuen Chat oder warte, bis du einem Event zugeteilt wirst.'
			"
			variant="naked"
			class="py-10"
		/>

		<div v-else class="space-y-4">
			<section v-for="section in sections" :key="section.key">
				<p
					class="flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
				>
					<UIcon v-if="section.key === 'pinned'" name="i-lucide-pin" class="size-3" />
					{{ section.label }}
				</p>

				<ul class="space-y-0.5">
					<li v-for="conversation in section.items" :key="conversation.id">
						<button
							type="button"
							:class="[
								'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition',
								conversation.id === selectedId
									? 'bg-primary/10 ring-1 ring-inset ring-primary/40'
									: 'hover:bg-slate-800/50',
							]"
							@click="emit('select', conversation.id)"
						>
							<UAvatar
								v-if="conversation.type === 'direct'"
								:text="initials(conversation.title)"
								size="md"
								class="shrink-0"
							/>
							<div
								v-else
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-800"
								:style="conversation.group?.color ? { backgroundColor: `${conversation.group.color}33` } : undefined"
							>
								<UIcon
									:name="TYPE_ICONS[conversation.type]"
									class="size-4 text-primary-400"
									:style="conversation.group?.color ? { color: conversation.group.color } : undefined"
								/>
							</div>

							<div class="min-w-0 flex-1">
								<div class="flex items-baseline justify-between gap-2">
									<p
										:class="[
											'truncate text-sm',
											conversation.unread_count > 0 ? 'font-semibold text-white' : 'font-medium text-slate-200',
										]"
									>
										{{ conversation.title }}
									</p>
									<span class="flex shrink-0 items-center gap-1 text-xs text-slate-500">
										<UIcon
											v-if="conversation.muted"
											name="i-lucide-bell-off"
											class="size-3"
											aria-label="Stummgeschaltet"
										/>
										{{ timeLabel(conversation.last_message_at) }}
									</span>
								</div>
								<p v-if="subtitle(conversation)" class="truncate text-xs text-slate-500">
									{{ subtitle(conversation) }}
								</p>
								<div class="flex items-center justify-between gap-2">
									<p
										:class="[
											'flex min-w-0 items-center gap-1 text-xs',
											conversation.unread_count > 0 ? 'text-slate-300' : 'text-slate-500',
										]"
									>
										<UIcon
											v-if="conversation.last_message && !conversation.last_message.content"
											:name="conversation.last_message.attachment_is_image ? 'i-lucide-image' : 'i-lucide-paperclip'"
											class="size-3 shrink-0"
										/>
										<span class="truncate">{{ preview(conversation) }}</span>
									</p>
									<UBadge
										v-if="conversation.unread_count > 0"
										:label="conversation.unread_count > 99 ? '99+' : String(conversation.unread_count)"
										:color="conversation.muted ? 'neutral' : 'primary'"
										:variant="conversation.muted ? 'subtle' : 'solid'"
										size="sm"
										class="shrink-0 rounded-full"
									/>
								</div>
							</div>
						</button>
					</li>
				</ul>
			</section>

			<!-- Messages found in any chat -->
			<section v-if="searchActive && (messageHits?.length || searchingMessages)">
				<p
					class="flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
				>
					Nachrichten
					<UIcon v-if="searchingMessages" name="i-lucide-loader-2" class="size-3 animate-spin" />
				</p>
				<ul class="space-y-0.5">
					<li v-for="hit in messageHits" :key="hit.message.id">
						<button
							type="button"
							class="block w-full rounded-lg px-2 py-2 text-left transition hover:bg-slate-800/50"
							@click="emit('openHit', hit)"
						>
							<span class="flex items-baseline justify-between gap-2">
								<span class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-200">
									<UIcon :name="TYPE_ICONS[hit.conversation.type]" class="size-3.5 shrink-0 text-primary-400" />
									<span class="truncate">{{ hit.conversation.title }}</span>
								</span>
								<span class="shrink-0 text-xs text-slate-500">
									{{ timeLabel(hit.message.created_at) }}
								</span>
							</span>
							<span class="line-clamp-2 break-words text-xs text-slate-400">
								<span class="text-slate-300">
									{{ hit.message.is_own ? "Du" : (hit.message.sender?.display_name ?? "Gelöschter Account") }}:
								</span>
								<template v-for="(part, index) in highlightTerm(hitText(hit), search ?? '')" :key="index">
									<mark v-if="part.type === 'mark'" class="rounded bg-primary/30 px-0.5 text-white">{{
										part.text
									}}</mark>
									<template v-else>{{ part.text }}</template>
								</template>
							</span>
						</button>
					</li>
				</ul>
			</section>
		</div>
	</div>
</template>
