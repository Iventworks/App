import type { Context } from "hono";
import { z } from "zod";
import { AuthHandler } from "../../../../../utils/authHandler";
import type { EventRouterEnv } from "../../../../../utils/eventAccess";
import { FileAccess } from "../../../../../utils/fileAccess";
import { createFileLibraryRouter } from "../../../../../utils/fileLibraryRoutes";
import { DOCS_TAGS } from "../../../docs";

/**
 * An event's documents. The whole team may view and upload unless an access list restricts a
 * folder or file (`FileAccess`); the Leitung (and the Kernteam) may do everything.
 */
export const router = createFileLibraryRouter({
	basePath: "/:eventId/files",
	tag: DOCS_TAGS.EVENTS.DOCUMENTS,
	name: "event",
	library: "the event's documents",
	managers: "The Leitung",
	viewerOf: (c: Context<EventRouterEnv>) =>
		FileAccess.viewer(
			AuthHandler.AuthContext.get(c),
			{ scope: "event", eventId: c.get("event").id },
			{ eventAccess: c.get("eventAccess") },
		),
	actor: (c: Context<EventRouterEnv>) => ({
		userId: c.get("eventAccess").userId,
		eventId: c.get("event").id,
	}),
	parentParams: z.object({ eventId: z.coerce.number().int().positive() }),
	parentNotFound: "Event not found",
});
