<script setup lang="ts">
/**
 * A document share link for people without an account (`/s/doc/<token>`): the shared file
 * (`SharesFileView`), or the shared folder as a small file browser (`SharesFolderView`). What can be
 * done depends on the link (view, upload, edit, delete); an upload-only link is a drop box.
 * Password-protected links ask for the password first (`SharesPasswordGate`).
 */
import { Utils } from "~/utils";
import type { PublicShareInfo } from "~/utils/types";

definePageMeta({ layout: "public" });

const route = useRoute();
const brandName = useBrandName();
const token = String(route.params.token ?? "");

const info = ref<PublicShareInfo | null>(null);
const notFound = ref(false);

async function loadInfo() {
	const result = await useAPI((api) => api.getPublicDocsByToken({ path: { token } }), true);
	if (result.success) info.value = result.data;
	else notFound.value = true;
}
await loadInfo();

useSeoMeta({
	title: () => info.value?.item?.name ?? "Geteilter Link",
	robots: "noindex, nofollow",
});

const isFolder = computed(() => info.value?.kind === "folder");
</script>

<template>
	<div class="space-y-6">
		<SharesNotFound v-if="notFound || !info" />

		<SharesPasswordGate v-else-if="!info.unlocked" :token="token" @unlocked="info = $event" />

		<template v-else-if="info.item && info.permissions">
			<div class="flex flex-col gap-1">
				<p class="text-sm text-slate-400">Geteilt von {{ brandName }}</p>
				<h1 class="flex items-center gap-2 text-2xl font-semibold text-white">
					<UIcon
						:name="isFolder ? 'i-lucide-folder' : Utils.getFileIcon(info.item.name, info.item.mime_type)"
						:class="isFolder ? 'text-amber-400' : 'text-slate-400'"
						class="size-7 shrink-0"
					/>
					<span class="truncate">{{ info.item.name }}</span>
				</h1>
				<p v-if="info.expires_at" class="text-xs text-slate-500">Dieser Link gilt bis {{ formatDate(info.expires_at) }}.</p>
			</div>

			<SharesFolderView
				v-if="isFolder"
				:token="token"
				:root="info.item"
				:permissions="info.permissions"
				@locked="loadInfo"
			/>
			<SharesFileView v-else :token="token" :item="info.item" :permissions="info.permissions" @changed="loadInfo" />
		</template>
	</div>
</template>
