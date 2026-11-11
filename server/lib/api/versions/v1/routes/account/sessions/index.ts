import { and, desc, eq, gt, ne } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { RealtimeHub } from "../../../../../../realtime/hub";
import { APIResponse } from "../../../../../utils/api-res";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AccountSessionsModel } from "./model";

// The parent account router already rejects anything that is not a session.
export const router = new Hono().basePath("/sessions");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List sessions",
		description: "List the active login sessions of the authenticated user, newest first.",
		tags: [DOCS_TAGS.ACCOUNT_SESSIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Sessions retrieved successfully", AccountSessionsModel.GetAll.Response),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const sessions = await DB.instance()
			.select()
			.from(DB.Tables.sessions)
			.where(
				and(
					inOrg(DB.Tables.sessions),
					eq(DB.Tables.sessions.user_id, authContext.user_id),
					gt(DB.Tables.sessions.expires_at, Date.now()),
				),
			)
			.orderBy(desc(DB.Tables.sessions.created_at))
			.all();

		return APIResponse.success(
			c,
			"Sessions retrieved successfully",
			sessions.map((session) => ({
				id: session.id,
				created_at: session.created_at,
				expires_at: session.expires_at,
				is_current: session.id === authContext.id,
			})) satisfies AccountSessionsModel.GetAll.Response,
		);
	},
);

router.delete(
	"/",

	APIRouteSpec.authenticated({
		summary: "Revoke other sessions",
		description: "Sign out everywhere else: revoke every session of the user except the current one.",
		tags: [DOCS_TAGS.ACCOUNT_SESSIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Other sessions revoked successfully",
				AccountSessionsModel.RevokeOthers.Response,
			),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const revoked = await DB.instance()
			.delete(DB.Tables.sessions)
			.where(
				and(
					inOrg(DB.Tables.sessions),
					eq(DB.Tables.sessions.user_id, authContext.user_id),
					ne(DB.Tables.sessions.id, authContext.id),
				),
			)
			.returning({ id: DB.Tables.sessions.id })
			.all();
		RealtimeHub.closeFor(OrgContext.id(), {
			authType: "session",
			authIds: revoked.map((entry) => entry.id),
		});

		return APIResponse.success(c, "Other sessions revoked successfully", {
			revoked: revoked.length,
		} satisfies AccountSessionsModel.RevokeOthers.Response);
	},
);

router.delete(
	"/:sessionId",

	APIRouteSpec.authenticated({
		summary: "Revoke session",
		description:
			"Revoke one of the user's sessions. Revoking the current session signs this client out.",
		tags: [DOCS_TAGS.ACCOUNT_SESSIONS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Session revoked successfully"),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
			APIResponseSpec.notFound("Session not found"),
		),
	}),

	zValidator("param", AccountSessionsModel.Params),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);
		const { sessionId } = c.req.valid("param") as AccountSessionsModel.Params;

		const deleted = await DB.instance()
			.delete(DB.Tables.sessions)
			.where(
				and(
					inOrg(DB.Tables.sessions),
					eq(DB.Tables.sessions.id, sessionId),
					eq(DB.Tables.sessions.user_id, authContext.user_id),
				),
			)
			.returning({ id: DB.Tables.sessions.id })
			.all();
		RealtimeHub.closeFor(OrgContext.id(), { authType: "session", authIds: [sessionId] });

		if (deleted.length === 0) {
			return APIResponse.notFound(c, "Session not found");
		}

		return APIResponse.successNoData(c, "Session revoked successfully");
	},
);
