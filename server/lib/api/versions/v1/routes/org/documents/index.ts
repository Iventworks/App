import { AuthHandler } from "../../../../../utils/authHandler";
import { FileAccess } from "../../../../../utils/fileAccess";
import { createFileLibraryRouter } from "../../../../../utils/fileLibraryRoutes";
import { getAuthUserId } from "../../../../../utils/guards";
import { DOCS_TAGS } from "../../../docs";

/**
 * The organisation-wide document library. The Kernteam manages it; everything is Kernteam-only
 * unless an access list opens it to members, org groups or single people (`FileAccess`).
 */
export const router = createFileLibraryRouter({
	basePath: "/documents",
	tag: DOCS_TAGS.ORG.DOCUMENTS,
	name: "organisation",
	library: "the organisation's document library",
	managers: "The Kernteam",
	memberView: true,
	viewerOf: (c, { asMember }) =>
		FileAccess.viewer(AuthHandler.AuthContext.get(c), { scope: "org", eventId: null }, { asMember }),
	actor: (c) => ({ userId: getAuthUserId(c), eventId: null }),
	auditPlace: { into: " in die Bibliothek", at: " in der Bibliothek" },
});
