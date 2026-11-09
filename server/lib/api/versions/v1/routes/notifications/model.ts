import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../db";

export namespace NotificationsModel {
	export const Notification = createSelectSchema(DB.Tables.notifications).omit({ org_id: true });
	export type Notification = z.infer<typeof Notification>;

	export const Params = z.object({
		notificationId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace NotificationsModel.GetAll {
	export const Query = z.object({
		unread_only: z
			.enum(["true", "false"])
			.default("false")
			.transform((value) => value === "true"),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		unread_count: z.number(),
		items: z.array(NotificationsModel.Notification),
	});
	export type Response = z.infer<typeof Response>;
}
