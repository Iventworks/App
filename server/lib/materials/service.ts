import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { UserSummary } from "../api/utils/shared-models/userSummary";
import type { EventMaterialsModel } from "../api/versions/v1/routes/events/materials/model";
import { DB } from "../db";
import { inOrg } from "../orgs/context";
import { Inventory, MaterialPeriod } from "./inventory";

/** Who looks at an event's material list. */
export interface MaterialViewer {
	userId: number;
	/** `materials:manage` (the Leitung, so also the Kernteam). */
	manage: boolean;
}

/** The event material list and its requests, as the API returns them. */
export namespace MaterialService {
	const T = DB.Tables;

	export function period(event: DB.Models.Event): EventMaterialsModel.Period | null {
		if (event.type === "recurring") return null;
		const { start_date, end_date } = MaterialPeriod.of(event);
		return {
			days_before: event.material_days_before,
			days_after: event.material_days_after,
			from: start_date,
			until: end_date,
		};
	}

	/** What the API tells about an inventory item next to an entry or in the catalog. */
	export function resourceInfo(resource: DB.Models.OrgResource): EventMaterialsModel.ResourceInfo {
		return {
			id: resource.id,
			name: resource.name,
			category: resource.category,
			brand: resource.brand,
			size: resource.size,
			condition: resource.condition,
			consumable: resource.consumable,
			location: resource.location,
			notes: resource.notes,
		};
	}

	/** The event's entries (or only `ids`), inventory first, then by name. */
	export async function list(
		event: DB.Models.Event,
		viewer: MaterialViewer,
		ids?: number[],
	): Promise<EventMaterialsModel.Material[]> {
		if (ids && ids.length === 0) return [];
		const rows = await DB.instance()
			.select({
				material: T.eventMaterials,
				resource: T.orgResources,
				expense_status: T.expenses.status,
			})
			.from(T.eventMaterials)
			.leftJoin(
				T.orgResources,
				and(inOrg(T.orgResources), eq(T.orgResources.id, T.eventMaterials.resource_id)),
			)
			.leftJoin(T.expenses, and(inOrg(T.expenses), eq(T.expenses.id, T.eventMaterials.expense_id)))
			.where(
				and(
					inOrg(T.eventMaterials),
					eq(T.eventMaterials.event_id, event.id),
					ids ? inArray(T.eventMaterials.id, ids) : undefined,
				),
			)
			.all();

		const materialIds = rows.map((row) => row.material.id);
		const links = await linksOf(materialIds);
		const users = await UserSummary.fetchMap(
			rows.flatMap((row) => [row.material.owner_id, row.material.buyer_id, row.material.created_by]),
		);

		// Overbooked: this event plus the others on the same days hold more than there are.
		const resourceIds = [
			...new Set(
				rows.map((row) => row.material.resource_id).filter((id): id is number => id !== null),
			),
		];
		const taken = resourceIds.length ? await Inventory.takenByOthers(event, resourceIds) : new Map();
		const bookedHere = resourceIds.length ? await Inventory.bookedBy(event.id) : new Map();

		const kindOrder = { inventory: 0, purchase: 1, own: 2 } as const;
		return rows
			.map(({ material, resource, expense_status }) => {
				const isOwner = material.kind === "own" && material.owner_id === viewer.userId;
				const isBuyer = material.kind === "purchase" && material.buyer_id === viewer.userId;
				return {
					id: material.id,
					kind: material.kind,
					name: resource?.name ?? material.name ?? "",
					quantity: material.quantity,
					location: material.location,
					notes: material.notes,
					resource: resource ? resourceInfo(resource) : null,
					owner: material.owner_id ? (users.get(material.owner_id) ?? null) : null,
					request_id: material.request_id,
					bought_at: material.bought_at,
					estimated_cents: material.estimated_cents,
					buyer: material.buyer_id ? (users.get(material.buyer_id) ?? null) : null,
					// A rejected Auslage doesn't count: the buyer files a new one.
					has_expense: expense_status !== null && expense_status !== "rejected",
					used_quantity: material.used_quantity,
					packed_at: material.packed_at,
					returned_at: material.returned_at,
					links: links.get(material.id) ?? [],
					overbooked:
						resource !== null &&
						(taken.get(resource.id) ?? 0) + (bookedHere.get(resource.id) ?? 0) > resource.quantity,
					creator: material.created_by ? (users.get(material.created_by) ?? null) : null,
					created_at: material.created_at,
					updated_at: material.updated_at,
					can_edit: viewer.manage || isOwner,
					can_delete: viewer.manage || isOwner,
					can_mark_bought:
						material.kind === "purchase" && material.bought_at === null && (viewer.manage || isBuyer),
				} satisfies EventMaterialsModel.Material;
			})
			.sort(
				(a, b) =>
					kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, "de") || a.id - b.id,
			);
	}

	async function linksOf(materialIds: number[]) {
		const result = new Map<number, EventMaterialsModel.Link[]>();
		if (materialIds.length === 0) return result;
		const rows = await DB.instance()
			.select({
				link: T.materialLinks,
				program: {
					title: T.programItems.title,
					start_at: T.programItems.start_at,
					end_at: T.programItems.end_at,
				},
				occurrence: { date: T.eventOccurrences.date, title: T.eventOccurrences.title },
			})
			.from(T.materialLinks)
			.leftJoin(
				T.programItems,
				and(inOrg(T.programItems), eq(T.programItems.id, T.materialLinks.program_item_id)),
			)
			.leftJoin(
				T.eventOccurrences,
				and(inOrg(T.eventOccurrences), eq(T.eventOccurrences.id, T.materialLinks.occurrence_id)),
			)
			.where(and(inOrg(T.materialLinks), inArray(T.materialLinks.material_id, materialIds)))
			.all();

		for (const { link, program, occurrence } of rows) {
			const entry: EventMaterialsModel.Link = {
				id: link.id,
				program_item_id: link.program_item_id,
				occurrence_id: link.occurrence_id,
				quantity: link.quantity,
				title: program?.title ?? occurrence?.title ?? null,
				start_at: program?.start_at ?? null,
				end_at: program?.end_at ?? null,
				date: occurrence?.date ?? null,
			};
			const list = result.get(link.material_id) ?? [];
			list.push(entry);
			result.set(link.material_id, list);
		}
		for (const list of result.values()) {
			list.sort(
				(a, b) => (a.start_at ?? 0) - (b.start_at ?? 0) || (a.date ?? "").localeCompare(b.date ?? ""),
			);
		}
		return result;
	}

	/** The event's requests (or only `ids`): open first, then newest first. */
	export async function requests(
		event: DB.Models.Event,
		viewer: MaterialViewer,
		ids?: number[],
	): Promise<EventMaterialsModel.Request[]> {
		if (ids && ids.length === 0) return [];
		const rows = await DB.instance()
			.select({
				request: T.materialRequests,
				program: {
					id: T.programItems.id,
					title: T.programItems.title,
					start_at: T.programItems.start_at,
				},
			})
			.from(T.materialRequests)
			.leftJoin(
				T.programItems,
				and(inOrg(T.programItems), eq(T.programItems.id, T.materialRequests.program_item_id)),
			)
			.where(
				and(
					inOrg(T.materialRequests),
					eq(T.materialRequests.event_id, event.id),
					ids ? inArray(T.materialRequests.id, ids) : undefined,
				),
			)
			.all();

		const covered = await coverage(rows.map((row) => row.request.id));
		const users = await UserSummary.fetchMap(
			rows.flatMap((row) => [row.request.requested_by, row.request.decided_by]),
		);
		const statusOrder = { open: 0, done: 1, rejected: 2 } as const;

		return rows
			.map(({ request, program }) => {
				const mine = request.requested_by === viewer.userId && request.status === "open";
				return {
					id: request.id,
					name: request.name,
					quantity: request.quantity,
					notes: request.notes,
					program_item: program?.id ? program : null,
					status: request.status,
					answer: request.answer,
					requested_by: request.requested_by ? (users.get(request.requested_by) ?? null) : null,
					decided_by: request.decided_by ? (users.get(request.decided_by) ?? null) : null,
					decided_at: request.decided_at,
					created_at: request.created_at,
					covered: covered.get(request.id) ?? 0,
					can_edit: viewer.manage || mine,
					can_delete: viewer.manage || mine,
				} satisfies EventMaterialsModel.Request;
			})
			.sort(
				(a, b) =>
					statusOrder[a.status] - statusOrder[b.status] || b.created_at - a.created_at || b.id - a.id,
			);
	}

	/** Units the answers of each request cover (request id → units). */
	async function coverage(requestIds: number[]) {
		const result = new Map<number, number>();
		if (requestIds.length === 0) return result;
		const rows = await DB.instance()
			.select({ request_id: T.eventMaterials.request_id, quantity: T.eventMaterials.quantity })
			.from(T.eventMaterials)
			.where(and(inOrg(T.eventMaterials), inArray(T.eventMaterials.request_id, requestIds)))
			.all();
		for (const row of rows) {
			if (row.request_id === null) continue;
			result.set(row.request_id, (result.get(row.request_id) ?? 0) + row.quantity);
		}
		return result;
	}

	/**
	 * Keep a request in step with its answers: open → done once they cover the quantity; a request
	 * that became done that way (nobody decided it) opens again when they no longer do. A request
	 * the Leitung settled or rejected stays. Returns the request after the change.
	 */
	export async function settle(requestId: number) {
		const request = await DB.instance()
			.select()
			.from(T.materialRequests)
			.where(and(inOrg(T.materialRequests), eq(T.materialRequests.id, requestId)))
			.get();
		if (!request) return null;

		const covered = (await coverage([request.id])).get(request.id) ?? 0;
		let status = request.status;
		if (request.status === "open" && covered >= request.quantity) status = "done";
		else if (request.status === "done" && request.decided_by === null && covered < request.quantity) {
			status = "open";
		}
		if (status === request.status) return request;

		return await DB.instance()
			.update(T.materialRequests)
			.set({ status, decided_at: status === "done" ? Date.now() : null, updated_at: Date.now() })
			.where(and(inOrg(T.materialRequests), eq(T.materialRequests.id, request.id)))
			.returning()
			.get();
	}

	/** Requests answered by the entries matching `where` — to settle them once those are gone. */
	export async function answeredBy(where: SQL | undefined) {
		const rows = await DB.instance()
			.selectDistinct({ request_id: T.eventMaterials.request_id })
			.from(T.eventMaterials)
			.where(and(inOrg(T.eventMaterials), isNotNull(T.eventMaterials.request_id), where))
			.all();
		return rows.map((row) => row.request_id!);
	}

	export async function settleAll(requestIds: number[]) {
		for (const id of new Set(requestIds)) await settle(id);
	}

	/** User ids of the event's Leitung (members with role `leader`). */
	export async function leaderIds(eventId: number) {
		const rows = await DB.instance()
			.select({ user_id: T.eventMembers.user_id })
			.from(T.eventMembers)
			.where(
				and(
					inOrg(T.eventMembers),
					eq(T.eventMembers.event_id, eventId),
					eq(T.eventMembers.role, "leader"),
				),
			)
			.all();
		return rows.map((row) => row.user_id);
	}

	/** The user is on the event's team. */
	export async function isTeamMember(eventId: number, userId: number) {
		const row = await DB.instance()
			.select({ id: T.eventMembers.id })
			.from(T.eventMembers)
			.where(
				and(
					inOrg(T.eventMembers),
					eq(T.eventMembers.event_id, eventId),
					eq(T.eventMembers.user_id, userId),
				),
			)
			.get();
		return row !== undefined;
	}
}
