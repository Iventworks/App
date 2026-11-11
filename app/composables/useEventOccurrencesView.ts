import type { DropdownMenuItem } from "@nuxt/ui";
import type { ComputedRef, InjectionKey, Ref } from "vue";
import type { EventMember, EventOccurrence, OccurrenceResponsibility } from "~/utils/types";

/**
 * State the dates page of a recurring event (`/events/:id/occurrences`) shares with its views —
 * "Termine" (index) and "Dienstplan" (`/roster`). The parent loads the dates, the responsibilities
 * and the team, owns the filters, the modals and every change; the child routes render.
 */
export interface EventOccurrencesView {
	/** The dates after the filters (scope, "Nur meine"), ascending. */
	visible: ComputedRef<EventOccurrence[]>;
	/** Every date, unfiltered. */
	all: ComputedRef<EventOccurrence[]>;
	/** The columns of the duty roster. */
	responsibilities: ComputedRef<OccurrenceResponsibility[]>;
	members: Ref<EventMember[] | null | undefined>;
	scope: Ref<"upcoming" | "past" | "all">;
	today: string;
	userId: ComputedRef<number | undefined>;
	canManage: ComputedRef<boolean>;
	/** The caller is on the event's team and can take a duty themselves. */
	canSignUp: ComputedRef<boolean>;
	openCreate: () => void;
	/** Edit / cancel / delete menu of one date (leaders only). */
	entryMenu: (occurrence: EventOccurrence) => DropdownMenuItem[][];
	/** Set who covers a responsibility on a date. */
	setDuty: (
		occurrence: EventOccurrence,
		responsibilityId: number,
		userIds: number[],
	) => Promise<void>;
	/** Take a duty oneself, or give it back. */
	signUp: (
		occurrence: EventOccurrence,
		responsibilityId: number,
		assigned: boolean,
	) => Promise<void>;
}

const key: InjectionKey<EventOccurrencesView> = Symbol("event-occurrences-view");

export function provideEventOccurrencesView(view: EventOccurrencesView) {
	provide(key, view);
}

export function useEventOccurrencesView() {
	const view = inject(key);
	if (!view) {
		throw new Error("useEventOccurrencesView() is only available below the dates page");
	}
	return view;
}
