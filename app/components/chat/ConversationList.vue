<script setup lang="ts">
/**
 * Conversation list for the messaging page, grouped like Teams: Kernteam, event channels,
 * group/team channels, then direct and group chats.
 */
import type { GetConversationsResponses } from "~/api-client";

type Conversation = GetConversationsResponses["200"]["data"][number];
type ConversationType = Conversation["type"];

const props = defineProps<{
	conversations: Conversation[];
	selectedId: number | null;
	loading?: boolean;
	/** Active search term — only used to word the empty state. */
	search?: string;
}>();

const emit = defineEmits<{
	select: [conversationId: number];
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

const sections = computed(() =>
	SECTIONS.map((section) => ({
		...section,
		items: props.conversations.filter((conversation) => section.types.includes(conversation.type)),
	})).filter((section) => section.items.length > 0),
);

function subtitle(conversation: Conversation) {
	if (conversation.type === "event_group" && conversation.event) return conversation.event.name;
	if (conversation.type === "group") return `${conversation.members.length} Mitglieder`;
	return null;
}

function preview(conversation: Conversation) {
	const last = conversation.last_message;
	if (!last) return "Noch keine Nachrichten";
	return last.sender_name ? `${last.sender_name}: ${last.content}` : last.content;
}

function timeLabel(ts: number | null) {
	if (!ts) return "";
	return toDayString(ts) === toDayString() ? formatTime(ts) : formatShortDay(ts);
}
</script>

<template>
	<div>
		<div v-if="loading && !conversations.length" class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-2xl text-slate-400" />
		</div>

		<UEmpty
			v-else-if="!conversations.length"
			icon="i-lucide-messages-square"
			:title="search ? 'Nichts gefunden' : 'Noch keine Chats'"
			:description="
				search
					? 'Kein Chat passt zu deiner Suche.'
					: 'Starte einen neuen Chat oder warte, bis du einem Event zugeteilt wirst.'
			"
			variant="naked"
			class="py-10"
		/>

		<div v-else class="space-y-4">
			<section v-for="section in sections" :key="section.key">
				<p class="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
									<span class="shrink-0 text-xs text-slate-500">
										{{ timeLabel(conversation.last_message_at) }}
									</span>
								</div>
								<p v-if="subtitle(conversation)" class="truncate text-xs text-slate-500">
									{{ subtitle(conversation) }}
								</p>
								<div class="flex items-center justify-between gap-2">
									<p
										:class="[
											'truncate text-xs',
											conversation.unread_count > 0 ? 'text-slate-300' : 'text-slate-500',
										]"
									>
										{{ preview(conversation) }}
									</p>
									<UBadge
										v-if="conversation.unread_count > 0"
										:label="conversation.unread_count > 99 ? '99+' : String(conversation.unread_count)"
										size="sm"
										class="shrink-0 rounded-full"
									/>
								</div>
							</div>
						</button>
					</li>
				</ul>
			</section>
		</div>
	</div>
</template>
