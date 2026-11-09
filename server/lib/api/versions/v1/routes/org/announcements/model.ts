import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { ANNOUNCEMENT_PRIORITIES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace OrgAnnouncementsModel {
	export const Announcement = createSelectSchema(DB.Tables.announcements)
		.omit({ org_id: true })
		.extend({
			creator: UserSummary.Schema.nullable(),
		});
	export type Announcement = z.infer<typeof Announcement>;

	export const Params = z.object({
		announcementId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Fields = {
		title: z.string().trim().min(1).max(200),
		content: z.string().max(20_000),
		priority: z.enum(ANNOUNCEMENT_PRIORITIES),
		pinned: z.boolean(),
	};
}

export namespace OrgAnnouncementsModel.GetAll {
	export const Query = z.object({
		limit: z.coerce.number().int().min(1).max(100).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(OrgAnnouncementsModel.Announcement);
	export type Response = z.infer<typeof Response>;
}

export namespace OrgAnnouncementsModel.Create {
	const F = OrgAnnouncementsModel.Fields;

	export const Body = z.object({
		title: F.title,
		content: F.content.default(""),
		priority: F.priority.default("normal"),
		pinned: F.pinned.default(false),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = OrgAnnouncementsModel.Announcement;
	export type Response = z.infer<typeof Response>;
}

export namespace OrgAnnouncementsModel.Update {
	export const Body = z
		.object(OrgAnnouncementsModel.Fields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = OrgAnnouncementsModel.Announcement;
	export type Response = z.infer<typeof Response>;
}
