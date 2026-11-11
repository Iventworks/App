import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { FILE_SCOPES } from "../../../../../../db/schema";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { FileService } from "../../../../../utils/fileService";
import { FileShares } from "../../../../../utils/fileShares";
import { getAuthUserId } from "../../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { describeSharedItem } from "../../files/shares";

/** Every share link of the org in one place, so admins see what is shared with whom. */
export const router = new Hono().basePath("/shares");

const Entry = FileShares.View.extend({
	file: z.object({
		id: z.number(),
		kind: z.enum(["folder", "file"]),
		name: z.string(),
		scope: z.enum(FILE_SCOPES),
		event: z.object({ id: z.number(), name: z.string() }).nullable(),
		folder_id: z.number().nullable(),
		/** Where the item lives in the app (`/documents?folder=…`). */
		path: z.string(),
	}),
});

const Params = z.object({ shareId: z.coerce.number().int().positive() });
type Params = z.infer<typeof Params>;

router.get(
	"/",
	APIRouteSpec.authenticated({
		summary: "List all share links",
		description: "Every share link of the organisation with the item it opens, newest first.",
		tags: [DOCS_TAGS.FILE_SHARES],
		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Share links retrieved successfully", Entry.array()),
		),
	}),
	async (c) => {
		return APIResponse.success(c, "Share links retrieved successfully", await FileShares.listAll());
	},
);

router.delete(
	"/:shareId",
	APIRouteSpec.authenticated({
		summary: "Revoke share link",
		description: "Delete any share link of the organisation; it stops working immediately.",
		tags: [DOCS_TAGS.FILE_SHARES],
		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Share link deleted successfully"),
			APIResponseSpec.notFound("Share link not found"),
		),
	}),
	zValidator("param", Params),
	async (c) => {
		const { shareId } = c.req.valid("param") as Params;
		const share = await FileShares.get(shareId);
		if (!share) return APIResponse.notFound(c, "Share link not found");
		const file = await FileService.get(share.file_id);

		await FileShares.remove(share);
		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: file?.scope === "event" ? file.event_id : null,
			action: "delete",
			entityType: "file_share",
			entityId: share.id,
			summary: `Freigabelink für ${file ? describeSharedItem(file) : "ein Dokument"} widerrufen`,
		});
		return APIResponse.successNoData(c, "Share link deleted successfully");
	},
);
