import type { ComputedRef, InjectionKey, Ref } from "vue";
import type { GetEventsByEventIdProgramResponses } from "~/api-client";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];
type ProgramRange = { start_at: number; end_at: number };

/**
 * State the program page (`/events/:id/program`) shares with its views — "Wochenplan" (index) and
 * "Liste" (`/list`). The parent loads the items, owns the filters and the item modal; the child
 * routes only render.
 */
export interface EventProgramView {
	/** Every day of the event (`YYYY-MM-DD`). */
	days: ComputedRef<string[]>;
	/** Days the agenda shows — narrowed to the picked day on phones. */
	listDays: ComputedRef<string[]>;
	/** Items after the "Nur meine" filter. */
	visibleItems: ComputedRef<ProgramItem[]>;
	/** Nothing to list: show the empty state instead of the agenda. */
	showEmpty: ComputedRef<boolean>;
	onlyMine: Ref<boolean>;
	/** Phones get the agenda in both views (the grid needs width). */
	isNarrow: Readonly<Ref<boolean>>;
	editable: ComputedRef<boolean>;
	openItem: (item: ProgramItem) => void;
	openCreate: (range?: ProgramRange) => void;
	onMove: (item: ProgramItem, range: ProgramRange) => Promise<void>;
}

const key: InjectionKey<EventProgramView> = Symbol("event-program-view");

export function provideEventProgramView(view: EventProgramView) {
	provide(key, view);
}

export function useEventProgramView() {
	const view = inject(key);
	if (!view) throw new Error("useEventProgramView() is only available below the program page");
	return view;
}
