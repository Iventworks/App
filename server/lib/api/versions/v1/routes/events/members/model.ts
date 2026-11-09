import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { EVENT_MEMBER_ROLES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventMembersModel {
	export const GroupRef = z.object({
		id: z.number(),
		name: z.string(),
		color: z.string().nullable(),
	});
	export type GroupRef = z.infer<typeof GroupRef>;

	export const RoomRef = z.object({
		id: z.number(),
		name: z.string(),
	});
	export type RoomRef = z.infer<typeof RoomRef>;

	export const Member = createSelectSchema(DB.Tables.eventMembers)
		.omit({ org_id: true })
		.extend({
			user: UserSummary.Schema,
			groups: z.array(GroupRef),
			room: RoomRef.nullable(),
		});
	export type Member = z.infer<typeof Member>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		memberId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace EventMembersModel.GetAll {
	export const Response = z.array(EventMembersModel.Member);
	export type Response = z.infer<typeof Response>;
}

export namespace EventMembersModel.Create {
	export const Body = z.object({
		user_id: z.number().int().positive(),
		role: z.enum(EVENT_MEMBER_ROLES).default("staff"),
		position: z.string().trim().max(120).nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMembersModel.Member;
	export type Response = z.infer<typeof Response>;
}

export namespace EventMembersModel.Update {
	export const Body = z
		.object({
			role: z.enum(EVENT_MEMBER_ROLES),
			position: z.string().trim().max(120).nullable(),
			room_id: z.number().int().positive().nullable(),
			leader_notes: z.string().max(10_000),
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventMembersModel.Member;
	export type Response = z.infer<typeof Response>;
}
