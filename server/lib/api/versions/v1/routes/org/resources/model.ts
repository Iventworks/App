import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { EVENT_TYPES, RESOURCE_CONDITIONS } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace OrgResourcesModel {
	export const EventRef = z.object({
		id: z.number(),
		name: z.string(),
		/** A recurring event uses its bookings on the days of its dates only. */
		type: z.enum(EVENT_TYPES),
		start_date: z.string(),
		end_date: z.string(),
		/** The days the booking holds the units (the event's dates plus its material days). */
		from: z.string(),
		until: z.string(),
	});
	export type EventRef = z.infer<typeof EventRef>;

	/** Units booked by an event (an `inventory` entry of its material list). */
	export const Booking = z.object({
		id: z.number(),
		quantity: z.number(),
		notes: z.string(),
		/** Consumables: how many the event used (already off the stock). */
		used_quantity: z.number().nullable(),
		created_at: z.number(),
		event: EventRef,
	});
	export type Booking = z.infer<typeof Booking>;

	export const BookingWithResource = Booking.extend({
		resource: z.object({
			id: z.number(),
			name: z.string(),
			category: z.string(),
			quantity: z.number(),
		}),
	});
	export type BookingWithResource = z.infer<typeof BookingWithResource>;

	/** Units still to be bought; bookable once marked bought. */
	export const Purchase = z.object({
		id: z.number(),
		resource_id: z.number(),
		quantity: z.number(),
		estimated_cents: z.number().nullable(),
		buyer: UserSummary.Schema.nullable(),
		notes: z.string(),
		created_at: z.number(),
	});
	export type Purchase = z.infer<typeof Purchase>;

	export const Resource = createSelectSchema(DB.Tables.orgResources)
		.omit({ org_id: true })
		.extend({
			condition: z.enum(RESOURCE_CONDITIONS).nullable(),
			bookings: z.array(Booking),
			/** Units booked by events that hold them today. */
			booked_now: z.number(),
			purchases: z.array(Purchase),
			/** Units still to be bought (sum of `purchases`). */
			on_order: z.number(),
		});
	export type Resource = z.infer<typeof Resource>;

	export const Params = z.object({
		resourceId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const BookingParams = z.object({
		bookingId: z.coerce.number().int().positive(),
	});
	export type BookingParams = z.infer<typeof BookingParams>;

	export const PurchaseParams = z.object({
		purchaseId: z.coerce.number().int().positive(),
	});
	export type PurchaseParams = z.infer<typeof PurchaseParams>;

	export const Fields = {
		name: z.string().trim().min(1).max(120),
		category: z.string().trim().min(1).max(60),
		quantity: z.number().int().min(0).max(1_000_000),
		location: z.string().trim().max(200).nullable(),
		brand: z.string().trim().max(120).nullable(),
		size: z.string().trim().max(120).nullable(),
		condition: z.enum(RESOURCE_CONDITIONS).nullable(),
		/** Used up at events: what an event records as used comes off the stock. */
		consumable: z.boolean(),
		notes: z.string().max(5_000),
	};

	export const PurchaseFields = {
		quantity: z.number().int().min(1).max(1_000_000),
		estimated_cents: z.number().int().min(0).max(100_000_000).nullable(),
		/** Someone from the core team. */
		buyer_id: z.number().int().positive().nullable(),
		notes: z.string().max(2_000),
	};

	export const PurchaseBody = z.object({
		quantity: PurchaseFields.quantity,
		estimated_cents: PurchaseFields.estimated_cents.default(null),
		buyer_id: PurchaseFields.buyer_id.default(null),
		notes: PurchaseFields.notes.default(""),
	});
	export type PurchaseBody = z.infer<typeof PurchaseBody>;
}

export namespace OrgResourcesModel.GetAll {
	export const Response = z.array(OrgResourcesModel.Resource);
	export type Response = z.infer<typeof Response>;
}

export namespace OrgResourcesModel.Create {
	const F = OrgResourcesModel.Fields;

	export const Body = z.object({
		name: F.name,
		category: F.category.default("Allgemein"),
		/** In stock now (0 for something that is still to be bought). */
		quantity: F.quantity.default(1),
		location: F.location.default(null),
		brand: F.brand.default(null),
		size: F.size.default(null),
		condition: F.condition.default(null),
		consumable: F.consumable.default(false),
		notes: F.notes.default(""),
		/** Units still to buy, added as a purchase. */
		purchase: OrgResourcesModel.PurchaseBody.nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = OrgResourcesModel.Resource;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgResourcesModel.Update {
	export const Body = z
		.object(OrgResourcesModel.Fields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = OrgResourcesModel.Resource;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgResourcesModel.GetBookings {
	export const Query = z.object({
		event_id: z.coerce.number().int().positive().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(OrgResourcesModel.BookingWithResource);
	export type Response = z.infer<typeof Response>;
}

export namespace OrgResourcesModel.CreateBooking {
	export const Body = z.object({
		event_id: z.number().int().positive(),
		quantity: z.number().int().min(1).max(1_000_000).default(1),
		notes: z.string().max(2_000).default(""),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = OrgResourcesModel.BookingWithResource;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgResourcesModel.CreatePurchase {
	export const Body = OrgResourcesModel.PurchaseBody;
	export type Body = z.infer<typeof Body>;

	export const Response = OrgResourcesModel.Resource;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgResourcesModel.UpdatePurchase {
	export const Body = z
		.object(OrgResourcesModel.PurchaseFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = OrgResourcesModel.Resource;
	export type Response = z.infer<typeof Response>;
}
