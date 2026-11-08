import { Hono } from "hono";
import { requireOrgRole } from "../../../../utils/guards";

/**
 * Organisation level: news, the shared document library and inventory for everyone; finances,
 * statistics, staff planning and internal notes for the core team ("Kernteam").
 * Fine-grained checks (`PermissionHelper.can`) live in the handlers.
 */
export const router = new Hono().basePath("/org");

router.use("*", requireOrgRole("volunteer"));

router.route("/", (await import("./announcements")).router);
router.route("/", (await import("./documents")).router);
router.route("/", (await import("./resources")).router);
router.route("/", (await import("./core-team")).router);
