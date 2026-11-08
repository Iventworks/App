<script setup lang="ts">
/** Start a direct chat with one person or a group chat with several. */
import type { GetUsersResponses } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type DirectoryUser = GetUsersResponses["200"]["data"][number];

const emit = defineEmits<{
	/** The new (or existing 1:1) conversation's id. */
	created: [conversationId: number];
}>();

const open = defineModel<boolean>("open", { required: true });

const toast = useToast();
const me = await useUserInfoStore().use();

const mode = ref<"direct" | "group">("direct");
const users = ref<DirectoryUser[]>([]);
const directUserId = ref<number | undefined>(undefined);
const groupUserIds = ref<number[]>([]);
const groupName = ref("");
const saving = ref(false);

watch(open, async (isOpen) => {
	if (!isOpen) return;
	mode.value = "direct";
	directUserId.value = undefined;
	groupUserIds.value = [];
	groupName.value = "";
	if (!users.value.length) {
		const result = await useAPI((api) => api.getUsers({}));
		if (result.success) {
			users.value = result.data;
		} else {
			toast.add({
				title: "Personen konnten nicht geladen werden",
				description: result.message,
				color: "error",
			});
		}
	}
});

const userOptions = computed(() =>
	users.value
		.filter((user) => user.id !== me.value?.id)
		.map((user) => ({
			label: user.display_name,
			value: user.id,
			description: `@${user.username}`,
			avatar: { text: initials(user.display_name) },
		})),
);

const canSubmit = computed(() =>
	mode.value === "direct"
		? directUserId.value !== undefined
		: groupUserIds.value.length > 0 && groupName.value.trim().length > 0,
);

async function submit() {
	if (!canSubmit.value) return;
	saving.value = true;
	const result = await useAPI((api) =>
		api.postConversations({
			body:
				mode.value === "direct"
					? { type: "direct", user_ids: [directUserId.value as number] }
					: { type: "group", user_ids: groupUserIds.value, name: groupName.value.trim() },
		}),
	);
	saving.value = false;

	if (!result.success) {
		toast.add({
			title: "Chat konnte nicht erstellt werden",
			description: result.message,
			color: "error",
		});
		return;
	}

	open.value = false;
	emit("created", result.data.id);
}
</script>

<template>
	<DashboardModal v-model:open="open" title="Neuer Chat" icon="i-lucide-square-pen">
		<form class="space-y-4" @submit.prevent="submit">
			<UTabs
				v-model="mode"
				:items="[
					{ label: 'Direktnachricht', value: 'direct', icon: 'i-lucide-user' },
					{ label: 'Gruppenchat', value: 'group', icon: 'i-lucide-users' },
				]"
				:content="false"
				class="w-full"
			/>

			<UFormField v-if="mode === 'direct'" label="Mit wem möchtest du schreiben?" required>
				<USelectMenu
					v-model="directUserId"
					:items="userOptions"
					value-key="value"
					placeholder="Person suchen"
					class="w-full"
				/>
			</UFormField>

			<template v-else>
				<UFormField label="Name des Chats" required>
					<UInput v-model="groupName" placeholder="z. B. Orga Sommerfest" class="w-full" />
				</UFormField>
				<UFormField label="Mitglieder" required>
					<USelectMenu
						v-model="groupUserIds"
						:items="userOptions"
						value-key="value"
						multiple
						placeholder="Personen auswählen"
						class="w-full"
					/>
				</UFormField>
			</template>

			<p class="text-xs text-slate-500">
				Kanäle für Events, Gruppen und das Kernteam entstehen automatisch — dafür brauchst du keinen
				neuen Chat.
			</p>

			<div class="flex justify-end gap-2">
				<UButton label="Abbrechen" color="neutral" variant="ghost" @click="open = false" />
				<UButton type="submit" label="Chat starten" :disabled="!canSubmit" :loading="saving" />
			</div>
		</form>
	</DashboardModal>
</template>
