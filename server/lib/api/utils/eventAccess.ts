import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { DB } from "../../db";
import { APIResponse } from "./api-res";
import { AuthHandler } from "./authHandler";
import { PermissionHelper } from "./permissions";

/**
 * Typed context for everything under `/events/:eventId/*`. The loader resolves the event and the
 * caller's effective role once; handlers read them with `c.get("event")` / `c.get("eventAccess")`
 * and check actions with `EventAccess.can(c, "…")`.
 */
export type EventRouterEnv = {
	Variables: {
		event: DB.Models.Event;
		eventAccess: PermissionHelper.EventAccess;
	};
};

export namespace EventAccess {
	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	/** Resolve the caller's access to an event (also used outside the loader, e.g. dashboards). */
	export async function resolve(
		authContext: AuthHandler.AuthenticatedAuthContext,
		eventId: number,
	): Promise<PermissionHelper.EventAccess> {
		const membership =
			(await DB.instance()
				.select()
				.from(DB.Tables.eventMembers)
				.where(
					and(
						eq(DB.Tables.eventMembers.event_id, eventId),
						eq(DB.Tables.eventMembers.user_id, authContext.user_id),
					),
				)
				.get()) ?? null;

		return {
			userId: authContext.user_id,
			orgRole: authContext.user_role,
			role: PermissionHelper.getEffectiveEventRole(authContext.user_role, membership),
			membership,
		};
	}

	/**
	 * Mount on a router as `router.use("/:eventId/*", ...EventAccess.loader)`: validates the
	 * param (so it is documented as a number), loads the event (404) and the caller's access (403).
	 */
	export const loader = [
		zValidator("param", Params),
		createMiddleware<EventRouterEnv>(async (c, next) => {
			const authContext = AuthHandler.AuthContext.get(c);
			if (authContext.type === "unauthenticated") {
				return APIResponse.unauthorized(c, "Authentication required");
			}

			const eventId = Params.shape.eventId.safeParse(c.req.param("eventId"));
			if (!eventId.success) {
				return APIResponse.badRequest(c, "Invalid event id");
			}

			const event = await DB.instance()
				.select()
				.from(DB.Tables.events)
				.where(eq(DB.Tables.events.id, eventId.data))
				.get();

			if (!event) {
				return APIResponse.notFound(c, "Event not found");
			}

			const access = await resolve(authContext, event.id);
			if (!access.role) {
				return APIResponse.forbidden(c, "You are not a member of this event");
			}

			c.set("event", event);
			c.set("eventAccess", access);

			await next();
		}),
	] as const;

	export function can<E extends EventRouterEnv>(
		c: Context<E>,
		permission: PermissionHelper.EventPermission,
	) {
		return PermissionHelper.canInEvent({ access: c.get("eventAccess"), permission });
	}
}
