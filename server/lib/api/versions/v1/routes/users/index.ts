import { and, asc, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { requireOrgRole } from "../../../../utils/guards";
import { PermissionHelper } from "../../../../utils/permissions";
import { UserSummary } from "../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { UsersModel } from "./model";

type UsersEnv = { Variables: { targetUser: DB.Models.User } };

export const router = new Hono<UsersEnv>().basePath("/users");

router.use("*", requireOrgRole("volunteer"));

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List users",
		description:
			"Directory of the organisation's active members (accounts that are not yet activated are hidden). Used for pickers and starting chats.",
		tags: [DOCS_TAGS.USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Users retrieved successfully", UsersModel.GetAll.Response),
		),
	}),

	zValidator("query", UsersModel.GetAll.Query),

	async (c) => {
		const { search, role } = c.req.valid("query") as UsersModel.GetAll.Query;
		const pattern = search ? `%${search}%` : null;

		const users = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(
				and(
					ne(DB.Tables.users.role, "unverified"),
					isNull(DB.Tables.users.suspended_at),
					role ? eq(DB.Tables.users.role, role) : undefined,
					pattern
						? or(
								like(DB.Tables.users.username, pattern),
								like(DB.Tables.users.display_name, pattern),
								like(DB.Tables.users.email, pattern),
							)
						: undefined,
				),
			)
			.orderBy(asc(DB.Tables.users.display_name))
			.all();

		return APIResponse.success(c, "Users retrieved successfully", users.map(UserSummary.from));
	},
);

router.use("/:userId/*", zValidator("param", UsersModel.Params), async (c, next) => {
	const userId = UsersModel.Params.shape.userId.safeParse(c.req.param("userId"));
	if (!userId.success) return APIResponse.badRequest(c, "Invalid user id");

	const user = await DB.instance()
		.select()
		.from(DB.Tables.users)
		.where(and(eq(DB.Tables.users.id, userId.data), ne(DB.Tables.users.role, "unverified")))
		.get();

	if (!user) return APIResponse.notFound(c, "User not found");

	c.set("targetUser", user);
	await next();
});

router.get(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Get user",
		description:
			"A member's profile plus the events they work on that the caller shares with them (core team: all of their events).",
		tags: [DOCS_TAGS.USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("User retrieved successfully", UsersModel.GetById.Response),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		const target = c.get("targetUser");
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;

		const theirEvents = await DB.instance()
			.select({
				id: DB.Tables.events.id,
				name: DB.Tables.events.name,
				start_date: DB.Tables.events.start_date,
				end_date: DB.Tables.events.end_date,
				role: DB.Tables.eventMembers.role,
			})
			.from(DB.Tables.eventMembers)
			.innerJoin(DB.Tables.events, eq(DB.Tables.events.id, DB.Tables.eventMembers.event_id))
			.where(eq(DB.Tables.eventMembers.user_id, target.id))
			.orderBy(desc(DB.Tables.events.start_date))
			.all();

		let visible = theirEvents;
		if (
			target.id !== authContext.user_id &&
			!PermissionHelper.can({ authContext, permission: "events:view_all" })
		) {
			const mine = theirEvents.length
				? await DB.instance()
						.select({ event_id: DB.Tables.eventMembers.event_id })
						.from(DB.Tables.eventMembers)
						.where(
							and(
								eq(DB.Tables.eventMembers.user_id, authContext.user_id),
								inArray(
									DB.Tables.eventMembers.event_id,
									theirEvents.map((event) => event.id),
								),
							),
						)
						.all()
				: [];
			const shared = new Set(mine.map((row) => row.event_id));
			visible = theirEvents.filter((event) => shared.has(event.id));
		}

		return APIResponse.success(c, "User retrieved successfully", {
			...UserSummary.from(target),
			events: visible,
		});
	},
);
