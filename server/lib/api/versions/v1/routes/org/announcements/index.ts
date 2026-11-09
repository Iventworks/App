import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { getAuthUserId } from "../../../../../utils/guards";
import { Notifier } from "../../../../../utils/notifications";
import { PermissionHelper } from "../../../../../utils/permissions";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OrgAnnouncementsModel } from "./model";

type AnnouncementsEnv = {
	Variables: { announcement: DB.Models.Announcement };
};

export const router = new Hono<AnnouncementsEnv>().basePath("/announcements");

function canWrite(c: Context) {
	return PermissionHelper.can({
		authContext: AuthHandler.AuthContext.get(c),
		permission: "org_announcements:write",
	});
}

async function toResponse(
	announcements: DB.Models.Announcement[],
): Promise<OrgAnnouncementsModel.Announcement[]> {
	const users = await UserSummary.fetchMap(announcements.map((entry) => entry.created_by));
	return announcements.map((announcement) => ({
		...announcement,
		creator: announcement.created_by ? (users.get(announcement.created_by) ?? null) : null,
	}));
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List organisation announcements",
		description: "Organisation-wide news for all members, pinned first, then newest first.",
		tags: [DOCS_TAGS.ORG.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Announcements retrieved successfully",
				OrgAnnouncementsModel.GetAll.Response,
			),
		),
	}),

	zValidator("query", OrgAnnouncementsModel.GetAll.Query),

	async (c) => {
		const { limit } = c.req.valid("query") as OrgAnnouncementsModel.GetAll.Query;

		const query = DB.instance()
			.select()
			.from(DB.Tables.announcements)
			.where(and(inOrg(DB.Tables.announcements), isNull(DB.Tables.announcements.event_id)))
			.orderBy(desc(DB.Tables.announcements.pinned), desc(DB.Tables.announcements.created_at))
			.$dynamic();

		const rows = limit ? await query.limit(limit).all() : await query.all();

		return APIResponse.success(c, "Announcements retrieved successfully", await toResponse(rows));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create organisation announcement",
		description:
			"Publish news for the whole organisation (core team). Every member gets a notification.",
		tags: [DOCS_TAGS.ORG.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Announcement created successfully",
				OrgAnnouncementsModel.Create.Response,
			),
			APIResponseSpec.forbidden("Only the core team can publish organisation announcements"),
		),
	}),

	zValidator("json", OrgAnnouncementsModel.Create.Body),

	async (c) => {
		if (!canWrite(c)) {
			return APIResponse.forbidden(c, "Only the core team can publish organisation announcements");
		}

		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as OrgAnnouncementsModel.Create.Body;

		const announcement = await DB.instance()
			.insert(DB.Tables.announcements)
			.values({ ...body, org_id: OrgContext.id(), event_id: null, created_by: userId })
			.returning()
			.get();

		await AuditLog.record({
			userId,
			action: "create",
			entityType: "announcement",
			entityId: announcement.id,
			summary: `Ankündigung „${announcement.title}“ veröffentlicht`,
		});

		const recipients = await DB.instance()
			.select({ id: DB.Tables.users.id })
			.from(DB.Tables.users)
			.where(
				and(inOrg(DB.Tables.users), inArray(DB.Tables.users.role, ["volunteer", "core_team", "admin"])),
			)
			.all();

		await Notifier.notify(
			recipients.map((user) => user.id),
			{
				type: "announcement",
				title: announcement.title,
				body: announcement.content.slice(0, 200),
				link: "/",
			},
			{ excludeUserId: userId },
		);

		const [result] = await toResponse([announcement]);
		return APIResponse.created(c, "Announcement created successfully", result!);
	},
);

router.use(
	"/:announcementId/*",
	zValidator("param", OrgAnnouncementsModel.Params),
	async (c, next) => {
		const announcementId = OrgAnnouncementsModel.Params.shape.announcementId.safeParse(
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
					isNull(DB.Tables.announcements.event_id),
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
		summary: "Update organisation announcement",
		description: "Edit an organisation-wide announcement (core team).",
		tags: [DOCS_TAGS.ORG.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Announcement updated successfully",
				OrgAnnouncementsModel.Update.Response,
			),
			APIResponseSpec.forbidden("Only the core team can edit organisation announcements"),
			APIResponseSpec.notFound("Announcement not found"),
		),
	}),

	zValidator("json", OrgAnnouncementsModel.Update.Body),

	async (c) => {
		if (!canWrite(c)) {
			return APIResponse.forbidden(c, "Only the core team can edit organisation announcements");
		}

		const announcement = c.get("announcement");
		const body = c.req.valid("json") as OrgAnnouncementsModel.Update.Body;

		const updated = await DB.instance()
			.update(DB.Tables.announcements)
			.set(body)
			.where(and(inOrg(DB.Tables.announcements), eq(DB.Tables.announcements.id, announcement.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "announcement",
			entityId: announcement.id,
			summary: `Ankündigung „${updated.title}“ bearbeitet`,
		});

		const [result] = await toResponse([updated]);
		return APIResponse.success(c, "Announcement updated successfully", result!);
	},
);

router.delete(
	"/:announcementId",

	APIRouteSpec.authenticated({
		summary: "Delete organisation announcement",
		description: "Delete an organisation-wide announcement (core team).",
		tags: [DOCS_TAGS.ORG.ANNOUNCEMENTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Announcement deleted successfully"),
			APIResponseSpec.forbidden("Only the core team can delete organisation announcements"),
			APIResponseSpec.notFound("Announcement not found"),
		),
	}),

	async (c) => {
		if (!canWrite(c)) {
			return APIResponse.forbidden(c, "Only the core team can delete organisation announcements");
		}

		const announcement = c.get("announcement");

		await DB.instance()
			.delete(DB.Tables.announcements)
			.where(and(inOrg(DB.Tables.announcements), eq(DB.Tables.announcements.id, announcement.id)))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "announcement",
			entityId: announcement.id,
			summary: `Ankündigung „${announcement.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Announcement deleted successfully");
	},
);
