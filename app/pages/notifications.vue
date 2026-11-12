<script setup lang="ts">
/**
 * The signed-in user's notifications as a page — what small screens open (on large screens
 * `useDashboard().openNotifications()` shows the slideover instead; this page still works there).
 * On phones the sidebar is an overlay menu that only closes on navigation, so a slideover opened
 * from it stayed hidden behind it.
 */
definePageMeta({ layout: "dashboard" });
useSeoMeta({ title: "Benachrichtigungen" });

const { notifications, loading, unreadCount, markingAll, load, open, markAllRead, remove } =
	useNotifications();
await load();
</script>

<template>
	<UDashboardPanel id="notifications">
		<template #header>
			<DashboardPageHeader
				title="Benachrichtigungen"
				icon="i-lucide-bell"
				:description="unreadCount ? `${unreadCount} ungelesen` : 'Alles gelesen'"
			>
				<template #right>
					<UButton
						v-if="unreadCount"
						label="Alle gelesen"
						icon="i-lucide-check-check"
						color="neutral"
						variant="subtle"
						:loading="markingAll"
						@click="markAllRead"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full max-w-3xl">
				<NotificationsList
					:notifications="notifications"
					:loading="loading"
					variant="card"
					@open="open"
					@remove="remove"
				/>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
