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

/** The people who usually do it first, then the rest of the team. */
const options = computed(() => {
	const usual = new Set(props.responsibility.assignees.map((user) => user.id));
	return [...props.members]
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
});
</script>

<template>
	<USelectMenu
		v-if="canManage && !cancelled"
		:model-value="ids"
		:items="options"
		value-key="value"
		multiple
		variant="ghost"
		size="sm"
		placeholder="offen"
		:search-input="{ placeholder: 'Person suchen' }"
		:class="['w-full min-w-36', ids.length ? '' : 'text-amber-400']"
		:aria-label="`${responsibility.title} am ${formatDay(occurrence.date)}`"
		@update:model-value="emit('set', $event)"
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
