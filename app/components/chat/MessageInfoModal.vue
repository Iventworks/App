<script setup lang="ts">
/** Who in the chat has read one of the caller's messages. */
import type { ChatMember, ChatMessage } from "~/utils/types";

const props = defineProps<{
	conversationId: number;
	message: ChatMessage | null;
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const members = ref<ChatMember[]>([]);
const loading = ref(false);

watch(open, async (isOpen) => {
	if (!isOpen) return;
	loading.value = true;
	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMembers({ path: { conversationId: props.conversationId } }),
	);
	loading.value = false;
	if (!result.success) {
		toast.add({
			title: "Lesebestätigungen konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	members.value = result.data;
});

const others = computed(() =>
	members.value.filter((member) => member.user.id !== props.message?.sender?.id),
);
const readBy = computed(() =>
	others.value.filter((member) => (member.last_read_at ?? 0) >= (props.message?.created_at ?? 0)),
);
const unreadBy = computed(() =>
	others.value.filter((member) => (member.last_read_at ?? 0) < (props.message?.created_at ?? 0)),
);
</script>

<template>
	<DashboardModal
		v-model:open="open"
		title="Gelesen von"
		icon="i-lucide-check-check"
		:loading="loading"
	>
		<div class="space-y-5">
			<p v-if="message" class="text-sm text-slate-400">
				Gesendet am {{ formatDate(message.created_at) }}
			</p>

			<section
				v-for="section in [
					{ key: 'read', label: 'Gelesen', icon: 'i-lucide-check-check', people: readBy },
					{ key: 'unread', label: 'Noch nicht gelesen', icon: 'i-lucide-check', people: unreadBy },
				]"
				:key="section.key"
				class="space-y-2"
			>
				<p class="flex items-center gap-2 text-sm font-medium text-slate-300">
					<UIcon
						:name="section.icon"
						:class="['size-4', section.key === 'read' ? 'text-primary-400' : 'text-slate-500']"
					/>
					{{ section.label }} ({{ section.people.length }})
				</p>
				<p v-if="!section.people.length" class="text-sm text-slate-500">Niemand</p>
				<ul v-else class="divide-y divide-slate-800 rounded-lg border border-slate-800">
					<li
						v-for="member in section.people"
						:key="member.user.id"
						class="flex items-center gap-3 px-3 py-2"
					>
						<UAvatar :text="initials(member.user.display_name)" size="sm" />
						<span class="truncate text-sm text-white">{{ member.user.display_name }}</span>
					</li>
				</ul>
			</section>
		</div>
	</DashboardModal>
</template>
