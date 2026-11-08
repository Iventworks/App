<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import type { Mail } from "~/utils/types";

const tabItems = [
	{
		label: "All",
		value: "all",
	},
	{
		label: "Unread",
		value: "unread",
	},
];
const selectedTab = ref("all");

// const { data: mails } = await useFetch<Mail[]>('/api/mails', { default: () => [] })
const mails = ref<Mail[]>([
	{
		id: 1,
		subject: "Teilnehmerliste aktualisieren",
		body: "Hallo Raphael, bitte denk daran, die Teilnehmerliste zu aktualisieren.",
		date: new Date(Date.now() - 7200 * 1000).toISOString(),
		from: {
			id: 3,
			name: "Alex Dierking",
			email: "a.dierking@crossover.info",
		},
		unread: true,
	},
	{
		id: 2,
		subject: "Freizeit Tag 2 Input",
		body: "Hi Lukas, kannst du mir noch den Input für Tag 2 schicken?",
		date: new Date().toISOString(),
		from: {
			id: 1,
			name: "Lukas Pohl",
			email: "l.pohl@crossover.info",
		},
		unread: false,
	},
	{
		id: 3,
		subject: "Absage Linus Fischer",
		body: "Hallo, Linus Fischer hat leider für die Freizeit abgesagt.",
		date: new Date(Date.now() - 3600 * 1000).toISOString(),
		from: {
			id: 2,
			name: "Raphael Below",
			email: "r.below@crossover.info",
		},
		unread: false,
	},
]);

// Filter mails based on the selected tab
const filteredMails = computed(() => {
	if (selectedTab.value === "unread") {
		//@ts-ignore
		return mails.value.filter((mail) => !!mail.unread);
	}

	return mails.value;
});

const selectedMail = ref<Mail | null>();

const isMailPanelOpen = computed({
	get() {
		return !!selectedMail.value;
	},
	set(value: boolean) {
		if (!value) {
			selectedMail.value = null;
		}
	},
});

// Reset selected mail if it's not in the filtered mails
watch(filteredMails, () => {
	if (!filteredMails.value.find((mail) => mail.id === selectedMail.value?.id)) {
		selectedMail.value = null;
	}
});

const breakpoints = useBreakpoints(breakpointsTailwind);
const isMobile = breakpoints.smaller("lg");
</script>

<template>
    <UDashboardPanel id="inbox-1" :default-size="25" :min-size="20" :max-size="30" resizable>
        <UDashboardNavbar title="Inbox">
            <template #leading>
                <UDashboardSidebarCollapse />
            </template>
            <template #trailing>
                <UBadge :label="filteredMails.length" variant="subtle" />
            </template>

            <template #right>
                <UTabs v-model="selectedTab" :items="tabItems" :content="false" size="xs" />
            </template>
        </UDashboardNavbar>
        <InboxList v-model="selectedMail" :mails="filteredMails" />
    </UDashboardPanel>

    <InboxMail v-if="selectedMail" :mail="selectedMail" @close="selectedMail = null" />
    <div v-else class="hidden lg:flex flex-1 items-center justify-center">
        <UIcon name="i-lucide-inbox" class="size-32 text-dimmed" />
    </div>

    <ClientOnly>
        <USlideover v-if="isMobile" v-model:open="isMailPanelOpen">
            <template #content>
                <InboxMail v-if="selectedMail" :mail="selectedMail" @close="selectedMail = null" />
            </template>
        </USlideover>
    </ClientOnly>
</template>