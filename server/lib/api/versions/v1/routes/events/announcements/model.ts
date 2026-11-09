import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { ANNOUNCEMENT_PRIORITIES } from "../../../../../../db/schema";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventAnnouncementsModel {
	export const Announcement = createSelectSchema(DB.Tables.announcements)
		.omit({ org_id: true })
		.extend({
			creator: UserSummary.Schema.nullable(),
		});
	export type Announcement = z.infer<typeof Announcement>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		announcementId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const AnnouncementFields = {
		title: z.string().trim().min(1).max(200),
		/** Markdown. */
		content: z.string().max(20_000),
		priority: z.enum(ANNOUNCEMENT_PRIORITIES),
		pinned: z.boolean(),
	};
}

export namespace EventAnnouncementsModel.GetAll {
	export const Response = z.array(EventAnnouncementsModel.Announcement);
	export type Response = z.infer<typeof Response>;
}

export namespace EventAnnouncementsModel.Create {
	export const Body = z.object({
		title: EventAnnouncementsModel.AnnouncementFields.title,
		content: EventAnnouncementsModel.AnnouncementFields.content.default(""),
		priority: EventAnnouncementsModel.AnnouncementFields.priority.default("normal"),
		pinned: EventAnnouncementsModel.AnnouncementFields.pinned.default(false),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventAnnouncementsModel.Announcement;
	export type Response = z.infer<typeof Response>;
}

export namespace EventAnnouncementsModel.Update {
	export const Body = z
		.object(EventAnnouncementsModel.AnnouncementFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventAnnouncementsModel.Announcement;
	export type Response = z.infer<typeof Response>;
}
