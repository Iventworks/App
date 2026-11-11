<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";
import { useMyEventsStore } from "~/composables/stores/useMyEventsStore";
import { useUserInfoStore } from "~/composables/stores/useUserStore";
import type { EventWithAccess } from "~/utils/types";

const props = defineProps<{
	collapsed?: boolean;
	/** The event currently shown in the sidebar (may be one the user is not staff of). */
	selected: EventWithAccess | null;
}>();

const myEvents = await useMyEventsStore().use();
const user = await useUserInfoStore().use();
const selectedEventId = useSelectedEventId();
const route = useRoute();

function eventAvatar(event: Pick<EventWithAccess, "name" | "type">) {
	return { icon: EVENT_TYPE_ICONS[event.type], alt: event.name };
}

function selectEvent(event: EventWithAccess) {
	selectedEventId.value = event.id;
	// Stay on the same section when switching between events.
	const match = route.path.match(/^\/events\/\d+(\/.*)?$/);
	return navigateTo(`/events/${event.id}${match?.[1] ?? ""}`);
}

const items = computed<DropdownMenuItem[][]>(() => {
	const today = toDayString();
	const events = myEvents.value ?? [];
	const groups: DropdownMenuItem[][] = [];

	const toItem = (event: EventWithAccess): DropdownMenuItem => ({
		label: event.name,
		avatar: eventAvatar(event),
		description: eventDateLabel(event),
		onSelect: () => selectEvent(event),
	});

	// A recurring event runs on the days of its dates, and is upcoming until its last one.
	const running = events.filter((e) => eventPhase(e, today) === "running");
	const upcoming = events.filter((e) => eventPhase(e, today) === "upcoming");
	const past = events.filter((e) => eventPhase(e, today) === "past").slice(0, 5);

	if (running.length)
		groups.push([{ type: "label", label: "Läuft gerade" }, ...running.map(toItem)]);
	if (upcoming.length)
		groups.push([{ type: "label", label: "Bevorstehend" }, ...upcoming.map(toItem)]);
	if (past.length) groups.push([{ type: "label", label: "Vergangen" }, ...past.map(toItem)]);
	if (!groups.length) {
		groups.push([
			{ label: "Du bist noch keinem Event zugeteilt", icon: "i-lucide-info", disabled: true },
		]);
	}

	groups.push([
		{ label: "Alle meine Events", icon: "i-lucide-list", to: "/events" },
		...(hasOrgRole(user.value?.role, "core_team")
			? [
					{
						label: "Freizeit / Event anlegen",
						icon: "i-lucide-circle-plus",
						to: "/core-team/events?create=1",
					},
				]
			: []),
	]);

	return groups;
});
</script>

<template>
	<UDropdownMenu
		:items="items"
		:content="{ align: 'center', collisionPadding: 12 }"
		:ui="{
			viewport: 'main-bg-color',
			content: collapsed ? 'w-64' : 'w-(--reka-dropdown-menu-trigger-width)',
		}"
	>
		<UButton
			:avatar="props.selected ? eventAvatar(props.selected) : { icon: 'i-lucide-tent' }"
			:label="collapsed ? undefined : (props.selected?.name ?? 'Event auswählen')"
			:trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
			color="neutral"
			variant="ghost"
			block
			:square="collapsed"
			class="data-[state=open]:bg-elevated"
			:class="[!collapsed && 'py-2']"
			:ui="{ trailingIcon: 'text-dimmed', label: 'truncate' }"
		/>
	</UDropdownMenu>
</template>
