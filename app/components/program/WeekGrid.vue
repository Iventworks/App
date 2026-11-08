<script setup lang="ts">
/**
 * The "Wochenplan" grid: one column per event day, a time axis, program items positioned by their
 * local start/end time and laid out side by side when they overlap.
 *
 * With `editable`, items can be dragged (vertical = time, horizontal = day) and resized via the
 * bottom handle, and dragging (or tapping) on an empty slot proposes a new item. Everything uses
 * pointer events (mouse, pen and touch) and snaps to 15 minutes. The grid never mutates items:
 * it emits `move` / `create` and the page applies the change (optimistically).
 */
import { useNow } from "@vueuse/core";
import type { ComponentPublicInstance } from "vue";
import type { GetEventsByEventIdProgramResponses } from "~/api-client";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];
type Range = { start_at: number; end_at: number };

const props = withDefaults(
	defineProps<{
		days: string[];
		items: ProgramItem[];
		editable?: boolean;
	}>(),
	{ editable: false },
);

const emit = defineEmits<{
	open: [item: ProgramItem];
	create: [range: Range];
	move: [item: ProgramItem, range: Range];
}>();

const HOUR_HEIGHT = 48;
const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const SNAP = 15;
const MIN_COLUMN_WIDTH = 150;
const DEFAULT_FIRST_HOUR = 7;
const DRAG_THRESHOLD_PX = 4;
const DEFAULT_COLOR = "#f97316";

// --- time helpers (local time; Date handles DST) ------------------------------------------

function minutesOfDay(ts: number) {
	const date = new Date(ts);
	return date.getHours() * 60 + date.getMinutes();
}

function atMinutes(day: string, minutes: number) {
	const date = parseDay(day);
	date.setMinutes(minutes);
	return date.getTime();
}

function snapMinutes(minutes: number, mode: "round" | "floor" | "ceil" = "round") {
	return Math[mode](minutes / SNAP) * SNAP;
}

/** Shift a timestamp by whole days and minutes, then snap its time of day to the grid. */
function shift(ts: number, days: number, minutes: number) {
	const date = new Date(ts);
	date.setDate(date.getDate() + days);
	date.setMinutes(date.getMinutes() + minutes);
	const snapped = snapMinutes(date.getHours() * 60 + date.getMinutes());
	date.setHours(0, snapped, 0, 0);
	return date.getTime();
}

const dayBounds = computed(() =>
	props.days.map((day) => {
		const start = parseDay(day);
		const end = parseDay(day);
		end.setDate(end.getDate() + 1);
		return { start: start.getTime(), end: end.getTime() };
	}),
);

// --- drag state ---------------------------------------------------------------------------

interface DragState {
	mode: "move" | "resize" | "create";
	pointerId: number;
	startX: number;
	startY: number;
	moved: boolean;
	columnRects: DOMRect[];
	item?: ProgramItem;
	originDay: number;
	preview: Range;
	/** create: minute of day where the drag started. */
	anchorMinutes?: number;
}

const drag = ref<DragState | null>(null);
const columnEls = ref<HTMLElement[]>([]);

function setColumnRef(el: Element | ComponentPublicInstance | null, index: number) {
	if (el instanceof HTMLElement) columnEls.value[index] = el;
}

function columnIndexAt(clientX: number, rects: DOMRect[]) {
	if (!rects.length) return 0;
	for (const [index, rect] of rects.entries()) {
		if (clientX >= rect.left && clientX < rect.right) return index;
	}
	return clientX < (rects[0]?.left ?? 0) ? 0 : rects.length - 1;
}

/** Item with its live drag preview applied. */
function effectiveRange(item: ProgramItem): Range {
	const state = drag.value;
	if (state?.item?.id === item.id && state.moved && state.mode !== "create") return state.preview;
	return { start_at: item.start_at, end_at: item.end_at };
}

// --- layout -------------------------------------------------------------------------------

interface Segment {
	key: string;
	item: ProgramItem;
	dayIndex: number;
	startMin: number;
	endMin: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
	column: number;
	columns: number;
}

const segments = computed<Segment[]>(() => {
	const result: Segment[] = [];

	for (const item of props.items) {
		const range = effectiveRange(item);
		dayBounds.value.forEach((bounds, dayIndex) => {
			if (range.start_at >= bounds.end || range.end_at <= bounds.start) return;
			const segStart = Math.max(range.start_at, bounds.start);
			const segEnd = Math.min(range.end_at, bounds.end);
			result.push({
				key: `${item.id}-${dayIndex}`,
				item,
				dayIndex,
				startMin: segStart === bounds.start ? 0 : minutesOfDay(segStart),
				endMin: segEnd === bounds.end ? 24 * 60 : minutesOfDay(segEnd),
				continuesBefore: range.start_at < bounds.start,
				continuesAfter: range.end_at > bounds.end,
				column: 0,
				columns: 1,
			});
		});
	}

	// Side-by-side layout per day: greedy columns inside clusters of overlapping segments.
	for (let dayIndex = 0; dayIndex < props.days.length; dayIndex++) {
		const daySegments = result
			.filter((segment) => segment.dayIndex === dayIndex)
			.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

		let cluster: Segment[] = [];
		let columnEnds: number[] = [];
		let clusterEnd = -1;

		const closeCluster = () => {
			for (const segment of cluster) segment.columns = columnEnds.length;
			cluster = [];
			columnEnds = [];
		};

		for (const segment of daySegments) {
			if (segment.startMin >= clusterEnd) closeCluster();
			let column = columnEnds.findIndex((end) => end <= segment.startMin);
			if (column === -1) {
				column = columnEnds.length;
				columnEnds.push(segment.endMin);
			} else {
				columnEnds[column] = segment.endMin;
			}
			segment.column = column;
			cluster.push(segment);
			clusterEnd = Math.max(clusterEnd, segment.endMin);
		}
		closeCluster();
	}

	return result;
});

const firstHour = computed(() => {
	const earliest = Math.min(
		DEFAULT_FIRST_HOUR * 60,
		...segments.value.map((segment) => segment.startMin),
	);
	return Math.floor(earliest / 60);
});

const gridHeight = computed(() => (24 - firstHour.value) * HOUR_HEIGHT);
const hours = computed(() =>
	Array.from({ length: 24 - firstHour.value }, (_, index) => firstHour.value + index),
);

const gridColumns = computed(() => ({
	gridTemplateColumns: `repeat(${props.days.length}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`,
}));

function segmentStyle(segment: Segment) {
	const top = (segment.startMin - firstHour.value * 60) * PX_PER_MINUTE;
	const height = Math.max((segment.endMin - segment.startMin) * PX_PER_MINUTE, 20);
	const width = 100 / segment.columns;
	const color = segment.item.color ?? DEFAULT_COLOR;
	return {
		top: `${top}px`,
		height: `${height}px`,
		left: `calc(${segment.column * width}% + 2px)`,
		width: `calc(${width}% - 4px)`,
		backgroundColor: `color-mix(in srgb, ${color} 22%, rgb(15 23 42))`,
		borderLeftColor: color,
	};
}

const createPreview = computed(() => {
	const state = drag.value;
	if (state?.mode !== "create") return null;
	const dayIndex = state.originDay;
	const startMin = minutesOfDay(state.preview.start_at);
	const endMin =
		state.preview.end_at >= (dayBounds.value[dayIndex]?.end ?? 0)
			? 24 * 60
			: minutesOfDay(state.preview.end_at);
	return {
		dayIndex,
		label: formatTimeRange(state.preview.start_at, state.preview.end_at),
		style: {
			top: `${(startMin - firstHour.value * 60) * PX_PER_MINUTE}px`,
			height: `${Math.max((endMin - startMin) * PX_PER_MINUTE, 12)}px`,
		},
	};
});

// --- today / now --------------------------------------------------------------------------

const now = useNow({ interval: 60_000 });
const today = computed(() => toDayString(now.value));
const nowLine = computed(() => {
	const dayIndex = props.days.indexOf(today.value);
	if (dayIndex === -1) return null;
	const minutes = minutesOfDay(now.value.getTime());
	if (minutes < firstHour.value * 60) return null;
	return { dayIndex, top: (minutes - firstHour.value * 60) * PX_PER_MINUTE };
});

// --- pointer handling ---------------------------------------------------------------------

function startDrag(
	event: PointerEvent,
	state: Omit<DragState, "pointerId" | "startX" | "startY" | "moved" | "columnRects">,
) {
	drag.value = {
		...state,
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		moved: false,
		columnRects: columnEls.value.map((el) => el.getBoundingClientRect()),
	};
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", onPointerUp);
	window.addEventListener("pointercancel", onPointerCancel);
}

function stopListening() {
	window.removeEventListener("pointermove", onPointerMove);
	window.removeEventListener("pointerup", onPointerUp);
	window.removeEventListener("pointercancel", onPointerCancel);
}

function onItemPointerDown(event: PointerEvent, segment: Segment, mode: "move" | "resize") {
	if (event.button !== 0) return;
	event.stopPropagation();
	if (!props.editable) return;
	event.preventDefault();
	startDrag(event, {
		mode,
		item: segment.item,
		originDay: segment.dayIndex,
		preview: { start_at: segment.item.start_at, end_at: segment.item.end_at },
	});
}

function minutesAtPointer(clientY: number, rect: DOMRect | undefined) {
	if (!rect) return 0;
	const minutes = (clientY - rect.top) / PX_PER_MINUTE + firstHour.value * 60;
	return Math.min(Math.max(minutes, firstHour.value * 60), 24 * 60);
}

function onColumnPointerDown(event: PointerEvent, dayIndex: number) {
	if (!props.editable || event.button !== 0) return;
	const day = props.days[dayIndex];
	if (!day) return;
	const rect = columnEls.value[dayIndex]?.getBoundingClientRect();
	const anchor = snapMinutes(minutesAtPointer(event.clientY, rect), "floor");
	startDrag(event, {
		mode: "create",
		originDay: dayIndex,
		anchorMinutes: anchor,
		preview: {
			start_at: atMinutes(day, anchor),
			end_at: atMinutes(day, Math.min(anchor + 60, 24 * 60)),
		},
	});
}

function onPointerMove(event: PointerEvent) {
	const state = drag.value;
	if (!state || event.pointerId !== state.pointerId) return;

	const dx = event.clientX - state.startX;
	const dy = event.clientY - state.startY;
	if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
	state.moved = true;

	if (state.mode === "create") {
		const day = props.days[state.originDay];
		if (!day) return;
		const current = minutesAtPointer(event.clientY, state.columnRects[state.originDay]);
		const anchor = state.anchorMinutes ?? 0;
		const start = Math.min(anchor, snapMinutes(current, "floor"));
		const end = Math.max(anchor + SNAP, snapMinutes(current, "ceil"));
		state.preview = { start_at: atMinutes(day, start), end_at: atMinutes(day, end) };
		return;
	}

	const item = state.item;
	if (!item) return;
	const deltaMinutes = dy / PX_PER_MINUTE;

	if (state.mode === "resize") {
		const end = shift(item.end_at, 0, deltaMinutes);
		state.preview = { start_at: item.start_at, end_at: Math.max(end, item.start_at + SNAP * 60_000) };
		return;
	}

	const dayOffset = columnIndexAt(event.clientX, state.columnRects) - state.originDay;
	const duration = item.end_at - item.start_at;
	const start = shift(item.start_at, dayOffset, deltaMinutes);
	state.preview = { start_at: start, end_at: start + duration };
}

function onPointerUp(event: PointerEvent) {
	const state = drag.value;
	if (!state || event.pointerId !== state.pointerId) return;
	stopListening();
	drag.value = null;

	if (state.mode === "create") {
		emit("create", state.preview);
		return;
	}

	const item = state.item;
	if (!item) return;
	if (!state.moved) {
		emit("open", item);
		return;
	}
	if (state.preview.start_at !== item.start_at || state.preview.end_at !== item.end_at) {
		emit("move", item, state.preview);
	}
}

function onPointerCancel() {
	stopListening();
	drag.value = null;
}

onBeforeUnmount(stopListening);

// Read-only items still open on click.
function onItemClick(segment: Segment) {
	if (!props.editable) emit("open", segment.item);
}

// --- initial scroll -----------------------------------------------------------------------

const scroller = ref<HTMLElement | null>(null);

onMounted(() => {
	const el = scroller.value;
	if (!el) return;
	const earliestItem = Math.min(...segments.value.map((segment) => segment.startMin), 8 * 60);
	el.scrollTop = Math.max(0, (earliestItem - firstHour.value * 60 - 30) * PX_PER_MINUTE);
	const todayIndex = props.days.indexOf(today.value);
	if (todayIndex > 0) el.scrollLeft = todayIndex * MIN_COLUMN_WIDTH;
});
</script>

<template>
	<div
		ref="scroller"
		class="max-h-[calc(100dvh-13rem)] overflow-auto rounded-xl border border-slate-800 bg-slate-900/40"
	>
		<div class="relative" :style="{ minWidth: `${56 + days.length * MIN_COLUMN_WIDTH}px` }">
			<!-- day headers -->
			<div class="sticky top-0 z-30 flex border-b border-slate-800 bg-slate-950/95 backdrop-blur">
				<div class="sticky left-0 z-40 w-14 shrink-0 bg-slate-950" />
				<div class="grid flex-1" :style="gridColumns">
					<div
						v-for="(day, index) in days"
						:key="day"
						:class="[
							'border-l border-slate-800 px-2 py-2 text-center text-sm',
							day === today ? 'text-primary-300' : 'text-slate-300',
						]"
					>
						<p class="font-medium">{{ formatShortDay(day) }}</p>
						<p class="text-xs text-slate-500">
							Tag {{ index + 1 }}<template v-if="day === today"> · heute</template>
						</p>
					</div>
				</div>
			</div>

			<div class="flex">
				<!-- time axis -->
				<div class="sticky left-0 z-20 w-14 shrink-0 bg-slate-950/95" :style="{ height: `${gridHeight}px` }">
					<div
						v-for="hour in hours"
						:key="hour"
						class="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-slate-500"
						:style="{ top: `${(hour - firstHour) * HOUR_HEIGHT}px` }"
					>
						<template v-if="hour !== firstHour">{{ String(hour).padStart(2, "0") }}:00</template>
					</div>
				</div>

				<!-- day columns -->
				<div class="grid flex-1" :style="gridColumns">
					<div
						v-for="(day, dayIndex) in days"
						:key="day"
						:ref="(el) => setColumnRef(el as Element | null, dayIndex)"
						:class="[
							'program-hour-lines relative border-l border-slate-800',
							day === today ? 'bg-primary/[0.03]' : '',
							editable ? 'cursor-crosshair' : '',
						]"
						:style="{ height: `${gridHeight}px` }"
						@pointerdown="onColumnPointerDown($event, dayIndex)"
					>
						<div
							v-for="segment in segments.filter((s) => s.dayIndex === dayIndex)"
							:key="segment.key"
							role="button"
							tabindex="0"
							:aria-label="`${segment.item.title}, ${formatTimeRange(segment.item.start_at, segment.item.end_at)}`"
							:class="[
								'group absolute z-10 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-xs shadow-sm outline-none ring-primary transition-shadow focus-visible:ring-2',
								editable ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer',
								drag?.item?.id === segment.item.id && drag.moved ? 'z-20 opacity-90 shadow-lg ring-2' : '',
								segment.item.is_mine ? 'ring-1 ring-primary/60' : '',
								segment.continuesBefore ? 'rounded-t-none' : '',
								segment.continuesAfter ? 'rounded-b-none' : '',
							]"
							:style="segmentStyle(segment)"
							@pointerdown="onItemPointerDown($event, segment, 'move')"
							@click="onItemClick(segment)"
							@keydown.enter.prevent="emit('open', segment.item)"
							@keydown.space.prevent="emit('open', segment.item)"
						>
							<p class="truncate font-medium text-white">{{ segment.item.title }}</p>
							<p class="truncate text-slate-300 tabular-nums">
								{{ formatTimeRange(effectiveRange(segment.item).start_at, effectiveRange(segment.item).end_at) }}
							</p>
							<p v-if="segment.item.location" class="truncate text-slate-400">
								<UIcon name="i-lucide-map-pin" class="-mt-0.5 size-3" /> {{ segment.item.location }}
							</p>
							<div v-if="segment.item.responsible.length" class="mt-1 flex -space-x-1">
								<UAvatar
									v-for="person in segment.item.responsible.slice(0, 4)"
									:key="person.id"
									:text="initials(person.display_name)"
									:alt="person.display_name"
									size="3xs"
									class="ring-1 ring-slate-900"
								/>
								<span v-if="segment.item.responsible.length > 4" class="pl-2 text-slate-400">
									+{{ segment.item.responsible.length - 4 }}
								</span>
							</div>
							<UIcon
								v-if="segment.item.files.length"
								name="i-lucide-paperclip"
								class="absolute right-1.5 top-1.5 size-3 text-slate-400"
							/>

							<div
								v-if="editable && !segment.continuesAfter"
								class="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
								@pointerdown="onItemPointerDown($event, segment, 'resize')"
							>
								<div class="mx-auto mt-0.5 h-1 w-6 rounded-full bg-white/60" />
							</div>
						</div>

						<div
							v-if="createPreview?.dayIndex === dayIndex"
							class="pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed border-primary bg-primary/15 px-2 py-1 text-xs text-primary-200"
							:style="createPreview.style"
						>
							Neuer Programmpunkt · {{ createPreview.label }}
						</div>

						<div
							v-if="nowLine?.dayIndex === dayIndex"
							class="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-red-500"
							:style="{ top: `${nowLine.top}px` }"
						>
							<div class="-mt-[3px] -ml-1 size-2 rounded-full bg-red-500" />
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.program-hour-lines {
	background-image:
		repeating-linear-gradient(
			to bottom,
			rgb(30 41 59 / 0.9) 0 1px,
			transparent 1px 24px,
			rgb(30 41 59 / 0.35) 24px 25px,
			transparent 25px 48px
		);
}
</style>
