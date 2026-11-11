<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

defineProps<{
	collapsed?: boolean;
}>();

const toast = useToast();

const userInfoStore = useUserInfoStore();
const userInfo = await userInfoStore.use();

const role = computed(() => userInfo.value?.role);

const user = computed(() => {
	const name = userInfo.value?.display_name ?? "Unbekannt";
	return {
		name,
		avatar: {
			alt: name,
			text: initials(name),
		},
	};
});

async function logout() {
	useRealtime().stop();
	// The server ends this device's pushes with the session; the browser forgets them too.
	await usePushNotifications().forget();
	const result = await useAPI((api) => api.postAuthLogout({}), true);

	// Clear every per-user store regardless of the API result.
	await userInfoStore.clear();
	await useMyEventsStore().clear();
	clearEventDetails();
	useLastEventCookie().value = null;
	useAppCookies().sessionToken.set(null);

	toast.add(
		result.success
			? {
					title: "Abgemeldet",
					description: "Du wurdest erfolgreich abgemeldet.",
					icon: "i-lucide-check",
					color: "success",
				}
			: {
					title: "Abgemeldet",
					description: "Die lokale Sitzung wurde beendet, die Abmeldung am Server ist fehlgeschlagen.",
					icon: "i-lucide-alert-circle",
					color: "warning",
				},
	);

	await navigateTo("/auth/login");
}

const isSystem = computed(() => useInstance().value?.kind === "system");

const items = computed<DropdownMenuItem[][]>(() => [
	[
		{
			type: "label",
			label: user.value.name,
			avatar: user.value.avatar,
		},
	],
	[
		{
			label: "Einstellungen",
			icon: "i-lucide-settings",
			to: "/settings",
		},
		...(hasOrgRole(role.value, "core_team") && !isSystem.value
			? [
					{
						label: "Kernteam-Bereich",
						icon: "i-lucide-building-2",
						to: "/core-team",
					},
				]
			: []),
		...(hasOrgRole(role.value, "admin")
			? [
					{
						label: isSystem.value ? "Systemverwaltung" : "Administration",
						icon: isSystem.value ? "i-lucide-server-cog" : "i-lucide-shield",
						to: "/admin",
					},
				]
			: []),
	],
	[
		{
			label: "App installieren",
			icon: "i-lucide-smartphone",
			to: "/settings/apps",
		},
	],
	[
		{
			label: "Abmelden",
			icon: "i-lucide-log-out",
			onSelect: logout,
		},
	],
]);
</script>

<template>
	<UDropdownMenu
		:items="items"
		:content="{ align: 'center', collisionPadding: 12 }"
		:ui="{
			viewport: 'main-bg-color',
			content: collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)',
		}"
	>
		<UButton
			:avatar="user.avatar"
			:label="collapsed ? undefined : user.name"
			:trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
			color="neutral"
			variant="ghost"
			block
			:square="collapsed"
			class="data-[state=open]:bg-elevated/50 hover:bg-elevated/50"
			:ui="{ trailingIcon: 'text-dimmed' }"
		>
			<template v-if="!collapsed" #default>
				<span class="flex min-w-0 flex-1 items-center justify-between gap-2">
					<span class="truncate">{{ user.name }}</span>
					<UBadge
						v-if="role && role !== 'volunteer'"
						:label="getRoleLabel(role)"
						:color="getRoleColor(role)"
						variant="subtle"
						size="sm"
					/>
				</span>
			</template>
		</UButton>
	</UDropdownMenu>
</template>
