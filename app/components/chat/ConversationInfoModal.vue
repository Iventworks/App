<script setup lang="ts">
/**
 * Details of a conversation. Group chats: rename, add/remove members, leave. Direct chats: the
 * other person's contact details. Channels (event, group, core team): who is in it and why.
 */
import type { GetConversationsResponses, GetUsersResponses } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Conversation = GetConversationsResponses["200"]["data"][number];
type DirectoryUser = GetUsersResponses["200"]["data"][number];

const props = defineProps<{
	conversation: Conversation;
}>();

const emit = defineEmits<{
	changed: [];
	left: [];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const me = await useUserInfoStore().use();

const isGroup = computed(() => props.conversation.type === "group");
const otherPeople = computed(() =>
	props.conversation.members.filter((member) => member.id !== me.value?.id),
);

// --- group: rename -------------------------------------------------------------------------

const name = ref("");
const savingName = ref(false);

watch(
	open,
	(isOpen) => {
		if (!isOpen) return;
		name.value = props.conversation.name ?? props.conversation.title;
		addUserIds.value = [];
		if (isGroup.value) void loadUsers();
	},
	{ immediate: true },
);

async function rename() {
	const value = name.value.trim();
	if (!value || value === props.conversation.name) return;
	savingName.value = true;
	const result = await useAPI((api) =>
		api.putConversationsByConversationId({
			path: { conversationId: props.conversation.id },
			body: { name: value },
		}),
	);
	savingName.value = false;
	if (!result.success) {
		toast.add({ title: "Umbenennen fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({ title: "Chat umbenannt", color: "success", icon: "i-lucide-check" });
	emit("changed");
}

// --- group: members -----------------------------------------------------------------------

const users = ref<DirectoryUser[]>([]);
const addUserIds = ref<number[]>([]);
const savingMembers = ref(false);

async function loadUsers() {
	const result = await useAPI((api) => api.getUsers({}));
	if (result.success) users.value = result.data;
}

const addOptions = computed(() => {
	const memberIds = new Set(props.conversation.members.map((member) => member.id));
	return users.value
		.filter((user) => !memberIds.has(user.id))
		.map((user) => ({
			label: user.display_name,
			value: user.id,
			description: user.username,
			avatar: { text: initials(user.display_name) },
		}));
});

async function updateMembers(body: { add_user_ids?: number[]; remove_user_ids?: number[] }) {
	savingMembers.value = true;
	const result = await useAPI((api) =>
		api.putConversationsByConversationId({ path: { conversationId: props.conversation.id }, body }),
	);
	savingMembers.value = false;
	if (!result.success) {
		toast.add({
			title: "Mitglieder konnten nicht geändert werden",
			description: result.message,
			color: "error",
		});
		return false;
	}
	emit("changed");
	return true;
}

async function addMembers() {
	if (!addUserIds.value.length) return;
	if (await updateMembers({ add_user_ids: addUserIds.value })) {
		toast.add({ title: "Mitglieder hinzugefügt", color: "success", icon: "i-lucide-user-plus" });
		addUserIds.value = [];
	}
}

async function removeMember(userId: number) {
	await updateMembers({ remove_user_ids: [userId] });
}

// --- group: leave ---------------------------------------------------------------------------

const leaveOpen = ref(false);

async function leave() {
	const result = await useAPI((api) =>
		api.deleteConversationsByConversationIdMembership({
			path: { conversationId: props.conversation.id },
		}),
	);
	if (!result.success) {
		toast.add({ title: "Verlassen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Du hast den Chat verlassen", color: "success" });
	open.value = false;
	emit("left");
}
</script>

<template>
	<DashboardModal v-model:open="open" :title="conversation.title" icon="i-lucide-info">
		<div class="space-y-6">
			<!-- Channels with derived membership -->
			<div v-if="conversation.type === 'event'" class="space-y-3 text-sm text-slate-300">
				<p>
					In diesem Kanal sind automatisch alle Mitarbeitenden von
					<strong class="text-white">{{ conversation.event?.name }}</strong>.
				</p>
				<UButton
					v-if="conversation.event"
					:to="`/events/${conversation.event.id}`"
					label="Zum Event"
					icon="i-lucide-tent"
					color="neutral"
					variant="subtle"
					@click="open = false"
				/>
			</div>

			<div v-else-if="conversation.type === 'event_group'" class="space-y-3 text-sm text-slate-300">
				<p>
					In diesem Kanal sind automatisch alle Mitglieder der Gruppe
					<strong class="text-white">{{ conversation.group?.name }}</strong>
					<template v-if="conversation.event"> von {{ conversation.event.name }}</template>.
				</p>
				<UButton
					v-if="conversation.event"
					:to="`/events/${conversation.event.id}/groups`"
					label="Gruppen ansehen"
					icon="i-lucide-users-round"
					color="neutral"
					variant="subtle"
					@click="open = false"
				/>
			</div>

			<p v-else-if="conversation.type === 'core_team'" class="text-sm text-slate-300">
				Der interne Kanal des Kernteams. Alle Mitglieder des Kernteams (und Admins) sind automatisch
				dabei.
			</p>

			<!-- Direct chat: contact details -->
			<div v-else-if="conversation.type === 'direct'" class="space-y-3">
				<div v-for="person in otherPeople" :key="person.id" class="flex items-center gap-3">
					<UAvatar :text="initials(person.display_name)" size="lg" />
					<div class="min-w-0 space-y-0.5 text-sm">
						<p class="font-medium text-white">{{ person.display_name }}</p>
						<p class="text-slate-400">@{{ person.username }} · {{ getRoleLabel(person.role) }}</p>
						<a :href="`mailto:${person.email}`" class="block text-primary-400 hover:underline">
							{{ person.email }}
						</a>
						<a v-if="person.phone" :href="`tel:${person.phone}`" class="block text-primary-400 hover:underline">
							{{ person.phone }}
						</a>
					</div>
				</div>
			</div>

			<!-- Group chat: name + members -->
			<template v-else-if="isGroup">
				<form class="flex items-end gap-2" @submit.prevent="rename">
					<UFormField label="Name des Chats" class="flex-1">
						<UInput v-model="name" class="w-full" />
					</UFormField>
					<UButton type="submit" label="Speichern" :loading="savingName" color="neutral" variant="subtle" />
				</form>

				<div class="space-y-2">
					<p class="text-sm font-medium text-slate-300">
						Mitglieder ({{ conversation.members.length }})
					</p>
					<ul class="divide-y divide-slate-800 rounded-lg border border-slate-800">
						<li
							v-for="member in conversation.members"
							:key="member.id"
							class="flex items-center gap-3 px-3 py-2"
						>
							<UAvatar :text="initials(member.display_name)" size="sm" />
							<div class="min-w-0 flex-1 text-sm">
								<p class="truncate text-white">
									{{ member.display_name }}
									<span v-if="member.id === me?.id" class="text-slate-500">(du)</span>
								</p>
								<p class="truncate text-xs text-slate-500">@{{ member.username }}</p>
							</div>
							<UButton
								v-if="member.id !== me?.id"
								icon="i-lucide-user-minus"
								color="neutral"
								variant="ghost"
								size="sm"
								:loading="savingMembers"
								aria-label="Aus dem Chat entfernen"
								@click="removeMember(member.id)"
							/>
						</li>
					</ul>
				</div>

				<div class="flex items-end gap-2">
					<UFormField label="Personen hinzufügen" class="flex-1">
						<USelectMenu
							v-model="addUserIds"
							:items="addOptions"
							value-key="value"
							multiple
							placeholder="Personen auswählen"
							class="w-full"
						/>
					</UFormField>
					<UButton
						label="Hinzufügen"
						icon="i-lucide-user-plus"
						:disabled="!addUserIds.length"
						:loading="savingMembers"
						@click="addMembers"
					/>
				</div>

				<DashboardSectionCard title="Chat verlassen" icon="i-lucide-log-out" tone="danger">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<p class="text-sm text-slate-400">Du bekommst danach keine Nachrichten mehr aus diesem Chat.</p>
						<UButton label="Verlassen" color="error" variant="subtle" @click="leaveOpen = true" />
					</div>
				</DashboardSectionCard>
			</template>
		</div>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="leaveOpen"
		title="Chat verlassen"
		:warning-text="`Du verlässt „${conversation.title}“. Andere Mitglieder können dich wieder hinzufügen.`"
		:require-confirm-text="false"
		:on-delete="leave"
	/>
</template>
