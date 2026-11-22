import { and, eq, gte, inArray, lte, ne, sum } from "drizzle-orm";
import { EventSchedule } from "../api/utils/eventSchedule";
import { DB } from "../db";
import { inOrg } from "../orgs/context";
import { TimeUtils } from "../utils/time";

type EventDates = Pick<
	DB.Models.Event,
	"id" | "type" | "start_date" | "end_date" | "material_days_before" | "material_days_after"
>;

/**
 * The days an event holds the inventory it booked: its dates, widened by the days the material is
 * needed before and after (fetching, packing, bringing back). A recurring event holds it on its
 * dates only.
 */
export namespace MaterialPeriod {
	export const MAX_EXTRA_DAYS = 14;

	export function of(event: EventDates) {
		if (event.type === "recurring") {
			return {
				id: event.id,
				type: event.type,
				start_date: event.start_date,
				end_date: event.end_date,
			};
		}
		return {
			id: event.id,
			type: event.type,
			start_date: TimeUtils.addDays(event.start_date, -event.material_days_before),
			end_date: TimeUtils.addDays(event.end_date, event.material_days_after),
		};
	}
}

/** Units an entry still holds: what a consumable used up has already left the stock. */
function held(entry: Pick<DB.Models.EventMaterial, "quantity" | "used_quantity">) {
	return entry.quantity - (entry.used_quantity ?? 0);
}

/**
 * How many units of the inventory are booked. Bookings are `inventory` entries of event material
 * lists; cancelled events hold nothing, and what a consumable used up no longer counts.
 */
export namespace Inventory {
	export interface Booking {
		material_id: number;
		resource_id: number;
		/** Units held (booked minus used up). */
		quantity: number;
		event: DB.Models.Event;
	}

	/**
	 * Inventory bookings of these resources (all when omitted) by events that aren't cancelled.
	 * `near` keeps those whose material period can touch these days.
	 */
	export async function bookings(
		resourceIds?: number[],
		near?: { start_date: string; end_date: string },
	): Promise<Booking[]> {
		if (resourceIds && resourceIds.length === 0) return [];
		const T = DB.Tables;
		const rows = await DB.instance()
			.select({ material: T.eventMaterials, event: T.events })
			.from(T.eventMaterials)
			.innerJoin(
				T.events,
				and(
					inOrg(T.events),
					eq(T.events.id, T.eventMaterials.event_id),
					ne(T.events.status, "cancelled"),
					near
						? lte(T.events.start_date, TimeUtils.addDays(near.end_date, MaterialPeriod.MAX_EXTRA_DAYS))
						: undefined,
					near
						? gte(T.events.end_date, TimeUtils.addDays(near.start_date, -MaterialPeriod.MAX_EXTRA_DAYS))
						: undefined,
				),
			)
			.where(
				and(
					inOrg(T.eventMaterials),
					eq(T.eventMaterials.kind, "inventory"),
					resourceIds ? inArray(T.eventMaterials.resource_id, resourceIds) : undefined,
				),
			)
			.orderBy(T.events.start_date, T.eventMaterials.id)
			.all();
		return rows.map((row) => ({
			material_id: row.material.id,
			resource_id: row.material.resource_id!,
			quantity: held(row.material),
			event: row.event,
		}));
	}

	/**
	 * Units of each resource that other events book on days of `event`'s material period
	 * (resource id → units). `period` replaces the event's own period (to check a change).
	 */
	export async function takenByOthers(
		event: EventDates,
		resourceIds?: number[],
		period: Pick<EventDates, "material_days_before" | "material_days_after"> = event,
	) {
		const own = MaterialPeriod.of({ ...event, ...period });
		const others = (await bookings(resourceIds, own)).filter(
			(booking) => booking.event.id !== event.id,
		);
		const schedule = await EventSchedule.load([own, ...others.map((booking) => booking.event)]);
		const taken = new Map<number, number>();
		for (const booking of others) {
			if (!schedule.overlap(own, MaterialPeriod.of(booking.event))) continue;
			taken.set(booking.resource_id, (taken.get(booking.resource_id) ?? 0) + booking.quantity);
		}
		return taken;
	}

	/** Units of each resource the event itself holds (resource id → units). */
	export async function bookedBy(eventId: number, exceptMaterialId?: number) {
		const T = DB.Tables;
		const rows = await DB.instance()
			.select({
				resource_id: T.eventMaterials.resource_id,
				quantity: T.eventMaterials.quantity,
				used_quantity: T.eventMaterials.used_quantity,
				id: T.eventMaterials.id,
			})
			.from(T.eventMaterials)
			.where(
				and(
					inOrg(T.eventMaterials),
					eq(T.eventMaterials.event_id, eventId),
					eq(T.eventMaterials.kind, "inventory"),
				),
			)
			.all();
		const booked = new Map<number, number>();
		for (const row of rows) {
			if (row.id === exceptMaterialId || row.resource_id === null) continue;
			booked.set(row.resource_id, (booked.get(row.resource_id) ?? 0) + held(row));
		}
		return booked;
	}

	/** Units still to be bought per resource (open purchases). */
	export async function onOrder(resourceIds?: number[]) {
		if (resourceIds && resourceIds.length === 0) return new Map<number, number>();
		const T = DB.Tables;
		const rows = await DB.instance()
			.select({
				resource_id: T.resourcePurchases.resource_id,
				quantity: sum(T.resourcePurchases.quantity),
			})
			.from(T.resourcePurchases)
			.where(
				and(
					inOrg(T.resourcePurchases),
					resourceIds ? inArray(T.resourcePurchases.resource_id, resourceIds) : undefined,
				),
			)
			.groupBy(T.resourcePurchases.resource_id)
			.all();
		return new Map(rows.map((row) => [row.resource_id, Number(row.quantity ?? 0)]));
	}

	/**
	 * Whether `event` can hold `quantity` more units of `resource` (on top of what it holds, minus
	 * the entry `exceptMaterialId` when that one changes).
	 */
	export async function fits(
		event: EventDates,
		resource: Pick<DB.Models.OrgResource, "id" | "quantity">,
		quantity: number,
		exceptMaterialId?: number,
	) {
		const taken = (await takenByOthers(event, [resource.id])).get(resource.id) ?? 0;
		const own = (await bookedBy(event.id, exceptMaterialId)).get(resource.id) ?? 0;
		return taken + own + quantity <= resource.quantity;
	}
}
