import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventGroupsModel {
	export const Group = createSelectSchema(DB.Tables.eventGroups)
		.omit({ org_id: true })
		.extend({
			members: z.array(UserSummary.Schema),
			member_count: z.number(),
		});
	export type Group = z.infer<typeof Group>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		groupId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const GroupFields = {
		name: z.string().trim().min(1).max(80),
		description: z.string().max(2_000),
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #f97316")
			.nullable(),
		/** Event staff user ids; replaces the whole member set. */
		member_ids: z.array(z.number().int().positive()).max(500),
	};
}

export namespace EventGroupsModel.GetAll {
	export const Response = z.array(EventGroupsModel.Group);
	export type Response = z.infer<typeof Response>;
}

export namespace EventGroupsModel.Create {
	export const Body = z.object({
		name: EventGroupsModel.GroupFields.name,
		description: EventGroupsModel.GroupFields.description.default(""),
		color: EventGroupsModel.GroupFields.color.default(null),
		member_ids: EventGroupsModel.GroupFields.member_ids.default([]),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventGroupsModel.Group;
	export type Response = z.infer<typeof Response>;
}

export namespace EventGroupsModel.Update {
	export const Body = z
		.object(EventGroupsModel.GroupFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventGroupsModel.Group;
	export type Response = z.infer<typeof Response>;
}
