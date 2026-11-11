<script setup lang="ts">
/**
 * Details of a conversation: the caller's own settings (pinned, muted) and who is in it — for
 * every type of chat. Group chats can also be renamed, extended and left here; channels (event,
 * group, core team) say where their members come from.
 */
import type { GetUsersResponses } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { ChatConversation, ChatMember } from "~/utils/types";

type DirectoryUser = GetUsersResponses["200"]["data"][number];

const props = defineProps<{
	conversation: ChatConversation;
}>();

const emit = defineEmits<{
	changed: [];
	left: [];
	/** Open the direct chat with one of the members. */
	openChat: [conversationId: number];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const me = await useUserInfoStore().use();
const realtime = useRealtime();

const isGroup = computed(() => props.conversation.type === "group");

// --- members (any type of chat) --------------------------------------------------------------

const members = ref<ChatMember[]>([]);
const loadingMembers = ref(false);

async function loadMembers() {
	const conversationId = props.conversation.id;
	loadingMembers.value = true;
	const result = await useAPI((api) =>
		api.getConversationsByConversationIdMembers({ path: { conversationId } }),
	);
	loadingMembers.value = false;
	if (conversationId !== props.conversation.id) return;
	if (!result.success) {
		toast.add({
			title: "Mitglieder konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	members.value = result.data;
}

function memberDetail(member: ChatMember) {
	const parts: string[] = [];
	if (member.event_role) parts.push(getEventRoleLabel(member.event_role));
	if (member.position) parts.push(member.position);
	if (!parts.length) parts.push(`@${member.user.username}`);
	if (realtime.isOnline(member.user.id)) parts.push("online");
	return parts.join(" · ");
}

const startingChatWith = ref<number | null>(null);

async function startDirectChat(userId: number) {
	startingChatWith.value = userId;
	const result = await useAPI((api) =>
		api.postConversations({ body: { type: "direct", user_ids: [userId] } }),
	);
	startingChatWith.value = null;
	if (!result.success) {
		toast.add({
			title: "Chat konnte nicht geöffnet werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	open.value = false;
	emit("openChat", result.data.id);
}

// --- own settings ----------------------------------------------------------------------------

const savingPreference = ref(false);

async function setPreference(body: { pinned?: boolean; muted?: boolean }) {
	savingPreference.value = true;
	const result = await useAPI((api) =>
		api.putConversationsByConversationIdPreferences({
			path: { conversationId: props.conversation.id },
			body,
		}),
	);
	savingPreference.value = false;
	if (!result.success) {
		toast.add({
			title: "Einstellung konnte nicht gespeichert werden",
			description: result.message,
			color: "error",
		});
		return;
	}
	emit("changed");
}

// --- group: rename -------------------------------------------------------------------------

const name = ref("");
const savingName = ref(false);

watch(
	open,
	(isOpen) => {
		if (!isOpen) return;
		name.value = props.conversation.name ?? props.conversation.title;
		addUserIds.value = [];
		members.value = [];
		void loadMembers();
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
	const memberIds = new Set(members.value.map((member) => member.user.id));
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
	await loadMembers();
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
			<!-- Where the members of a channel come from -->
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

			<!-- Group chat: name -->
			<form v-else-if="isGroup" class="flex items-end gap-2" @submit.prevent="rename">
				<UFormField label="Name des Chats" class="flex-1">
					<UInput v-model="name" class="w-full" />
				</UFormField>
				<UButton type="submit" label="Speichern" :loading="savingName" color="neutral" variant="subtle" />
			</form>

			<!-- The caller's own settings -->
			<div class="divide-y divide-slate-800 rounded-lg border border-slate-800">
				<div class="flex items-center justify-between gap-4 px-3 py-2.5">
					<div class="min-w-0">
						<p class="flex items-center gap-2 text-sm font-medium text-slate-200">
							<UIcon name="i-lucide-pin" class="size-4 text-slate-400" />
							Chat anheften
						</p>
						<p class="text-xs text-slate-500">Bleibt in deiner Chatliste ganz oben.</p>
					</div>
					<USwitch
						:model-value="conversation.pinned_at !== null"
						:disabled="savingPreference"
						aria-label="Chat anheften"
						@update:model-value="setPreference({ pinned: $event })"
					/>
				</div>
				<div class="flex items-center justify-between gap-4 px-3 py-2.5">
					<div class="min-w-0">
						<p class="flex items-center gap-2 text-sm font-medium text-slate-200">
							<UIcon name="i-lucide-bell-off" class="size-4 text-slate-400" />
							Stummschalten
						</p>
						<p class="text-xs text-slate-500">
							Neue Nachrichten zählen nicht mehr zu deinen ungelesenen Nachrichten.
						</p>
					</div>
					<USwitch
						:model-value="conversation.muted"
						:disabled="savingPreference"
						aria-label="Chat stummschalten"
						@update:model-value="setPreference({ muted: $event })"
					/>
				</div>
			</div>

			<!-- Members -->
			<div class="space-y-2">
				<p class="text-sm font-medium text-slate-300">
					Mitglieder ({{ members.length || conversation.member_count }})
				</p>
				<div v-if="loadingMembers && !members.length" class="flex justify-center py-6">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-xl text-slate-400" />
				</div>
				<ul
					v-else
					class="max-h-72 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800"
				>
					<li v-for="member in members" :key="member.user.id" class="flex items-center gap-3 px-3 py-2">
						<UAvatar
							:text="initials(member.user.display_name)"
							size="sm"
							:chip="realtime.isOnline(member.user.id) ? { color: 'success', position: 'bottom-right' } : false"
						/>
						<div class="min-w-0 flex-1 text-sm">
							<p class="truncate text-white">
								{{ member.user.display_name }}
								<span v-if="member.user.id === me?.id" class="text-slate-500">(du)</span>
							</p>
							<p class="truncate text-xs text-slate-500">{{ memberDetail(member) }}</p>
						</div>
						<UTooltip
							v-if="member.user.id !== me?.id && conversation.type !== 'direct'"
							text="Direktnachricht schreiben"
						>
							<UButton
								icon="i-lucide-message-circle"
								color="neutral"
								variant="ghost"
								size="sm"
								:loading="startingChatWith === member.user.id"
								aria-label="Direktnachricht schreiben"
								@click="startDirectChat(member.user.id)"
							/>
						</UTooltip>
						<UTooltip v-if="isGroup && member.user.id !== me?.id" text="Aus dem Chat entfernen">
							<UButton
								icon="i-lucide-user-minus"
								color="neutral"
								variant="ghost"
								size="sm"
								:loading="savingMembers"
								aria-label="Aus dem Chat entfernen"
								@click="removeMember(member.user.id)"
							/>
						</UTooltip>
					</li>
				</ul>

				<!-- Direct chat: how to reach the other person -->
				<template v-if="conversation.type === 'direct'">
					<div
						v-for="member in members.filter((entry) => entry.user.id !== me?.id)"
						:key="member.user.id"
						class="space-y-0.5 px-1 pt-1 text-sm"
					>
						<p class="text-slate-400">
							@{{ member.user.username }} · {{ getRoleLabel(member.user.role) }}
						</p>
						<a :href="`mailto:${member.user.email}`" class="block text-primary-400 hover:underline">
							{{ member.user.email }}
						</a>
						<a
							v-if="member.user.phone"
							:href="`tel:${member.user.phone}`"
							class="block text-primary-400 hover:underline"
						>
							{{ member.user.phone }}
						</a>
					</div>
				</template>
			</div>

			<!-- Group chat: add people, leave -->
			<template v-if="isGroup">
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
