/**
 * useMyEventsStore — the events the signed-in user is staff of (`GET /events?scope=mine`).
 * Drives the event switcher in the sidebar. Per-user: cleared on logout.
 */
import { BasicAbstractStore } from "~/utils/abstractStore";
import type { EventWithAccess } from "~/utils/types";

class MyEventsStore extends BasicAbstractStore<EventWithAccess[]> {
	constructor() {
		super("myEvents", {
			enableAutoFetchIfEmpty: true,
		});
	}

	protected override async fetchData() {
		if (!useAppCookies().sessionToken.get().value) {
			return null;
		}

		const response = await useAPI(
			(api) => api.getEvents({ query: { scope: "mine", include_archived: "false" } }),
			true,
		);
		if (!response.success) {
			return null;
		}

		return response.data satisfies EventWithAccess[];
	}
}

export function useMyEventsStore() {
	return new MyEventsStore();
}
