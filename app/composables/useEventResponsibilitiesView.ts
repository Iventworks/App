import type { DropdownMenuItem } from "@nuxt/ui";
import type { ComputedRef, InjectionKey, Ref } from "vue";
import type {
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdResponsibilitiesResponses,
} from "~/api-client";

type Responsibility = GetEventsByEventIdResponsibilitiesResponses["200"]["data"][number];
type Member = GetEventsByEventIdMembersResponses["200"]["data"][number];

/**
 * State the responsibilities page (`/events/:id/responsibilities`) shares with its views — "Nach
 * Bereich" (index) and "Nach Person" (`/people`). The parent loads responsibilities and team, owns
 * the filters and the create/edit/delete modals; the child routes group and render.
 */
export interface EventResponsibilitiesView {
	responsibilities: Ref<Responsibility[] | null | undefined>;
	members: Ref<Member[] | null | undefined>;
	/** Lower-cased search term ("" when empty). */
	term: ComputedRef<string>;
	onlyMine: Ref<boolean>;
	/** The signed-in user, to highlight and filter "mine". */
	userId: ComputedRef<number | undefined>;
	canManage: ComputedRef<boolean>;
	/** Edit / delete menu of one responsibility (leaders only). */
	entryMenu: (entry: Responsibility) => DropdownMenuItem[][];
}

const key: InjectionKey<EventResponsibilitiesView> = Symbol("event-responsibilities-view");

export function provideEventResponsibilitiesView(view: EventResponsibilitiesView) {
	provide(key, view);
}

export function useEventResponsibilitiesView() {
	const view = inject(key);
	if (!view) {
		throw new Error(
			"useEventResponsibilitiesView() is only available below the responsibilities page",
		);
	}
	return view;
}
