import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { GENDERS } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventRoomsModel {
	export const Occupant = z.object({
		id: z.number(),
		first_name: z.string(),
		last_name: z.string(),
		gender: z.enum(GENDERS).nullable(),
		birth_date: z.string().nullable(),
	});
	export type Occupant = z.infer<typeof Occupant>;

	export const Room = createSelectSchema(DB.Tables.rooms).extend({
		participants: z.array(Occupant),
		staff: z.array(UserSummary.Schema),
		/** Participants + staff sleeping in the room. */
		occupancy: z.number(),
	});
	export type Room = z.infer<typeof Room>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		roomId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const RoomFields = {
		name: z.string().trim().min(1).max(80),
		capacity: z.number().int().min(0).max(1000).nullable(),
		notes: z.string().max(2_000),
	};
}

export namespace EventRoomsModel.GetAll {
	export const Response = z.array(EventRoomsModel.Room);
	export type Response = z.infer<typeof Response>;
}

export namespace EventRoomsModel.Create {
	export const Body = z.object({
		name: EventRoomsModel.RoomFields.name,
		capacity: EventRoomsModel.RoomFields.capacity.default(null),
		notes: EventRoomsModel.RoomFields.notes.default(""),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventRoomsModel.Room;
	export type Response = z.infer<typeof Response>;
}

export namespace EventRoomsModel.Update {
	export const Body = z
		.object(EventRoomsModel.RoomFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventRoomsModel.Room;
	export type Response = z.infer<typeof Response>;
}

export namespace EventRoomsModel.Assignments {
	export const Body = z
		.object({
			participants: z
				.array(
					z.object({
						participant_id: z.number().int().positive(),
						room_id: z.number().int().positive().nullable(),
					}),
				)
				.max(2_000)
				.optional(),
			staff: z
				.array(
					z.object({
						user_id: z.number().int().positive(),
						room_id: z.number().int().positive().nullable(),
					}),
				)
				.max(500)
				.optional(),
		})
		.refine((data) => data.participants !== undefined || data.staff !== undefined, {
			message: "Provide participants and/or staff assignments",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventRoomsModel.GetAll.Response;
	export type Response = z.infer<typeof Response>;
}
