import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { GENDERS, PARTICIPANT_STATUSES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventSmallGroupsModel {
	export const Member = z.object({
		id: z.number(),
		first_name: z.string(),
		last_name: z.string(),
		gender: z.enum(GENDERS).nullable(),
		birth_date: z.string().nullable(),
		status: z.enum(PARTICIPANT_STATUSES),
	});
	export type Member = z.infer<typeof Member>;

	export const SmallGroup = createSelectSchema(DB.Tables.smallGroups)
		.omit({ org_id: true })
		.extend({
			/** Staff responsible for the group, by name. */
			leaders: z.array(UserSummary.Schema),
			/** Participants in the group (not cancelled), by last name. */
			participants: z.array(Member),
			participant_count: z.number(),
		});
	export type SmallGroup = z.infer<typeof SmallGroup>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		smallGroupId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const SmallGroupFields = {
		name: z.string().trim().min(1).max(80),
		description: z.string().max(2_000),
		meeting_point: z.string().trim().max(200).nullable(),
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #f97316")
			.nullable(),
		/** Event staff responsible for the group; replaces the whole set. */
		leader_ids: z.array(z.number().int().positive()).max(50),
	};
}

export namespace EventSmallGroupsModel.GetAll {
	export const Response = z.array(EventSmallGroupsModel.SmallGroup);
	export type Response = z.infer<typeof Response>;
}

export namespace EventSmallGroupsModel.Create {
	const F = EventSmallGroupsModel.SmallGroupFields;

	export const Body = z.object({
		name: F.name,
		description: F.description.default(""),
		meeting_point: F.meeting_point.default(null),
		color: F.color.default(null),
		leader_ids: F.leader_ids.default([]),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventSmallGroupsModel.SmallGroup;
	export type Response = z.infer<typeof Response>;
}

export namespace EventSmallGroupsModel.Update {
	export const Body = z
		.object(EventSmallGroupsModel.SmallGroupFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventSmallGroupsModel.SmallGroup;
	export type Response = z.infer<typeof Response>;
}

export namespace EventSmallGroupsModel.Assignments {
	export const Body = z.object({
		participants: z
			.array(
				z.object({
					participant_id: z.number().int().positive(),
					/** null takes the participant out of their group. */
					small_group_id: z.number().int().positive().nullable(),
				}),
			)
			.min(1)
			.max(2_000),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventSmallGroupsModel.GetAll.Response;
	export type Response = z.infer<typeof Response>;
}
