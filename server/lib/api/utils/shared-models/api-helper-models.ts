import { z } from "zod";

export namespace ApiHelperModels {
	/** A colour picked in the UI (groups, events, program items, calendar entries). */
	export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #f97316");
}

export namespace ApiHelperModels.ListAll {
	export const Query = z.object({
		limit: z.coerce.number().int().positive().min(1).max(100).default(10),
		offset: z.coerce.number().int().min(0).default(0),
		order: z.enum(["newest", "oldest"]).default("newest"),
	});

	export type Query = z.infer<typeof Query>;

	export const QueryWithSearch = Query.extend({
		searchString: z.string().min(3).optional(),
	});

	export type QueryWithSearch = z.infer<typeof QueryWithSearch>;
}
