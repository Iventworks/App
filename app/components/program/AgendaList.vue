<script setup lang="ts">
/**
 * Program as a list grouped by day — used on phones, as the "Liste" view and for printing.
 */
import type { GetEventsByEventIdProgramResponses } from "~/api-client";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];

const props = defineProps<{
	days: string[];
	items: ProgramItem[];
}>();

const emit = defineEmits<{
	open: [item: ProgramItem];
}>();

const today = toDayString();

const groups = computed(() =>
	props.days.map((day) => ({
		day,
		items: props.items
			.filter((item) => toDayString(item.start_at) === day)
			.sort((a, b) => a.start_at - b.start_at),
	})),
);
</script>

<template>
	<div class="space-y-6">
		<section v-for="(group, index) in groups" :key="group.day" class="program-print-day break-inside-avoid">
			<h3
				:class="[
					'mb-2 flex items-baseline gap-2 text-sm font-semibold',
					group.day === today ? 'text-primary-300' : 'text-slate-200',
				]"
			>
				{{ formatLongDay(group.day) }}
				<span class="text-xs font-normal text-slate-500">
					Tag {{ index + 1 }}<template v-if="group.day === today"> · heute</template>
				</span>
			</h3>

			<p
				v-if="!group.items.length"
				class="rounded-lg border border-dashed border-slate-800 px-4 py-3 text-sm text-slate-500"
			>
				Noch kein Programm geplant.
			</p>

			<ul v-else class="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
				<li v-for="item in group.items" :key="item.id">
					<button
						type="button"
						class="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-800/40"
						@click="emit('open', item)"
					>
						<span
							class="mt-1 h-10 w-1 shrink-0 rounded-full"
							:style="{ backgroundColor: item.color ?? '#f97316' }"
						/>
						<span class="w-24 shrink-0 text-sm tabular-nums text-slate-300">
							{{ formatTimeRange(item.start_at, item.end_at) }}
						</span>
						<span class="min-w-0 flex-1">
							<span class="flex flex-wrap items-center gap-2">
								<span class="font-medium text-white">{{ item.title }}</span>
								<UBadge v-if="item.is_mine" label="Du" color="primary" variant="subtle" size="sm" />
								<UBadge v-if="item.category" :label="item.category" color="neutral" variant="outline" size="sm" />
							</span>
							<span class="mt-0.5 block text-sm text-slate-400">
								<template v-if="item.location">{{ item.location }}</template>
								<template v-if="item.location && item.responsible.length"> · </template>
								<template v-if="item.responsible.length">
									{{ item.responsible.map((person) => person.display_name).join(", ") }}
								</template>
							</span>
						</span>
						<UIcon v-if="item.files.length" name="i-lucide-paperclip" class="mt-1 size-4 text-slate-500" />
					</button>
				</li>
			</ul>
		</section>
	</div>
</template>
