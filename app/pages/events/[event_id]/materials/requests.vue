<script setup lang="ts">
/**
 * "Anfragen": what team members asked for, without seeing the inventory. The Leitung answers
 * each in parts — from the inventory, to buy, someone brings it — or settles or rejects it; anyone
 * on the team can answer "Bringe ich mit". A request is done by itself once its answers cover it.
 */
import type { DropdownMenuItem } from "@nuxt/ui";
import type { MaterialRequest } from "~/utils/types";

const {
	manage,
	contribute,
	userId,
	requests,
	loading,
	answersOf,
	openCreate,
	openRequest,
	openDecide,
	deleteRequest,
	reopenRequest,
} = useEventMaterials();

const { value: show, items: showItems } = useQueryFilter("show", [
	{ label: "Offene", value: "open" },
	{ label: "Alle", value: "all" },
]);

const visible = computed(() =>
	show.value === "all"
		? requests.value
		: requests.value.filter((request) => request.status === "open"),
);

function remaining(request: MaterialRequest) {
	return Math.max(1, request.quantity - request.covered);
}

function answerItems(request: MaterialRequest): DropdownMenuItem[][] {
	return [
		[
			{
				label: "Aus dem Lager",
				icon: MATERIAL_KIND_ICONS.inventory,
				onSelect: () => openCreate("inventory", request),
			},
			{
				label: "Wird gekauft",
				icon: MATERIAL_KIND_ICONS.purchase,
				onSelect: () => openCreate("purchase", request),
			},
			{
				label: "Jemand bringt es mit",
				icon: MATERIAL_KIND_ICONS.own,
				onSelect: () => openCreate("own", request),
			},
		],
		[
			{ label: "Erledigt", icon: "i-lucide-check", onSelect: () => openDecide(request, "done") },
			{
				label: "Ablehnen",
				icon: "i-lucide-x",
				color: "error" as const,
				onSelect: () => openDecide(request, "rejected"),
			},
		],
	];
}

function moreItems(request: MaterialRequest): DropdownMenuItem[] {
	return [
		...(request.can_edit
			? [{ label: "Bearbeiten", icon: "i-lucide-pencil", onSelect: () => openRequest(request) }]
			: []),
		...(manage.value && request.status !== "open"
			? [
					{
						label: "Wieder öffnen",
						icon: "i-lucide-rotate-ccw",
						onSelect: () => reopenRequest(request),
					},
				]
			: []),
		...(request.can_delete
			? [
					{
						label: "Löschen",
						icon: "i-lucide-trash-2",
						color: "error" as const,
						onSelect: () => deleteRequest(request),
					},
				]
			: []),
	];
}
</script>

<template>
	<div class="space-y-4">
		<DashboardFilterBar>
			<template #left>
				<USelect v-model="show" :items="showItems" class="w-full sm:w-44" />
			</template>
			<template v-if="contribute" #right>
				<UButton label="Etwas anfragen" icon="i-lucide-plus" @click="openRequest()" />
			</template>
		</DashboardFilterBar>

		<div v-if="loading && !requests.length" class="flex justify-center py-12">
			<UIcon name="i-lucide-loader-2" class="animate-spin text-3xl text-slate-400" />
		</div>

		<UEmpty
			v-else-if="!visible.length"
			icon="i-lucide-message-circle-question"
			:title="show === 'open' ? 'Keine offenen Anfragen' : 'Noch keine Anfragen'"
			:description="
				manage
					? 'Wenn jemand aus dem Team etwas braucht, erscheint es hier.'
					: 'Dir fehlt etwas? Frag hier danach – die Leitung schaut, ob es im Lager ist, gekauft wird oder jemand es mitbringt.'
			"
		/>

		<ul v-else class="space-y-3">
			<li
				v-for="request in visible"
				:key="request.id"
				class="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
				:class="request.status !== 'open' ? 'opacity-75' : ''"
			>
				<div class="flex flex-wrap items-start gap-3">
					<div class="min-w-0 flex-1 space-y-1">
						<p class="flex flex-wrap items-center gap-2 font-medium text-white">
							{{ materialLabel(request) }}
							<UBadge
								:label="MATERIAL_REQUEST_STATUS_LABELS[request.status]"
								:color="MATERIAL_REQUEST_STATUS_COLORS[request.status]"
								variant="subtle"
								size="sm"
							/>
						</p>
						<p class="text-xs text-slate-400">
							{{ request.requested_by?.display_name ?? "Unbekannt" }} · {{ formatRelative(request.created_at) }}
							<template v-if="request.program_item">
								· für „{{ request.program_item.title }}“ ({{ formatShortDay(request.program_item.start_at) }})
							</template>
						</p>
						<p v-if="request.notes" class="whitespace-pre-line text-sm text-slate-300">{{ request.notes }}</p>
						<p
							v-if="request.answer"
							class="flex items-start gap-1.5 text-sm"
							:class="request.status === 'rejected' ? 'text-slate-400' : 'text-emerald-300'"
						>
							<UIcon name="i-lucide-message-square-reply" class="mt-0.5 size-4 shrink-0" />
							{{ request.answer }}
							<span v-if="request.decided_by" class="text-slate-500">– {{ request.decided_by.display_name }}</span>
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<UDropdownMenu v-if="manage && request.status === 'open'" :items="answerItems(request)" :ui="{ viewport: 'main-bg-color' }">
							<UButton label="Beantworten" icon="i-lucide-reply" size="sm" trailing-icon="i-lucide-chevron-down" />
						</UDropdownMenu>
						<UButton
							v-else-if="contribute && request.status === 'open' && request.requested_by?.id !== userId()"
							label="Bringe ich mit"
							:icon="MATERIAL_KIND_ICONS.own"
							size="sm"
							color="neutral"
							variant="subtle"
							@click="openCreate('own', request)"
						/>
						<UDropdownMenu v-if="moreItems(request).length" :items="moreItems(request)" :ui="{ viewport: 'main-bg-color' }">
							<UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="xs" aria-label="Aktionen" />
						</UDropdownMenu>
					</div>
				</div>

				<div v-if="answersOf(request).length || request.status === 'open'" class="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
					<p class="text-xs text-slate-500">
						Abgedeckt: {{ request.covered }} von {{ request.quantity }}
						<template v-if="request.status === 'open' && request.covered > 0"> · es fehlen noch {{ remaining(request) }}</template>
					</p>
					<p
						v-for="answer in answersOf(request)"
						:key="answer.id"
						class="flex items-center gap-2 text-sm text-slate-300"
					>
						<UIcon :name="materialOrigin(answer).icon" class="size-4 text-slate-400" />
						{{ materialLabel(answer) }}
						<UBadge :label="materialOrigin(answer).label" :color="materialOrigin(answer).color" variant="subtle" size="sm" />
					</p>
				</div>
			</li>
		</ul>
	</div>
</template>
