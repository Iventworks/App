<script setup lang="ts">
/**
 * Who covers one responsibility on one date. Leaders pick the people from the team; staff see
 * the names and can take the duty themselves or give it back.
 */
import type { EventMember, EventOccurrence, OccurrenceResponsibility } from "~/utils/types";

const props = defineProps<{
	occurrence: EventOccurrence;
	responsibility: OccurrenceResponsibility;
	members: EventMember[];
	canManage: boolean;
	canSignUp: boolean;
	userId?: number;
}>();

const emit = defineEmits<{
	set: [userIds: number[]];
	sign: [assigned: boolean];
}>();

const people = computed(
	() =>
		props.occurrence.duties.find((duty) => duty.responsibility_id === props.responsibility.id)
			?.users ?? [],
);
const ids = computed(() => people.value.map((user) => user.id));
const mine = computed(() => props.userId !== undefined && ids.value.includes(props.userId));
const cancelled = computed(() => props.occurrence.status === "cancelled");

/**
 * The people who usually do it first, then the rest of the team — plus whoever is on this
 * duty but no longer on the team (a past date), so they can be seen and taken off.
 */
const options = computed(() => {
	const usual = new Set(props.responsibility.assignees.map((user) => user.id));
	const team = [...props.members]
		.sort(
			(a, b) =>
				Number(usual.has(b.user.id)) - Number(usual.has(a.user.id)) ||
				a.user.display_name.localeCompare(b.user.display_name, "de"),
		)
		.map((member) => ({
			label: member.user.display_name,
			value: member.user.id,
			description: usual.has(member.user.id) ? "üblich zuständig" : undefined,
		}));
	const onTeam = new Set(props.members.map((member) => member.user.id));
	const former = people.value
		.filter((user) => !onTeam.has(user.id))
		.map((user) => ({ label: user.display_name, value: user.id, description: "nicht mehr im Team" }));
	return [...team, ...former];
});

/**
 * The picks while the menu is open; sent once when it closes. Sending every click would race:
 * a second pick made before the first answer arrives was computed from the old list.
 */
const draft = ref<number[] | null>(null);
const shown = computed(() => draft.value ?? ids.value);

function onOpenChange(open: boolean) {
	if (open) {
		draft.value = [...ids.value];
		return;
	}
	const next = draft.value;
	draft.value = null;
	if (!next) return;
	const before = new Set(ids.value);
	if (next.length === before.size && next.every((id) => before.has(id))) return;
	emit("set", next);
}
</script>

<template>
	<USelectMenu
		v-if="canManage && !cancelled"
		:model-value="shown"
		:items="options"
		value-key="value"
		multiple
		variant="ghost"
		size="sm"
		placeholder="offen"
		:search-input="{ placeholder: 'Person suchen' }"
		:class="['w-full min-w-36', shown.length ? '' : 'text-amber-400']"
		:aria-label="`${responsibility.title} am ${formatDay(occurrence.date)}`"
		@update:model-value="draft = $event"
		@update:open="onOpenChange"
	/>

	<div v-else class="flex min-w-32 items-center justify-between gap-2 text-sm">
		<span v-if="people.length" class="min-w-0 text-slate-200">
			<template v-for="(person, index) in people" :key="person.id">
				<span :class="person.id === userId ? 'font-semibold text-primary-300' : ''">{{
					person.display_name
				}}</span
				><template v-if="index < people.length - 1">, </template>
			</template>
		</span>
		<span v-else :class="cancelled ? 'text-slate-600' : 'text-amber-400'">
			{{ cancelled ? "–" : "offen" }}
		</span>

		<UTooltip
			v-if="canSignUp && !cancelled"
			:text="mine ? 'Dienst wieder abgeben' : 'Diesen Dienst übernehmen'"
		>
			<UButton
				:icon="mine ? 'i-lucide-user-minus' : 'i-lucide-hand'"
				:label="mine ? undefined : 'Ich'"
				:color="mine ? 'neutral' : 'primary'"
				variant="soft"
				size="xs"
				:aria-label="mine ? 'Dienst wieder abgeben' : 'Diesen Dienst übernehmen'"
				@click="emit('sign', !mine)"
			/>
		</UTooltip>
	</div>
</template>
