import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { getAuthUserId } from "../../../../../utils/guards";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OrgGroupsModel } from "./model";

type GroupsEnv = {
	Variables: { group: DB.Models.OrgGroup };
};

/**
 * Groups of people across the organisation ("Technikteam", "Leitungskreis"). Admins manage them;
 * the Kernteam picks them in the access lists of org documents.
 */
export const router = new Hono<GroupsEnv>().basePath("/groups");

const TAG = DOCS_TAGS.ADMIN_API.GROUPS;

/** True when every id is an activated account of the org. */
async function areOrgUsers(userIds: number[]) {
	const unique = [...new Set(userIds)];
	if (unique.length === 0) return true;
	const rows = await DB.instance()
		.select({ id: DB.Tables.users.id })
		.from(DB.Tables.users)
		.where(
			and(
				inOrg(DB.Tables.users),
				inArray(DB.Tables.users.id, unique),
				ne(DB.Tables.users.role, "unverified"),
			),
		)
		.all();
	return rows.length === unique.length;
}

/** Replace the members (synchronous: part of the caller's transaction). */
function replaceMembers(tx: DrizzleDB.Sync, groupId: number, userIds: number[]) {
	tx
		.delete(DB.Tables.orgGroupMembers)
		.where(and(inOrg(DB.Tables.orgGroupMembers), eq(DB.Tables.orgGroupMembers.group_id, groupId)))
		.run();
	const unique = [...new Set(userIds)];
	if (unique.length) {
		tx
			.insert(DB.Tables.orgGroupMembers)
			.values(unique.map((user_id) => ({ org_id: OrgContext.id(), group_id: groupId, user_id })))
			.run();
	}
}

async function toResponse(groups: DB.Models.OrgGroup[]): Promise<OrgGroupsModel.Group[]> {
	if (groups.length === 0) return [];
	const memberships = await DB.instance()
		.select()
		.from(DB.Tables.orgGroupMembers)
		.where(
			and(
				inOrg(DB.Tables.orgGroupMembers),
				inArray(
					DB.Tables.orgGroupMembers.group_id,
					groups.map((group) => group.id),
				),
			),
		)
		.all();
	const users = await UserSummary.fetchMap(memberships.map((membership) => membership.user_id));

	return groups.map(({ org_id: _org, ...group }) => {
		const members = memberships
			.filter((membership) => membership.group_id === group.id)
			.map((membership) => users.get(membership.user_id))
			.filter((user): user is UserSummary.Schema => Boolean(user))
			.sort((a, b) => a.display_name.localeCompare(b.display_name, "de"));
		return { ...group, members, member_count: members.length };
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List groups",
		description: "The organisation's groups with their members.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Groups retrieved successfully", OrgGroupsModel.GetAll.Response),
		),
	}),

	async (c) => {
		const groups = await DB.instance()
			.select()
			.from(DB.Tables.orgGroups)
			.where(inOrg(DB.Tables.orgGroups))
			.orderBy(asc(DB.Tables.orgGroups.name))
			.all();
		return APIResponse.success(c, "Groups retrieved successfully", await toResponse(groups));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create group",
		description: "Create a group. Members must be activated accounts of the organisation.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Group created successfully", OrgGroupsModel.Create.Response),
			APIResponseSpec.badRequest("User not found / Syntax or validation error in request"),
		),
	}),

	zValidator("json", OrgGroupsModel.Create.Body),

	async (c) => {
		const { member_ids, ...body } = c.req.valid("json") as OrgGroupsModel.Create.Body;
		if (!(await areOrgUsers(member_ids))) return APIResponse.badRequest(c, "User not found");

		const group = DB.instance().transaction((tx) => {
			const created = tx
				.insert(DB.Tables.orgGroups)
				.values({ ...body, org_id: OrgContext.id() })
				.returning()
				.get();
			replaceMembers(tx, created.id, member_ids);
			return created;
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "create",
			entityType: "org_group",
			entityId: group.id,
			summary: `Gruppe „${group.name}“ angelegt`,
		});

		const [result] = await toResponse([group]);
		return APIResponse.created(c, "Group created successfully", result!);
	},
);

router.use("/:groupId/*", zValidator("param", OrgGroupsModel.Params), async (c, next) => {
	const groupId = OrgGroupsModel.Params.shape.groupId.safeParse(c.req.param("groupId"));
	if (!groupId.success) return APIResponse.badRequest(c, "Invalid group id");

	const group = await DB.instance()
		.select()
		.from(DB.Tables.orgGroups)
		.where(and(inOrg(DB.Tables.orgGroups), eq(DB.Tables.orgGroups.id, groupId.data)))
		.get();
	if (!group) return APIResponse.notFound(c, "Group not found");

	c.set("group", group);
	await next();
});

router.put(
	"/:groupId",

	APIRouteSpec.authenticated({
		summary: "Update group",
		description: "Change a group; `member_ids`, when given, replaces the members.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Group updated successfully", OrgGroupsModel.Update.Response),
			APIResponseSpec.badRequest("User not found / Syntax or validation error in request"),
			APIResponseSpec.notFound("Group not found"),
		),
	}),

	zValidator("json", OrgGroupsModel.Update.Body),

	async (c) => {
		const group = c.get("group");
		const { member_ids, ...body } = c.req.valid("json") as OrgGroupsModel.Update.Body;
		if (member_ids && !(await areOrgUsers(member_ids))) {
			return APIResponse.badRequest(c, "User not found");
		}

		const updated = DB.instance().transaction((tx) => {
			const row = Object.keys(body).length
				? tx
						.update(DB.Tables.orgGroups)
						.set(body)
						.where(and(inOrg(DB.Tables.orgGroups), eq(DB.Tables.orgGroups.id, group.id)))
						.returning()
						.get()
				: group;
			if (member_ids) replaceMembers(tx, group.id, member_ids);
			return row ?? group;
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "org_group",
			entityId: group.id,
			summary:
				body.name !== undefined && body.name !== group.name
					? `Gruppe „${group.name}“ in „${updated.name}“ umbenannt`
					: `Gruppe „${updated.name}“ bearbeitet`,
		});

		const [result] = await toResponse([updated]);
		return APIResponse.success(c, "Group updated successfully", result!);
	},
);

router.delete(
	"/:groupId",

	APIRouteSpec.authenticated({
		summary: "Delete group",
		description:
			"Delete a group. Access it had to documents ends with it (its entries are removed from the access lists).",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Group deleted successfully"),
			APIResponseSpec.notFound("Group not found"),
		),
	}),

	async (c) => {
		const group = c.get("group");
		await DB.instance()
			.delete(DB.Tables.orgGroups)
			.where(and(inOrg(DB.Tables.orgGroups), eq(DB.Tables.orgGroups.id, group.id)))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "org_group",
			entityId: group.id,
			summary: `Gruppe „${group.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Group deleted successfully");
	},
);
