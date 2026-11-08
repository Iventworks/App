<script setup lang="ts">
/** Organisation-wide news from the core team (read-only here; managed under /core-team). */
import type { GetOrgAnnouncementsResponses } from "~/api-client";
import { useUserInfoStore } from "~/composables/stores/useUserStore";

type Announcement = GetOrgAnnouncementsResponses["200"]["data"][number];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Neuigkeiten | CMP", description: "Neuigkeiten aus der Organisation" });

const toast = useToast();
const user = await useUserInfoStore().use();
const canManage = computed(() => hasOrgRole(user.value?.role, "core_team"));

const { data: announcements, loading } = await useAPIAsyncData("org-announcements", async () => {
	const result = await useAPI((api) => api.getOrgAnnouncements({ query: { limit: 100 } }));
	if (!result.success) {
		toast.add({
			title: "Neuigkeiten konnten nicht geladen werden",
			description: result.message,
			color: "error",
		});
		return [] as Announcement[];
	}
	return result.data;
});

const pinned = computed(() => (announcements.value ?? []).filter((entry) => entry.pinned));
const others = computed(() => (announcements.value ?? []).filter((entry) => !entry.pinned));
</script>

<template>
	<UDashboardPanel id="news">
		<template #header>
			<DashboardPageHeader title="Neuigkeiten" icon="i-lucide-megaphone" description="Aus der Organisation">
				<template #right>
					<UButton
						v-if="canManage"
						label="Verwalten"
						icon="i-lucide-settings-2"
						color="neutral"
						variant="subtle"
						to="/core-team/announcements"
					/>
				</template>
			</DashboardPageHeader>
		</template>

		<template #body>
			<DashboardPageBody class="mx-auto w-full max-w-3xl">
				<div v-if="loading && !announcements" class="flex justify-center py-12">
					<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
				</div>

				<UEmpty
					v-else-if="!announcements?.length"
					icon="i-lucide-megaphone-off"
					title="Keine Neuigkeiten"
					description="Das Kernteam hat noch nichts veröffentlicht."
				/>

				<template v-else>
					<article
						v-for="announcement in [...pinned, ...others]"
						:key="announcement.id"
						:class="[
							'overflow-hidden rounded-xl border',
							announcement.priority === 'important'
								? 'border-amber-700/50 bg-amber-950/20'
								: 'border-slate-800 bg-slate-900/60',
						]"
					>
						<header class="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<UIcon v-if="announcement.pinned" name="i-lucide-pin" class="size-4 text-primary-400" />
									<h2 class="text-lg font-semibold text-white">{{ announcement.title }}</h2>
									<UBadge
										v-if="announcement.priority === 'important'"
										label="Wichtig"
										color="warning"
										variant="subtle"
										icon="i-lucide-alert-triangle"
										size="sm"
									/>
								</div>
								<p class="mt-1 flex items-center gap-2 text-xs text-slate-400">
									<UAvatar :text="initials(announcement.creator?.display_name ?? 'Kernteam')" size="3xs" />
									{{ announcement.creator?.display_name ?? "Kernteam" }} ·
									<time :title="formatDate(announcement.created_at)">{{ formatRelative(announcement.created_at) }}</time>
								</p>
							</div>
						</header>
						<div class="px-6 pt-3 pb-5 text-sm text-slate-200">
							<ContentMarkdownView :content="announcement.content" />
						</div>
					</article>
				</template>
			</DashboardPageBody>
		</template>
	</UDashboardPanel>
</template>
