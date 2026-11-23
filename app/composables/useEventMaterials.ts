/**
 * Shared state of an event's material pages (`/events/[event_id]/materials/**`).
 *
 * The parent page (`materials.vue`) loads the list once with `createEventMaterials()` and hands it
 * down with `provideEventMaterials()`; `<MaterialsDialogs />` renders the dialogs (entry, request,
 * decision, bought, program links, material period). The child pages — "Liste" (index),
 * "Anfragen" (`/requests`), "Packliste" (`/packing`) — read the data and open the dialogs through
 * `useEventMaterials()`. The inventory itself (`catalog`) is only loaded for the Leitung.
 */
import type { ComputedRef, InjectionKey } from "vue";
import type {
	GetEventsByEventIdProgramResponses,
	GetEventsByEventIdRoomsResponses,
} from "~/api-client";
import type {
	EventMaterial,
	EventMaterials,
	EventMember,
	EventOccurrence,
	EventPermission,
	EventWithAccess,
	MaterialCatalogItem,
	MaterialKind,
	MaterialLink,
	MaterialRequest,
} from "~/utils/types";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];
type Room = GetEventsByEventIdRoomsResponses["200"]["data"][number];

export async function createEventMaterials(context: {
	event: ComputedRef<EventWithAccess>;
	eventId: ComputedRef<number>;
	can: (permission: EventPermission) => boolean;
	userId: () => number | undefined;
}) {
	const { event, eventId, can } = context;
	const toast = useToast();
	const confirm = useConfirmDialog();

	const manage = computed(() => can("materials:manage"));
	const contribute = computed(() => can("materials:contribute"));
	const recurring = computed(() => event.value.type === "recurring");
	const basePath = computed(() => `/events/${eventId.value}/materials`);

	// --- data ---------------------------------------------------------------------------------

	// Started together (no await in between) so the composable needs no restored setup context.
	const [materialsData, membersData, programData, occurrencesData, roomsData] = await Promise.all([
		useAPIAsyncData(`event-${eventId.value}-materials`, async () => {
			const result = await useAPI((api) =>
				api.getEventsByEventIdMaterials({ path: { eventId: eventId.value } }),
			);
			if (!result.success) {
				toast.add({
					title: "Material konnte nicht geladen werden",
					description: result.message,
					color: "error",
				});
				return null;
			}
			return result.data as EventMaterials;
		}),
		useAPIAsyncData(`event-${eventId.value}-members`, async () => {
			const result = await useAPI((api) =>
				api.getEventsByEventIdMembers({ path: { eventId: eventId.value } }),
			);
			return result.success ? result.data : ([] as EventMember[]);
		}),
		useAPIAsyncData(`event-${eventId.value}-program`, async () => {
			const result = await useAPI((api) =>
				api.getEventsByEventIdProgram({ path: { eventId: eventId.value } }),
			);
			return result.success ? result.data : ([] as ProgramItem[]);
		}),
		useAPIAsyncData(`event-${eventId.value}-material-occurrences`, async () => {
			if (!recurring.value || !can("occurrences:view")) return [] as EventOccurrence[];
			const result = await useAPI((api) =>
				api.getEventsByEventIdOccurrences({ path: { eventId: eventId.value } }),
			);
			return result.success ? result.data.occurrences : ([] as EventOccurrence[]);
		}),
		useAPIAsyncData(`event-${eventId.value}-material-rooms`, async () => {
			if (recurring.value || !can("rooms:view")) return [] as Room[];
			const result = await useAPI((api) =>
				api.getEventsByEventIdRooms({ path: { eventId: eventId.value } }),
			);
			return result.success ? result.data : ([] as Room[]);
		}),
	]);

	const { data, loading, refresh } = materialsData;
	const members = membersData.data;
	const programItems = programData.data;
	const occurrences = occurrencesData.data;

	const items = computed(() => data.value?.items ?? []);
	const requests = computed(() => data.value?.requests ?? []);
	const period = computed(() => data.value?.period ?? null);
	const openRequests = computed(() => requests.value.filter((request) => request.status === "open"));

	/** Suggestions for "Wo?": the camp's rooms and places used before. */
	const locationSuggestions = computed(() => [
		...new Set([
			...(roomsData.data.value ?? []).map((room) => room.name),
			...items.value.map((item) => item.location).filter((value): value is string => !!value),
		]),
	]);

	const memberOptions = computed(() =>
		(members.value ?? []).map((member) => ({
			label: member.user.display_name,
			value: member.user.id,
			description: member.position ?? undefined,
		})),
	);

	/** The inventory with what this event can still book (Leitung). */
	const catalog = ref<MaterialCatalogItem[] | null>(null);
	const catalogLoading = ref(false);
	async function loadCatalog() {
		if (!manage.value) return;
		catalogLoading.value = true;
		const result = await useAPI((api) =>
			api.getEventsByEventIdMaterialsCatalog({ path: { eventId: eventId.value } }),
		);
		catalogLoading.value = false;
		if (!result.success) {
			toast.add({
				title: "Lager konnte nicht geladen werden",
				description: result.message,
				color: "error",
			});
			return;
		}
		catalog.value = result.data;
	}

	/** Replace one entry in the loaded list (after a change that returns it). */
	function replaceItem(entry: EventMaterial) {
		if (!data.value) return;
		const exists = data.value.items.some((item) => item.id === entry.id);
		data.value = {
			...data.value,
			items: exists
				? data.value.items.map((item) => (item.id === entry.id ? entry : item))
				: [...data.value.items, entry],
		};
	}

	function answersOf(request: MaterialRequest) {
		return items.value.filter((item) => item.request_id === request.id);
	}

	/**
	 * Program items that need more units than the entry has — one item alone, or several running at
	 * the same moment together. `text` names them, `short` fits a table cell.
	 */
	function linkWarnings(entry: EventMaterial) {
		const timed = entry.links.filter(
			(link): link is MaterialLink & { start_at: number; end_at: number; quantity: number } =>
				link.start_at !== null && link.end_at !== null && link.quantity !== null,
		);
		const seen = new Set<string>();
		const warnings: { text: string; short: string }[] = [];
		// The most needed at once is needed when one of the items starts: check each start.
		for (const link of timed) {
			const together = timed.filter(
				(other) => other === link || (other.start_at <= link.start_at && link.start_at < other.end_at),
			);
			const needed = together.reduce((sum, other) => sum + other.quantity, 0);
			const key = together
				.map((other) => other.id)
				.sort((a, b) => a - b)
				.join(",");
			if (needed <= entry.quantity || seen.has(key)) continue;
			seen.add(key);
			const titles = together.map((other) => `„${other.title}“`);
			warnings.push({
				text:
					titles.length === 1
						? `${titles[0]} braucht ${needed}, auf der Liste stehen ${entry.quantity}.`
						: `${titles.slice(0, -1).join(", ")} und ${titles.at(-1)} brauchen zur selben Zeit zusammen ${needed}, auf der Liste stehen ${entry.quantity}.`,
				short: `Zu wenig: ${needed} gebraucht`,
			});
		}
		return warnings;
	}

	// --- simple actions -----------------------------------------------------------------------

	async function updateEntry(entry: EventMaterial, body: Record<string, unknown>, success?: string) {
		const result = await useAPI((api) =>
			api.putEventsByEventIdMaterialsByMaterialId({
				path: { eventId: eventId.value, materialId: entry.id },
				body,
			}),
		);
		if (!result.success) {
			const conflict = (result.code as number) === 409;
			const used = body.used_quantity !== undefined;
			toast.add({
				title: !conflict ? "Speichern fehlgeschlagen" : used ? "Verbrauch zu hoch" : "Nicht genug frei",
				description: !conflict
					? result.message
					: used
						? "Im Lager steht weniger, als du als verbraucht einträgst. Das Kernteam korrigiert zuerst den Bestand."
						: "In diesem Zeitraum ist nicht mehr davon im Lager frei.",
				color: "error",
			});
			return null;
		}
		replaceItem(result.data);
		if (success) toast.add({ title: success, color: "success", icon: "i-lucide-check" });
		return result.data;
	}

	/** Packing list: shown at once, rolled back when the API refuses. */
	async function setPacking(entry: EventMaterial, status: PackingStatus) {
		const now = Date.now();
		replaceItem({
			...entry,
			packed_at: status === "open" ? null : (entry.packed_at ?? now),
			returned_at: status === "returned" ? (entry.returned_at ?? now) : null,
		});
		const saved = await updateEntry(entry, {
			packed: status !== "open",
			returned: status === "returned",
		});
		if (!saved) replaceItem(entry);
		return saved !== null;
	}

	async function removeEntry(entry: EventMaterial) {
		const choice = await confirm({
			title: `„${entry.name}“ entfernen?`,
			description:
				entry.kind === "inventory"
					? "Die Reservierung im Lager wird aufgehoben."
					: "Der Eintrag verschwindet aus der Materialliste.",
			icon: "i-lucide-trash-2",
			iconColor: "error",
			confirmLabel: "Entfernen",
			confirmColor: "error",
		});
		if (choice !== "confirm") return;
		const result = await useAPI((api) =>
			api.deleteEventsByEventIdMaterialsByMaterialId({
				path: { eventId: eventId.value, materialId: entry.id },
			}),
		);
		if (!result.success) {
			toast.add({ title: "Entfernen fehlgeschlagen", description: result.message, color: "error" });
			return;
		}
		toast.add({ title: `„${entry.name}“ entfernt`, color: "success" });
		await refresh();
	}

	async function removeLink(entry: EventMaterial, link: MaterialLink) {
		const result = await useAPI((api) =>
			api.deleteEventsByEventIdMaterialsByMaterialIdLinksByLinkId({
				path: { eventId: eventId.value, materialId: entry.id, linkId: link.id },
			}),
		);
		if (!result.success) {
			toast.add({ title: "Entfernen fehlgeschlagen", description: result.message, color: "error" });
			return null;
		}
		replaceItem(result.data);
		return result.data;
	}

	async function addLink(
		entry: EventMaterial,
		target: { program_item_id?: number; occurrence_id?: number },
		quantity: number | null,
	) {
		const result = await useAPI((api) =>
			api.postEventsByEventIdMaterialsByMaterialIdLinks({
				path: { eventId: eventId.value, materialId: entry.id },
				body: {
					program_item_id: target.program_item_id ?? null,
					occurrence_id: target.occurrence_id ?? null,
					quantity,
				},
			}),
		);
		if (!result.success) {
			toast.add({ title: "Einplanen fehlgeschlagen", description: result.message, color: "error" });
			return null;
		}
		replaceItem(result.data);
		return result.data;
	}

	async function deleteRequest(request: MaterialRequest) {
		const choice = await confirm({
			title: `Anfrage „${request.name}“ löschen?`,
			description: answersOf(request).length
				? "Was schon dafür eingetragen ist, bleibt auf der Materialliste."
				: undefined,
			icon: "i-lucide-trash-2",
			iconColor: "error",
			confirmLabel: "Löschen",
			confirmColor: "error",
		});
		if (choice !== "confirm") return;
		const result = await useAPI((api) =>
			api.deleteEventsByEventIdMaterialsRequestsByRequestId({
				path: { eventId: eventId.value, requestId: request.id },
			}),
		);
		if (!result.success) {
			toast.add({ title: "Löschen fehlgeschlagen", description: result.message, color: "error" });
			return;
		}
		toast.add({ title: "Anfrage gelöscht", color: "success" });
		await refresh();
	}

	async function reopenRequest(request: MaterialRequest) {
		const result = await useAPI((api) =>
			api.putEventsByEventIdMaterialsRequestsByRequestId({
				path: { eventId: eventId.value, requestId: request.id },
				body: { status: "open", answer: null },
			}),
		);
		if (!result.success) {
			toast.add({ title: "Speichern fehlgeschlagen", description: result.message, color: "error" });
			return;
		}
		await refresh();
	}

	/** The buyer files the Auslage on the finances page, prefilled from the purchase. */
	function fileExpense(entry: EventMaterial) {
		return navigateTo(`/events/${eventId.value}/finances?material=${entry.id}`);
	}

	// --- dialogs ------------------------------------------------------------------------------

	/** Add or edit an entry; with `request` it answers that request. */
	const entryDialog = reactive({
		open: false,
		kind: "own" as MaterialKind,
		editing: null as EventMaterial | null,
		request: null as MaterialRequest | null,
	});

	function openCreate(kind: MaterialKind, request: MaterialRequest | null = null) {
		if (kind === "inventory") void loadCatalog();
		Object.assign(entryDialog, { open: true, kind, editing: null, request });
	}

	function openEdit(entry: EventMaterial) {
		Object.assign(entryDialog, { open: true, kind: entry.kind, editing: entry, request: null });
	}

	const requestDialog = reactive({
		open: false,
		editing: null as MaterialRequest | null,
		programItemId: null as number | null,
	});

	function openRequest(editing: MaterialRequest | null = null, programItemId: number | null = null) {
		Object.assign(requestDialog, { open: true, editing, programItemId });
	}

	/** The Leitung settles (`done`) or rejects a request, with an optional note. */
	const decideDialog = reactive({
		open: false,
		request: null as MaterialRequest | null,
		status: "done" as "done" | "rejected",
	});

	function openDecide(request: MaterialRequest, status: "done" | "rejected") {
		Object.assign(decideDialog, { open: true, request, status });
	}

	const boughtDialog = reactive({ open: false, entry: null as EventMaterial | null });

	function openBought(entry: EventMaterial) {
		if (manage.value) void loadCatalog();
		Object.assign(boughtDialog, { open: true, entry });
	}

	/** Program links of one entry (by id, so the dialog shows the list's latest state). */
	const linksDialog = reactive({ open: false, entryId: null as number | null });
	const linksEntry = computed(
		() => items.value.find((item) => item.id === linksDialog.entryId) ?? null,
	);

	function openLinks(entry: EventMaterial) {
		Object.assign(linksDialog, { open: true, entryId: entry.id });
	}

	const periodDialog = reactive({ open: false });

	return {
		event,
		eventId,
		basePath,
		manage,
		contribute,
		recurring,
		userId: context.userId,
		// data
		data,
		loading,
		refresh,
		items,
		requests,
		openRequests,
		period,
		members,
		memberOptions,
		programItems,
		occurrences,
		locationSuggestions,
		catalog,
		catalogLoading,
		loadCatalog,
		replaceItem,
		answersOf,
		linkWarnings,
		// actions
		updateEntry,
		setPacking,
		removeEntry,
		addLink,
		removeLink,
		deleteRequest,
		reopenRequest,
		fileExpense,
		// dialogs
		entryDialog,
		openCreate,
		openEdit,
		requestDialog,
		openRequest,
		decideDialog,
		openDecide,
		boughtDialog,
		openBought,
		linksDialog,
		linksEntry,
		openLinks,
		periodDialog,
	};
}

export type EventMaterialsState = Awaited<ReturnType<typeof createEventMaterials>>;

const EVENT_MATERIALS_KEY: InjectionKey<EventMaterialsState> = Symbol("event-materials");

/** Call in the materials parent page, right after `createEventMaterials()`. */
export function provideEventMaterials(state: EventMaterialsState) {
	provide(EVENT_MATERIALS_KEY, state);
}

/** The material state provided by `/events/[event_id]/materials` (child pages and dialogs). */
export function useEventMaterials() {
	const state = inject(EVENT_MATERIALS_KEY);
	if (!state) throw new Error("useEventMaterials() must be used below the event materials page");
	return state;
}

/** How an entry is labelled where it comes from: "Aus dem Lager", "Gekauft", "Von Anna". */
export function materialOrigin(entry: EventMaterial) {
	if (entry.kind === "own") {
		return {
			label: entry.owner ? `Von ${entry.owner.display_name}` : "Mitgebracht",
			icon: MATERIAL_KIND_ICONS.own,
			color: "info" as const,
		};
	}
	if (entry.kind === "purchase") {
		return entry.bought_at
			? { label: "Gekauft", icon: "i-lucide-shopping-bag", color: "success" as const }
			: { label: "Zu kaufen", icon: MATERIAL_KIND_ICONS.purchase, color: "warning" as const };
	}
	return { label: "Lager", icon: MATERIAL_KIND_ICONS.inventory, color: "neutral" as const };
}

export type PackingStatus = keyof typeof PACKING_STATUS_LABELS;

/** Where an entry is on the packing list: open → packed → back. */
export function packingStatus(
	entry: Pick<EventMaterial, "packed_at" | "returned_at">,
): PackingStatus {
	if (entry.returned_at) return "returned";
	return entry.packed_at ? "packed" : "open";
}

/** "3× Gruppenzelt" / "Gruppenzelt". */
export function materialLabel(entry: { name: string; quantity: number }) {
	return entry.quantity === 1 ? entry.name : `${entry.quantity}× ${entry.name}`;
}

/** "Tatonka · 4 × 6 m · Abgenutzt" for an inventory item. */
export function resourceDetails(resource: {
	brand: string | null;
	size: string | null;
	condition: keyof typeof RESOURCE_CONDITION_LABELS | null;
}) {
	return [
		resource.brand,
		resource.size,
		resource.condition ? RESOURCE_CONDITION_LABELS[resource.condition] : null,
	]
		.filter(Boolean)
		.join(" · ");
}
