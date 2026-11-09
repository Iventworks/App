<script setup lang="ts">
/**
 * Personal calendar on Nuxt UI's `UCalendar`: the month grid shows everything from
 * `GET /calendar/feed` (own entries, program items and spans of the user's events, task due
 * dates); the side column lists the selected day and what is coming up. Own entries are created
 * and edited here; other items link to where they live.
 */
import {
	type DateValue,
	endOfMonth,
	getLocalTimeZone,
	startOfMonth,
	today,
} from "@internationalized/date";
import type { FormSubmitEvent } from "@nuxt/ui";
import * as z from "zod";
import type { GetCalendarEntriesResponses, GetCalendarFeedResponses } from "~/api-client";
import { zPostCalendarEntriesBody } from "~/api-client/zod.gen";

type FeedItem = GetCalendarFeedResponses["200"]["data"][number];
type CalendarEntry = GetCalendarEntriesResponses["200"]["data"][number];
type Source = FeedItem["source"];

definePageMeta({ layout: "dashboard" });

useSeoMeta({ title: "Kalender", description: "Dein persönlicher Kalender" });

const toast = useToast();
const timeZone = getLocalTimeZone();

const displayedMonth = shallowRef<DateValue>(today(timeZone));
const selectedDay = shallowRef<DateValue>(today(timeZone));

const monthName = computed(() =>
	new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(
		displayedMonth.value.toDate(timeZone),
	),
);

/** The visible grid plus a week of margin on both sides (always < 120 days). */
const range = computed(() => {
	const first = startOfMonth(displayedMonth.value).subtract({ days: 7 });
	const last = endOfMonth(displayedMonth.value).add({ days: 8 });
	return { from: first.toDate(timeZone).getTime(), to: last.toDate(timeZone).getTime() };
});

// --- data ---------------------------------------------------------------------------------

const {
	data: calendar,
	loading,
	refresh,
} = await useAPIAsyncData("personal-calendar", async () => {
	const { from, to } = range.value;
	const [feed, entries] = await Promise.all([
		useAPI((api) => api.getCalendarFeed({ query: { from, to } })),
		useAPI((api) => api.getCalendarEntries({ query: { from, to } })),
	]);
	if (!feed.success) {
		toast.add({
			title: "Kalender konnte nicht geladen werden",
			description: feed.message,
			color: "error",
		});
	}
	return {
		items: feed.success ? feed.data : ([] as FeedItem[]),
		entries: entries.success ? entries.data : ([] as CalendarEntry[]),
	};
});

watch(
	() => `${displayedMonth.value.year}-${displayedMonth.value.month}`,
	() => refresh(),
);

// --- filters ------------------------------------------------------------------------------

const SOURCES: { value: Source; label: string; icon: string; fallbackColor: string }[] = [
	{ value: "entry", label: "Termine", icon: "i-lucide-calendar-check", fallbackColor: "#0ea5e9" },
	{ value: "program", label: "Programm", icon: "i-lucide-calendar-clock", fallbackColor: "#f97316" },
	{ value: "event", label: "Events", icon: "i-lucide-tent", fallbackColor: "#22c55e" },
	{ value: "task", label: "Aufgaben", icon: "i-lucide-list-checks", fallbackColor: "#a855f7" },
];

const SOURCE_META = Object.fromEntries(SOURCES.map((source) => [source.value, source])) as Record<
	Source,
	(typeof SOURCES)[number]
>;

const activeSources = ref<Set<Source>>(new Set(SOURCES.map((source) => source.value)));

function toggleSource(source: Source) {
	const next = new Set(activeSources.value);
	if (next.has(source)) next.delete(source);
	else next.add(source);
	activeSources.value = next;
}

const visibleItems = computed(() =>
	(calendar.value?.items ?? []).filter((item) => activeSources.value.has(item.source)),
);

function itemColor(item: FeedItem) {
	return item.color ?? SOURCE_META[item.source].fallbackColor;
}

// --- per-day lookup -----------------------------------------------------------------------

function dayBounds(day: DateValue) {
	const start = day.toDate(timeZone).getTime();
	const end = day.add({ days: 1 }).toDate(timeZone).getTime();
	return { start, end };
}

/** Overlap with a day; zero-length items (task due dates) count on their own day. */
function overlaps(item: FeedItem, start: number, end: number) {
	return item.start_at < end && Math.max(item.end_at, item.start_at + 1) > start;
}

function sortItems(items: FeedItem[]) {
	return [...items].sort((a, b) => {
		if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
		return a.start_at - b.start_at;
	});
}

const itemsByDay = computed(() => {
	const map = new Map<string, FeedItem[]>();
	const items = visibleItems.value;
	const first = startOfMonth(displayedMonth.value).subtract({ days: 7 });
	for (let offset = 0; offset < 50; offset++) {
		const day = first.add({ days: offset });
		const { start, end } = dayBounds(day);
		const dayItems = items.filter((item) => overlaps(item, start, end));
		if (dayItems.length) map.set(day.toString(), sortItems(dayItems));
	}
	return map;
});

function itemsFor(day: DateValue) {
	return itemsByDay.value.get(day.toString()) ?? [];
}

const selectedItems = computed(() => itemsFor(selectedDay.value));

const upcoming = computed(() => {
	const now = Date.now();
	return sortItems(visibleItems.value.filter((item) => Math.max(item.end_at, item.start_at) >= now))
		.sort((a, b) => a.start_at - b.start_at)
		.slice(0, 8);
});

function itemTime(item: FeedItem) {
	if (item.all_day) return "Ganztägig";
	if (item.source === "task") return `Fällig ${formatTime(item.start_at)}`;
	return formatTimeRange(item.start_at, item.end_at);
}

// --- navigation ---------------------------------------------------------------------------

function previousMonth() {
	displayedMonth.value = displayedMonth.value.subtract({ months: 1 });
}

function nextMonth() {
	displayedMonth.value = displayedMonth.value.add({ months: 1 });
}

function goToToday() {
	displayedMonth.value = today(timeZone);
	selectedDay.value = today(timeZone);
}

function openItem(item: FeedItem) {
	if (item.source === "entry") {
		const entry = calendar.value?.entries.find((candidate) => candidate.id === item.source_id);
		if (entry) openEdit(entry);
		return;
	}
	if (item.link) void navigateTo(item.link);
}

// --- create / edit entries ----------------------------------------------------------------

// The API takes unix ms; the form edits date / datetime-local strings.
const schema = zPostCalendarEntriesBody
	.omit({ start_at: true, end_at: true })
	.extend({ start: z.string().min(1, "Start fehlt"), end: z.string().min(1, "Ende fehlt") });

const formOpen = ref(false);
const editing = ref<CalendarEntry | null>(null);
const saving = ref(false);
const form = reactive({
	title: "",
	description: "",
	location: "",
	all_day: false,
	color: COLOR_PRESETS[5] as string,
	start: "",
	end: "",
});

function pad(value: number) {
	return String(value).padStart(2, "0");
}

function dayString(value: DateValue) {
	return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

function openCreate(day: DateValue = selectedDay.value) {
	editing.value = null;
	const base = day.toDate(timeZone);
	base.setHours(18, 0, 0, 0);
	Object.assign(form, {
		title: "",
		description: "",
		location: "",
		all_day: false,
		color: COLOR_PRESETS[5],
		start: toDateTimeInput(base.getTime()),
		end: toDateTimeInput(base.getTime() + 60 * 60 * 1000),
	});
	formOpen.value = true;
}

function openEdit(entry: CalendarEntry) {
	editing.value = entry;
	Object.assign(form, {
		title: entry.title,
		description: entry.description,
		location: entry.location ?? "",
		all_day: entry.all_day,
		color: entry.color ?? COLOR_PRESETS[5],
		start: entry.all_day ? toDayString(entry.start_at) : toDateTimeInput(entry.start_at),
		end: entry.all_day ? toDayString(entry.end_at) : toDateTimeInput(entry.end_at),
	});
	formOpen.value = true;
}

// Switching "ganztägig" converts the inputs between date and datetime-local.
watch(
	() => form.all_day,
	(allDay) => {
		if (allDay) {
			form.start = form.start.slice(0, 10);
			form.end = form.end.slice(0, 10);
		} else {
			form.start = form.start.length === 10 ? `${form.start}T18:00` : form.start;
			form.end = form.end.length === 10 ? `${form.end}T19:00` : form.end;
		}
	},
);

function toTimestamps(): { start_at: number; end_at: number } | null {
	if (form.all_day) {
		const start = parseDay(form.start).getTime();
		// Inclusive end: the last millisecond of the end day.
		const endDay = parseDay(form.end);
		endDay.setDate(endDay.getDate() + 1);
		return { start_at: start, end_at: endDay.getTime() - 1 };
	}
	const start = fromDateTimeInput(form.start);
	const end = fromDateTimeInput(form.end);
	if (start === null || end === null) return null;
	return { start_at: start, end_at: end };
}

async function submit(_event: FormSubmitEvent<unknown>) {
	const times = toTimestamps();
	if (!times || times.end_at < times.start_at) {
		toast.add({ title: "Das Ende muss nach dem Start liegen", color: "warning" });
		return;
	}

	saving.value = true;
	const body = {
		title: form.title,
		description: form.description,
		location: form.location.trim() || null,
		all_day: form.all_day,
		color: form.color,
		...times,
	};
	const target = editing.value;
	const result = target
		? await useAPI((api) => api.putCalendarEntriesByEntryId({ path: { entryId: target.id }, body }))
		: await useAPI((api) => api.postCalendarEntries({ body }));
	saving.value = false;

	if (!result.success) {
		toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
		return;
	}
	toast.add({
		title: target ? "Termin gespeichert" : "Termin angelegt",
		color: "success",
		icon: "i-lucide-check",
	});
	formOpen.value = false;
	await refresh();
}

const deleteOpen = ref(false);

async function confirmDelete() {
	const target = editing.value;
	if (!target) return;
	const result = await useAPI((api) =>
		api.deleteCalendarEntriesByEntryId({ path: { entryId: target.id } }),
	);
	if (!result.success) {
		toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
		throw new Error(result.message);
	}
	toast.add({ title: "Termin gelöscht", color: "success" });
	formOpen.value = false;
	await refresh();
}

const selectedDayLabel = computed(() => formatLongDay(dayString(selectedDay.value)));
const isTodaySelected = computed(() => selectedDay.value.compare(today(timeZone)) === 0);

/** Clicking the selected day again would deselect it; keep a day selected. */
function onSelectDay(value: unknown) {
	if (value) selectedDay.value = value as DateValue;
}
</script>

<template>
	<UDashboardPanel id="calendar">
		<template #header>
			<DashboardPageHeader title="Kalender" icon="i-lucide-calendar" description="Termine, Programm & Fristen" />
		</template>

		<template #body>
			<DashboardFilterBar>
				<template #left>
					<div class="flex flex-wrap items-center gap-2">
						<UButton
							v-for="source in SOURCES"
							:key="source.value"
							:label="source.label"
							:icon="source.icon"
							size="sm"
							:color="activeSources.has(source.value) ? 'primary' : 'neutral'"
							:variant="activeSources.has(source.value) ? 'subtle' : 'ghost'"
							:aria-pressed="activeSources.has(source.value)"
							@click="toggleSource(source.value)"
						/>
					</div>
				</template>
				<template #right>
					<UButton label="Neuer Termin" icon="i-lucide-plus" @click="openCreate()" />
				</template>
			</DashboardFilterBar>

			<div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<UCard class="border-slate-800 bg-slate-900/60 xl:col-span-2">
					<template #header>
						<div class="flex items-center justify-between gap-2">
							<h2 class="flex items-center gap-2 text-lg font-semibold capitalize text-white">
								{{ monthName }}
								<UIcon v-if="loading" name="i-lucide-loader-2" class="size-4 animate-spin text-slate-400" />
							</h2>
							<div class="flex items-center gap-1">
								<UButton label="Heute" color="neutral" variant="subtle" size="sm" @click="goToToday" />
								<UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="sm" aria-label="Vorheriger Monat" @click="previousMonth" />
								<UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="sm" aria-label="Nächster Monat" @click="nextMonth" />
							</div>
						</div>
					</template>

					<UCalendar
						:model-value="selectedDay"
						v-model:placeholder="displayedMonth"
						locale="de-DE"
						:week-starts-on="1"
						weekday-format="short"
						fixed-weeks
						color="primary"
						variant="soft"
						:ui="{
							root: 'w-full',
							header: 'hidden',
							body: 'pt-0',
							grid: 'space-y-0 overflow-hidden rounded-lg border border-default',
							gridWeekDaysRow: 'mb-0 gap-px border-b border-default bg-elevated/50',
							headCell: 'py-2 text-center text-sm font-medium text-toned',
							gridBody: 'gap-px bg-accented',
							gridRow: 'gap-px place-items-stretch',
							cell: 'w-full bg-default text-left',
							cellTrigger:
								'm-0 size-auto w-full min-h-14 sm:min-h-24 flex-col items-stretch justify-start gap-1 rounded-none p-1 sm:p-1.5 whitespace-normal cursor-pointer data-today:ring-2 data-today:ring-inset data-today:ring-primary-500',
						}"
						@update:model-value="onSelectDay"
					>
						<template #week-day="{ day }">
							{{ day.replace(".", "") }}
						</template>

						<template #day="{ day }">
							<div class="flex items-center justify-center sm:justify-between">
								<span class="text-sm font-medium">{{ day.day }}</span>
								<span
									v-if="itemsFor(day).length > 2"
									class="hidden text-[10px] text-slate-400 sm:inline"
								>
									{{ itemsFor(day).length }}
								</span>
							</div>

							<!-- Titles from sm, dots on phones -->
							<div class="hidden space-y-0.5 sm:block">
								<div
									v-for="item in itemsFor(day).slice(0, 2)"
									:key="item.id"
									class="truncate rounded px-1 py-0.5 text-[11px] leading-tight text-white"
									:style="{ backgroundColor: `${itemColor(item)}33`, borderLeft: `3px solid ${itemColor(item)}` }"
									:title="item.title"
								>
									{{ item.title }}
								</div>
								<div v-if="itemsFor(day).length > 2" class="px-1 text-[10px] text-slate-400">
									+{{ itemsFor(day).length - 2 }} weitere
								</div>
							</div>
							<div v-if="itemsFor(day).length" class="flex justify-center gap-0.5 sm:hidden">
								<span
									v-for="item in itemsFor(day).slice(0, 3)"
									:key="item.id"
									class="size-1.5 rounded-full"
									:style="{ backgroundColor: itemColor(item) }"
								/>
							</div>
						</template>
					</UCalendar>
				</UCard>

				<div class="space-y-6">
					<DashboardSectionCard
						:title="isTodaySelected ? 'Heute' : selectedDayLabel"
						:description="isTodaySelected ? selectedDayLabel : undefined"
						icon="i-lucide-calendar-check"
						flush
					>
						<template #actions>
							<UButton icon="i-lucide-plus" color="neutral" variant="ghost" size="sm" aria-label="Termin an diesem Tag" @click="openCreate(selectedDay)" />
						</template>

						<p v-if="!selectedItems.length" class="px-6 py-5 text-sm text-slate-500">
							Nichts eingetragen.
						</p>
						<ul v-else class="divide-y divide-slate-800">
							<li v-for="item in selectedItems" :key="item.id">
								<button
									type="button"
									class="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-800/40"
									@click="openItem(item)"
								>
									<span class="mt-1 h-8 w-1 shrink-0 rounded-full" :style="{ backgroundColor: itemColor(item) }" />
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-medium text-white">{{ item.title }}</p>
										<p class="text-xs text-slate-400">
											{{ itemTime(item) }}
											<template v-if="item.location"> · {{ item.location }}</template>
										</p>
										<p v-if="item.event" class="truncate text-xs text-slate-500">{{ item.event.name }}</p>
									</div>
									<UBadge v-if="item.is_mine && item.source === 'program'" label="Du" color="primary" variant="subtle" size="sm" />
									<UIcon :name="SOURCE_META[item.source].icon" class="mt-1 size-4 shrink-0 text-slate-500" />
								</button>
							</li>
						</ul>
					</DashboardSectionCard>

					<DashboardSectionCard title="Anstehend" icon="i-lucide-calendar-clock" flush>
						<p v-if="!upcoming.length" class="px-6 py-5 text-sm text-slate-500">
							In diesem Zeitraum steht nichts mehr an.
						</p>
						<ul v-else class="divide-y divide-slate-800">
							<li v-for="item in upcoming" :key="item.id">
								<button
									type="button"
									class="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-800/40"
									@click="openItem(item)"
								>
									<div class="w-14 shrink-0 text-xs text-slate-400">{{ formatShortDay(item.start_at) }}</div>
									<span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: itemColor(item) }" />
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm text-white">{{ item.title }}</p>
										<p class="truncate text-xs text-slate-500">{{ itemTime(item) }}</p>
									</div>
								</button>
							</li>
						</ul>
					</DashboardSectionCard>
				</div>
			</div>
		</template>
	</UDashboardPanel>

	<DashboardModal
		v-model:open="formOpen"
		:title="editing ? 'Termin bearbeiten' : 'Neuer Termin'"
		:icon="editing ? 'i-lucide-pencil' : 'i-lucide-calendar-plus'"
	>
		<UForm :schema="schema" :state="form" class="space-y-4" @submit="submit">
			<UFormField label="Titel" name="title" required>
				<UInput v-model="form.title" class="w-full" autofocus />
			</UFormField>

			<USwitch v-model="form.all_day" label="Ganztägig" />

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField label="Beginn" name="start" required>
					<FormDatePicker v-if="form.all_day" v-model="form.start" />
					<FormDateTimePicker v-else v-model="form.start" default-time="18:00" />
				</UFormField>
				<UFormField label="Ende" name="end" required>
					<FormDatePicker
						v-if="form.all_day"
						v-model="form.end"
						:min="form.start ? form.start.slice(0, 10) : undefined"
					/>
					<FormDateTimePicker
						v-else
						v-model="form.end"
						:min="form.start ? form.start.slice(0, 10) : undefined"
						default-time="19:00"
					/>
				</UFormField>
			</div>

			<UFormField label="Ort" name="location">
				<UInput v-model="form.location" icon="i-lucide-map-pin" class="w-full" />
			</UFormField>

			<UFormField label="Farbe" name="color">
				<div class="flex flex-wrap gap-2">
					<button
						v-for="color in COLOR_PRESETS"
						:key="color"
						type="button"
						:class="[
							'size-7 rounded-full ring-offset-2 ring-offset-slate-900 transition',
							form.color === color ? 'ring-2 ring-white' : 'hover:scale-110',
						]"
						:style="{ backgroundColor: color }"
						:aria-label="`Farbe ${color}`"
						@click="form.color = color"
					/>
				</div>
			</UFormField>

			<UFormField label="Beschreibung" name="description">
				<UTextarea v-model="form.description" :rows="3" autoresize class="w-full" />
			</UFormField>

			<div class="flex flex-wrap justify-between gap-2 pt-2">
				<UButton
					v-if="editing"
					label="Löschen"
					icon="i-lucide-trash-2"
					color="error"
					variant="ghost"
					@click="deleteOpen = true"
				/>
				<div class="ml-auto flex gap-2">
					<UButton label="Abbrechen" color="neutral" variant="ghost" @click="formOpen = false" />
					<UButton type="submit" :label="editing ? 'Speichern' : 'Anlegen'" :loading="saving" />
				</div>
			</div>
		</UForm>
	</DashboardModal>

	<DashboardDeleteModal
		v-model:open="deleteOpen"
		title="Termin löschen"
		:warning-text="`Der Termin „${editing?.title}“ wird gelöscht.`"
		:require-confirm-text="false"
		:on-delete="confirmDelete"
	/>
</template>
