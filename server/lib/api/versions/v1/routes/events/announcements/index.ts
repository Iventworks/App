import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { Notifier } from "../../../../../utils/notifications";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventAnnouncementsModel } from "./model";

type AnnouncementsEnv = {
	Variables: EventRouterEnv["Variables"] & { announcement: DB.Models.Announcement };
};

export const router = new Hono<AnnouncementsEnv>().basePath("/:eventId/announcements");

async function toResponse(
	announcements: DB.Models.Announcement[],
): Promise<EventAnnouncementsModel.Announcement[]> {
	const users = await UserSummary.fetchMap(announcements.map((entry) => entry.created_by));
	return announcements.map((announcement) => ({
		...announcement,
		creator: announcement.created_by ? (users.get(announcement.created_by) ?? null) : null,
	}));
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event announcements",
		description: "List the news of an event, pinned first, then newest first.",
		tags: [DOCS_TAGS.EVENTS.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Announcements retrieved successfully",
				EventAnnouncementsModel.GetAll.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view announcements"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "announcements:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view announcements");
		}

		const announcements = await DB.instance()
			.select()
			.from(DB.Tables.announcements)
			.where(
				and(inOrg(DB.Tables.announcements), eq(DB.Tables.announcements.event_id, c.get("event").id)),
			)
			.orderBy(desc(DB.Tables.announcements.pinned), desc(DB.Tables.announcements.created_at))
			.all();

		return APIResponse.success(
			c,
			"Announcements retrieved successfully",
			await toResponse(announcements),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event announcement",
		description: "Publish news for the event's staff. Every staff member is notified.",
		tags: [DOCS_TAGS.EVENTS.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Announcement created successfully",
				EventAnnouncementsModel.Create.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage announcements"),
		),
	}),

	zValidator("json", EventAnnouncementsModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "announcements:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage announcements");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventAnnouncementsModel.Create.Body;

		const announcement = await DB.instance()
			.insert(DB.Tables.announcements)
			.values({ ...body, event_id: event.id, created_by: userId, org_id: OrgContext.id() })
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "announcement",
			entityId: announcement.id,
			summary: `Info „${announcement.title}“ veröffentlicht`,
		});

		const members = await DB.instance()
			.select({ user_id: DB.Tables.eventMembers.user_id })
			.from(DB.Tables.eventMembers)
			.where(and(inOrg(DB.Tables.eventMembers), eq(DB.Tables.eventMembers.event_id, event.id)))
			.all();

		await Notifier.notify(
			members.map((member) => member.user_id),
			{
				type: "announcement",
				title:
					announcement.priority === "important" ? `Wichtig: ${announcement.title}` : announcement.title,
				body: event.name,
				link: `/events/${event.id}`,
			},
			{ excludeUserId: userId },
		);

		const [result] = await toResponse([announcement]);
		return APIResponse.created(c, "Announcement created successfully", result!);
	},
);

router.use(
	"/:announcementId/*",
	zValidator("param", EventAnnouncementsModel.Params),
	async (c, next) => {
		const event = c.get("event");
		const announcementId = EventAnnouncementsModel.Params.shape.announcementId.safeParse(
			c.req.param("announcementId"),
		);
		if (!announcementId.success) return APIResponse.badRequest(c, "Invalid announcement id");

		const announcement = await DB.instance()
			.select()
			.from(DB.Tables.announcements)
			.where(
				and(
					inOrg(DB.Tables.announcements),
					eq(DB.Tables.announcements.id, announcementId.data),
					eq(DB.Tables.announcements.event_id, event.id),
				),
			)
			.get();

		if (!announcement) return APIResponse.notFound(c, "Announcement not found");

		c.set("announcement", announcement);
		await next();
	},
);

router.put(
	"/:announcementId",

	APIRouteSpec.authenticated({
		summary: "Update event announcement",
		description: "Update an announcement of the event.",
		tags: [DOCS_TAGS.EVENTS.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Announcement updated successfully",
				EventAnnouncementsModel.Update.Response,
			),
			APIResponseSpec.notFound("Announcement not found"),
			APIResponseSpec.forbidden("You are not allowed to manage announcements"),
		),
	}),

	zValidator("json", EventAnnouncementsModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "announcements:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage announcements");
		}

		const announcement = c.get("announcement");
		const body = c.req.valid("json") as EventAnnouncementsModel.Update.Body;

		const updated = await DB.instance()
			.update(DB.Tables.announcements)
			.set(body)
			.where(and(inOrg(DB.Tables.announcements), eq(DB.Tables.announcements.id, announcement.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "update",
			entityType: "announcement",
			entityId: announcement.id,
			summary: `Info „${updated.title}“ bearbeitet`,
		});

		const [result] = await toResponse([updated]);
		return APIResponse.success(c, "Announcement updated successfully", result!);
	},
);

router.delete(
	"/:announcementId",

	APIRouteSpec.authenticated({
		summary: "Delete event announcement",
		description: "Delete an announcement of the event.",
		tags: [DOCS_TAGS.EVENTS.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Announcement deleted successfully"),
			APIResponseSpec.notFound("Announcement not found"),
			APIResponseSpec.forbidden("You are not allowed to manage announcements"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "announcements:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage announcements");
		}

		const announcement = c.get("announcement");

		await DB.instance()
			.delete(DB.Tables.announcements)
			.where(and(inOrg(DB.Tables.announcements), eq(DB.Tables.announcements.id, announcement.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "announcement",
			entityId: announcement.id,
			summary: `Info „${announcement.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Announcement deleted successfully");
	},
);
