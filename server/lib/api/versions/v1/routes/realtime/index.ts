import { Hono } from "hono";
import { OrgContext } from "../../../../../orgs/context";
import { RealtimeLimits } from "../../../../../realtime/limits";
import { RealtimeTickets } from "../../../../../realtime/tickets";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { RealtimeModel } from "./model";

/** Tickets for the realtime WebSocket (`/ws/realtime`): chat updates, typing, presence. */
export const router = new Hono().basePath("/realtime");

router.use("*", requireOrgRole("volunteer"));

router.post(
	"/ticket",

	APIRouteSpec.authenticated({
		summary: "Get realtime ticket",
		description:
			"A one-time ticket for opening the realtime WebSocket on this host: `wss://<host>/ws/realtime?ticket=…`, within 30 seconds. The socket pushes chat changes, typing signals, presence and new notifications; the data itself is then loaded through the REST API. Server events: `hello`, `pong`, `conversation`, `typing`, `presence`, `notification`; client events: `ping`, `typing`.",
		tags: [DOCS_TAGS.MESSAGING],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Ticket issued successfully", RealtimeModel.Ticket.Response),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		if (!RealtimeTickets.allowedToIssue(authContext.user_id)) {
			return APIResponse.tooManyRequests(c, "Too many tickets; try again in a minute");
		}
		const { ticket, expiresAt } = RealtimeTickets.issue(OrgContext.id(), authContext);
		return APIResponse.success(c, "Ticket issued successfully", {
			ticket,
			path: RealtimeLimits.PATH,
			expires_at: expiresAt,
		} satisfies RealtimeModel.Ticket.Response);
	},
);
