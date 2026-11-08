/**
 * Event context for `/events/[event_id]/**` pages and the sidebar's event switcher.
 *
 * - `useSelectedEventId()` — the event in the route, else the last one visited (cookie).
 * - `useEventDetails(id)` — `GET /events/{eventId}` (event + the caller's role/permissions),
 *   cached per event in `useState` so the layout and the page share one request.
 * - `useCurrentEvent()` — for pages: the route's event, `can(permission)`, `refresh()`; throws a
 *   404/403 error page when the event is missing or not accessible.
 *
 * Permissions are only used to hide controls; the API enforces them.
 */
import type { EventPermission, EventWithAccess } from "~/utils/types";

const LAST_EVENT_COOKIE = "cmp_last_event";

function parseEventId(raw: unknown): number | null {
	const value = Array.isArray(raw) ? raw[0] : raw;
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

export function useLastEventCookie() {
	return useCookie<number | null>(LAST_EVENT_COOKIE, {
		sameSite: "lax",
		maxAge: 60 * 60 * 24 * 180,
		default: () => null,
	});
}

export function useSelectedEventId() {
	const route = useRoute();
	const lastEvent = useLastEventCookie();

	return computed<number | null>({
		get: () => parseEventId(route.params.event_id) ?? parseEventId(lastEvent.value),
		set: (value) => {
			lastEvent.value = value;
		},
	});
}

function useEventDetailsCache() {
	return useState<Record<number, EventWithAccess>>("eventDetails", () => ({}));
}

/** Load (or reuse) one event's details. Returns `null` when it is missing or not accessible. */
export async function loadEventDetails(eventId: number, force = false) {
	const cache = useEventDetailsCache();
	if (!force && cache.value[eventId]) {
		return { event: cache.value[eventId], code: 200 } as const;
	}

	const result = await useAPI((api) => api.getEventsByEventId({ path: { eventId } }));
	if (!result.success) {
		return { event: null, code: result.code as number } as const;
	}

	cache.value = { ...cache.value, [eventId]: result.data };
	return { event: result.data, code: 200 } as const;
}

/** Drop cached event details (after edits, membership changes or logout). */
export function clearEventDetails(eventId?: number) {
	const cache = useEventDetailsCache();
	if (eventId === undefined) {
		cache.value = {};
		return;
	}
	const { [eventId]: _removed, ...rest } = cache.value;
	cache.value = rest;
}

export function useEventDetailsRef(eventId: Ref<number | null>) {
	const cache = useEventDetailsCache();
	return computed(() => (eventId.value ? (cache.value[eventId.value] ?? null) : null));
}

export function canInEvent(event: EventWithAccess | null | undefined, permission: EventPermission) {
	return Boolean(event?.permissions.includes(permission));
}

export async function useCurrentEvent() {
	const route = useRoute();
	const eventId = computed(() => parseEventId(route.params.event_id));

	if (!eventId.value) {
		throw createError({ statusCode: 404, statusMessage: "Event nicht gefunden", fatal: true });
	}

	const { event: loaded, code } = await loadEventDetails(eventId.value);
	if (!loaded) {
		throw createError({
			statusCode: code === 403 ? 403 : 404,
			statusMessage:
				code === 403 ? "Du bist nicht Teil dieser Freizeit / dieses Events." : "Event nicht gefunden",
			fatal: true,
		});
	}

	useLastEventCookie().value = eventId.value;

	const event = useEventDetailsRef(eventId) as ComputedRef<EventWithAccess>;

	return {
		eventId: computed(() => eventId.value as number),
		event,
		can: (permission: EventPermission) => canInEvent(event.value, permission),
		refresh: async () => {
			if (eventId.value) await loadEventDetails(eventId.value, true);
		},
	};
}
