import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventResponsibilitiesModel {
	export const Responsibility = createSelectSchema(DB.Tables.responsibilities).extend({
		assignees: z.array(UserSummary.Schema),
	});
	export type Responsibility = z.infer<typeof Responsibility>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		responsibilityId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const ResponsibilityFields = {
		title: z.string().trim().min(1).max(200),
		description: z.string().max(10_000),
		location: z.string().trim().max(200).nullable(),
		/** Event staff user ids; replaces the whole assignee set. */
		assignee_ids: z.array(z.number().int().positive()).max(200),
	};
}

export namespace EventResponsibilitiesModel.GetAll {
	export const Response = z.array(EventResponsibilitiesModel.Responsibility);
	export type Response = z.infer<typeof Response>;
}

export namespace EventResponsibilitiesModel.Create {
	export const Body = z.object({
		title: EventResponsibilitiesModel.ResponsibilityFields.title,
		description: EventResponsibilitiesModel.ResponsibilityFields.description.default(""),
		location: EventResponsibilitiesModel.ResponsibilityFields.location.default(null),
		assignee_ids: EventResponsibilitiesModel.ResponsibilityFields.assignee_ids.default([]),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventResponsibilitiesModel.Responsibility;
	export type Response = z.infer<typeof Response>;
}

export namespace EventResponsibilitiesModel.Update {
	export const Body = z
		.object(EventResponsibilitiesModel.ResponsibilityFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventResponsibilitiesModel.Responsibility;
	export type Response = z.infer<typeof Response>;
}
