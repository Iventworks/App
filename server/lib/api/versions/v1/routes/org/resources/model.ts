import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";

export namespace OrgResourcesModel {
	export const EventRef = z.object({
		id: z.number(),
		name: z.string(),
		start_date: z.string(),
		end_date: z.string(),
	});
	export type EventRef = z.infer<typeof EventRef>;

	export const Booking = z.object({
		id: z.number(),
		quantity: z.number(),
		notes: z.string(),
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

	export const Resource = createSelectSchema(DB.Tables.orgResources)
		.omit({ org_id: true })
		.extend({
			bookings: z.array(Booking),
			/** Units booked by events that are running today. */
			booked_now: z.number(),
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

	export const Fields = {
		name: z.string().trim().min(1).max(120),
		category: z.string().trim().min(1).max(60),
		quantity: z.number().int().min(0).max(1_000_000),
		location: z.string().trim().max(200).nullable(),
		notes: z.string().max(5_000),
	};
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
		quantity: F.quantity.default(1),
		location: F.location.default(null),
		notes: F.notes.default(""),
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
