import { z } from "zod";
import {
	EVENT_MATERIAL_KINDS,
	MATERIAL_REQUEST_STATUSES,
	RESOURCE_CONDITIONS,
} from "../../../../../../db/schema";
import { MaterialPeriod } from "../../../../../../materials/inventory";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventMaterialsModel {
	/** What the event sees of an inventory item: the item, never other events' bookings. */
	export const ResourceInfo = z.object({
		id: z.number(),
		name: z.string(),
		category: z.string(),
		brand: z.string().nullable(),
		size: z.string().nullable(),
		condition: z.enum(RESOURCE_CONDITIONS).nullable(),
		consumable: z.boolean(),
		/** Where it is stored ("Lagerort"). */
		location: z.string().nullable(),
		notes: z.string(),
	});
	export type ResourceInfo = z.infer<typeof ResourceInfo>;

	/** Where an entry is used: a program item or one date of a recurring event. */
	export const Link = z.object({
		id: z.number(),
		program_item_id: z.number().nullable(),
		occurrence_id: z.number().nullable(),
		quantity: z.number().nullable(),
		/** The program item's title, or the date's topic. */
		title: z.string().nullable(),
		/** Program items. */
		start_at: z.number().nullable(),
		end_at: z.number().nullable(),
		/** Dates (`YYYY-MM-DD`). */
		date: z.string().nullable(),
	});
	export type Link = z.infer<typeof Link>;

	export const Material = z.object({
		id: z.number(),
		kind: z.enum(EVENT_MATERIAL_KINDS),
		/** The inventory item's name for `inventory`, else the entry's own. */
		name: z.string(),
		quantity: z.number(),
		/** Where it is at the event. */
		location: z.string().nullable(),
		notes: z.string(),
		resource: ResourceInfo.nullable(),
		/** `own`: who brings it. */
		owner: UserSummary.Schema.nullable(),
		/** The request it answers. */
		request_id: z.number().nullable(),
		/**
		 * When it was bought (null = still to buy). Also on an `inventory` entry that was bought for
		 * the event and taken into the inventory; its Auslage can still be filed.
		 */
		bought_at: z.number().nullable(),
		estimated_cents: z.number().nullable(),
		buyer: UserSummary.Schema.nullable(),
		/** An Auslage was filed for buying it (a rejected one doesn't count). */
		has_expense: z.boolean(),
		/** Consumable inventory items: how many were used (taken off the stock). */
		used_quantity: z.number().nullable(),
		packed_at: z.number().nullable(),
		returned_at: z.number().nullable(),
		links: z.array(Link),
		/**
		 * `inventory`: together with other events on the same days more units are booked than
		 * there are (happens when dates or stock change after booking).
		 */
		overbooked: z.boolean(),
		creator: UserSummary.Schema.nullable(),
		created_at: z.number(),
		updated_at: z.number(),
		/** Name, quantity and notes (the Leitung, or who brings it). */
		can_edit: z.boolean(),
		can_delete: z.boolean(),
		/** Mark it bought (the Leitung or the buyer). */
		can_mark_bought: z.boolean(),
	});
	export type Material = z.infer<typeof Material>;

	export const Request = z.object({
		id: z.number(),
		name: z.string(),
		quantity: z.number(),
		notes: z.string(),
		program_item: z.object({ id: z.number(), title: z.string(), start_at: z.number() }).nullable(),
		status: z.enum(MATERIAL_REQUEST_STATUSES),
		/** The Leitung's note, e.g. why it was rejected. */
		answer: z.string().nullable(),
		requested_by: UserSummary.Schema.nullable(),
		decided_by: UserSummary.Schema.nullable(),
		decided_at: z.number().nullable(),
		created_at: z.number(),
		/** Units the answers (entries with this `request_id`) cover so far. */
		covered: z.number(),
		can_edit: z.boolean(),
		can_delete: z.boolean(),
	});
	export type Request = z.infer<typeof Request>;

	/** The days bookings hold the inventory; null for recurring events (their dates). */
	export const Period = z.object({
		days_before: z.number(),
		days_after: z.number(),
		from: z.string(),
		until: z.string(),
	});
	export type Period = z.infer<typeof Period>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		materialId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const LinkParams = Params.extend({
		linkId: z.coerce.number().int().positive(),
	});
	export type LinkParams = z.infer<typeof LinkParams>;

	export const RequestParams = z.object({
		eventId: z.coerce.number().int().positive(),
		requestId: z.coerce.number().int().positive(),
	});
	export type RequestParams = z.infer<typeof RequestParams>;

	export const Fields = {
		name: z.string().trim().min(1).max(120),
		quantity: z.number().int().min(1).max(1_000_000),
		location: z.string().trim().max(200).nullable(),
		notes: z.string().max(2_000),
		estimated_cents: z.number().int().min(0).max(100_000_000).nullable(),
		/** A member of the event's team. */
		buyer_id: z.number().int().positive().nullable(),
	};
}

export namespace EventMaterialsModel.GetAll {
	export const Response = z.object({
		period: EventMaterialsModel.Period.nullable(),
		items: z.array(EventMaterialsModel.Material),
		requests: z.array(EventMaterialsModel.Request),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.Catalog {
	export const Item = EventMaterialsModel.ResourceInfo.extend({
		/** In stock. */
		quantity: z.number(),
		/** Booked by other events on days of this event's material period. */
		taken: z.number(),
		booked_here: z.number(),
		/** Units this event can still book. */
		free: z.number(),
		/** Still to be bought by the Kernteam (not bookable yet). */
		on_order: z.number(),
	});
	export type Item = z.infer<typeof Item>;

	export const Response = z.array(Item);
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.Create {
	const F = EventMaterialsModel.Fields;

	export const Body = z.object({
		/** `inventory` and `purchase`: the Leitung. `own`: anyone on the team. */
		kind: z.enum(EVENT_MATERIAL_KINDS),
		/** `inventory`: the item to book. */
		resource_id: z.number().int().positive().nullable().default(null),
		/** `purchase` and `own`. */
		name: F.name.nullable().default(null),
		quantity: F.quantity.default(1),
		location: F.location.default(null),
		notes: F.notes.default(""),
		/** `own`: who brings it — the caller, or a team member the Leitung names. */
		owner_id: z.number().int().positive().nullable().default(null),
		estimated_cents: F.estimated_cents.default(null),
		buyer_id: F.buyer_id.default(null),
		/** The open request this answers. */
		request_id: z.number().int().positive().nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Material;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.Update {
	const F = EventMaterialsModel.Fields;

	export const Body = z
		.object({
			/** `purchase` and `own`. */
			name: F.name,
			quantity: F.quantity,
			notes: F.notes,
			/** Anyone on the team. */
			location: F.location,
			/** `purchase`, the Leitung. */
			estimated_cents: F.estimated_cents,
			buyer_id: F.buyer_id,
			/** Consumable inventory items, the Leitung: the difference comes off (or back on) the stock. */
			used_quantity: z.number().int().min(0).max(1_000_000).nullable(),
			/**
			 * Packing list, anyone on the team: one status, open → packed → back. `returned` also
			 * marks it packed, `packed: false` also takes back `returned`.
			 */
			packed: z.boolean(),
			returned: z.boolean(),
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Material;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.Bought {
	export const Body = z.object({
		/** Move it into the inventory (the Leitung): added to the stock and booked for this event. */
		to_inventory: z.boolean().default(false),
		/** The inventory item it adds to; null = a new item named like the entry. */
		resource_id: z.number().int().positive().nullable().default(null),
		/** Category of a new inventory item. */
		category: z.string().trim().min(1).max(60).nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Material;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.AddLink {
	export const Body = z
		.object({
			program_item_id: z.number().int().positive().nullable().default(null),
			/** A date of a recurring event. */
			occurrence_id: z.number().int().positive().nullable().default(null),
			quantity: z.number().int().min(1).max(1_000_000).nullable().default(null),
		})
		.refine((data) => (data.program_item_id === null) !== (data.occurrence_id === null), {
			message: "Give either program_item_id or occurrence_id",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Material;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.SetPeriod {
	const days = z.number().int().min(0).max(MaterialPeriod.MAX_EXTRA_DAYS);

	export const Body = z.object({ days_before: days, days_after: days });
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Period;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.CreateRequest {
	const F = EventMaterialsModel.Fields;

	export const Body = z.object({
		name: F.name,
		quantity: F.quantity.default(1),
		notes: F.notes.default(""),
		/** Needed for this program item: answers get linked to it. */
		program_item_id: z.number().int().positive().nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Request;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMaterialsModel.UpdateRequest {
	const F = EventMaterialsModel.Fields;

	export const Body = z
		.object({
			/** Who asked, while it is open; the Leitung. */
			name: F.name,
			quantity: F.quantity,
			notes: F.notes,
			program_item_id: z.number().int().positive().nullable(),
			/** The Leitung: `done` (settled), `rejected`, or `open` again. */
			status: z.enum(MATERIAL_REQUEST_STATUSES),
			/** The Leitung's note to who asked. */
			answer: z.string().trim().max(2_000).nullable(),
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMaterialsModel.Request;
	export type Response = z.infer<typeof Response>;
}
