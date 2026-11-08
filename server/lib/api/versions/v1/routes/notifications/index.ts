import { and, count, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { NotificationsModel } from "./model";

type NotificationsEnv = { Variables: { notification: DB.Models.Notification } };

export const router = new Hono<NotificationsEnv>().basePath("/notifications");

router.use("*", requireOrgRole("volunteer"));

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List notifications",
		description: "The caller's notifications, newest first, plus the number of unread ones.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Notifications retrieved successfully",
				NotificationsModel.GetAll.Response,
			),
		),
	}),

	zValidator("query", NotificationsModel.GetAll.Query),

	async (c) => {
		const userId = getAuthUserId(c);
		const { unread_only, limit } = c.req.valid("query") as NotificationsModel.GetAll.Query;

		const items = await DB.instance()
			.select()
			.from(DB.Tables.notifications)
			.where(
				and(
					eq(DB.Tables.notifications.user_id, userId),
					unread_only ? isNull(DB.Tables.notifications.read_at) : undefined,
				),
			)
			.orderBy(desc(DB.Tables.notifications.created_at), desc(DB.Tables.notifications.id))
			.limit(limit)
			.all();

		const unread = await DB.instance()
			.select({ value: count() })
			.from(DB.Tables.notifications)
			.where(and(eq(DB.Tables.notifications.user_id, userId), isNull(DB.Tables.notifications.read_at)))
			.get();

		return APIResponse.success(c, "Notifications retrieved successfully", {
			unread_count: unread?.value ?? 0,
			items,
		});
	},
);

router.post(
	"/read-all",

	APIRouteSpec.authenticated({
		summary: "Mark all notifications as read",
		description: "Mark every unread notification of the caller as read.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("All notifications marked as read"),
		),
	}),

	async (c) => {
		await DB.instance()
			.update(DB.Tables.notifications)
			.set({ read_at: Date.now() })
			.where(
				and(
					eq(DB.Tables.notifications.user_id, getAuthUserId(c)),
					isNull(DB.Tables.notifications.read_at),
				),
			)
			.run();

		return APIResponse.successNoData(c, "All notifications marked as read");
	},
);

router.use(
	"/:notificationId/*",
	zValidator("param", NotificationsModel.Params),
	async (c, next) => {
		const notificationId = NotificationsModel.Params.shape.notificationId.safeParse(
			c.req.param("notificationId"),
		);
		if (!notificationId.success) return APIResponse.badRequest(c, "Invalid notification id");

		const notification = await DB.instance()
			.select()
			.from(DB.Tables.notifications)
			.where(
				and(
					eq(DB.Tables.notifications.id, notificationId.data),
					eq(DB.Tables.notifications.user_id, getAuthUserId(c)),
				),
			)
			.get();

		if (!notification) return APIResponse.notFound(c, "Notification not found");

		c.set("notification", notification);
		await next();
	},
);

router.put(
	"/:notificationId/read",

	APIRouteSpec.authenticated({
		summary: "Mark notification as read",
		description: "Mark one of the caller's notifications as read.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Notification marked as read", NotificationsModel.Notification),
			APIResponseSpec.notFound("Notification not found"),
		),
	}),

	async (c) => {
		const notification = c.get("notification");

		const updated = await DB.instance()
			.update(DB.Tables.notifications)
			.set({ read_at: notification.read_at ?? Date.now() })
			.where(eq(DB.Tables.notifications.id, notification.id))
			.returning()
			.get();

		return APIResponse.success(c, "Notification marked as read", updated);
	},
);

router.delete(
	"/:notificationId",

	APIRouteSpec.authenticated({
		summary: "Delete notification",
		description: "Delete one of the caller's notifications.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Notification deleted successfully"),
			APIResponseSpec.notFound("Notification not found"),
		),
	}),

	async (c) => {
		await DB.instance()
			.delete(DB.Tables.notifications)
			.where(eq(DB.Tables.notifications.id, c.get("notification").id))
			.run();
		return APIResponse.successNoData(c, "Notification deleted successfully");
	},
);
